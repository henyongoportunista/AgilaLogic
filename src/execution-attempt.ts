import {
  verifyIdentityBoundExecutionReceipt,
  type IdentityBoundExecutionReceipt,
} from "./execution-evidence.js";
import {
  verifyPreExecutionRequest,
  type PreExecutionRequest,
} from "./execution.js";
import {
  assertResolvedRuntimeIdentityFresh,
  type ResolvedRuntimeIdentity,
} from "./runtime-identity.js";

export const EXECUTION_ATTEMPT_VERSION = "2026-10-25.1" as const;

const MAX_ID_LENGTH = 200;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function boundedText(value: string, maxLength: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const normalized = normalize(value);
  if (normalized.length === 0) throw new TypeError(`${label}_empty`);
  if (normalized.length > maxLength) throw new TypeError(`${label}_too_long`);
  return normalized;
}

function parseIsoInstant(value: string, label: string): Date {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label}_invalid_iso_instant`);
  }
  return parsed;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export type ExecutionAttemptStatus = "RESERVED" | "FINALIZED";
export type ExecutionAttemptStorageClass = "TEST_MEMORY" | "EXTERNAL_STORE";

export interface ExecutionAttemptClaim {
  version: typeof EXECUTION_ATTEMPT_VERSION;
  attemptId: string;
  preExecutionBinding: string;
  proposalBinding: string;
  executorId: string;
  executorIdentityBinding: string;
  reservedAt: string;
  expiresAt: string;
  binding: string;
}

export interface ExecutionAttemptRecord {
  version: typeof EXECUTION_ATTEMPT_VERSION;
  status: ExecutionAttemptStatus;
  claim: ExecutionAttemptClaim;
  receipt?: IdentityBoundExecutionReceipt;
}

export interface ExecutionAttemptStore {
  storageClass: ExecutionAttemptStorageClass;
  loadByPreExecutionBinding(preExecutionBinding: string): Promise<ExecutionAttemptRecord | null>;
  reserveOnce(claim: ExecutionAttemptClaim): Promise<boolean>;
  finalizeOnce(
    preExecutionBinding: string,
    expectedAttemptId: string,
    receipt: IdentityBoundExecutionReceipt,
  ): Promise<boolean>;
}

function claimBinding(claim: Omit<ExecutionAttemptClaim, "binding">): string {
  return canonicalString(claim);
}

export function verifyExecutionAttemptClaim(claim: ExecutionAttemptClaim): boolean {
  if (typeof claim !== "object" || claim === null) return false;
  if (claim.version !== EXECUTION_ATTEMPT_VERSION) return false;
  try {
    boundedText(claim.attemptId, MAX_ID_LENGTH, "attempt_id");
    boundedText(claim.preExecutionBinding, 100_000, "attempt_pre_execution_binding");
    boundedText(claim.proposalBinding, 100_000, "attempt_proposal_binding");
    boundedText(claim.executorId, MAX_ID_LENGTH, "attempt_executor_id");
    boundedText(claim.executorIdentityBinding, 100_000, "attempt_executor_identity_binding");
    const reservedAt = parseIsoInstant(claim.reservedAt, "attempt_reserved_at");
    const expiresAt = parseIsoInstant(claim.expiresAt, "attempt_expires_at");
    if (expiresAt.getTime() <= reservedAt.getTime()) return false;
  } catch {
    return false;
  }
  const { binding, ...payload } = claim;
  return binding === claimBinding(payload);
}

/**
 * Creates the consequence token that must be atomically reserved BEFORE a real
 * side effect. A caller cannot choose executorId; it comes from a live resolved
 * EXECUTOR identity.
 */
export function createExecutionAttemptClaim(
  request: PreExecutionRequest,
  executorIdentity: ResolvedRuntimeIdentity,
  attemptId: string,
  reservedAt: string,
): ExecutionAttemptClaim {
  if (!verifyPreExecutionRequest(request)) throw new Error("pre_execution_binding_mismatch");
  const reserved = parseIsoInstant(reservedAt, "attempt_reserved_at");
  assertResolvedRuntimeIdentityFresh(executorIdentity, "EXECUTOR", reserved);

  const requestExpiry = new Date(request.expiresAt).getTime();
  const identityExpiry = new Date(executorIdentity.expiresAt).getTime();
  const expiresAtMs = Math.min(requestExpiry, identityExpiry);
  if (expiresAtMs <= reserved.getTime()) throw new Error("execution_attempt_window_expired");

  const payload: Omit<ExecutionAttemptClaim, "binding"> = {
    version: EXECUTION_ATTEMPT_VERSION,
    attemptId: boundedText(attemptId, MAX_ID_LENGTH, "attempt_id"),
    preExecutionBinding: request.binding,
    proposalBinding: request.proposalBinding,
    executorId: executorIdentity.actorId,
    executorIdentityBinding: executorIdentity.binding,
    reservedAt: reserved.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  return { ...payload, binding: claimBinding(payload) };
}

export async function reserveExecutionAttempt(
  store: ExecutionAttemptStore,
  claim: ExecutionAttemptClaim,
): Promise<void> {
  if (!verifyExecutionAttemptClaim(claim)) throw new Error("execution_attempt_claim_invalid");
  const reserved = await store.reserveOnce(claim);
  if (!reserved) throw new Error("execution_attempt_already_reserved");
}

/**
 * Finalizes the exact reserved attempt with one identity-bound receipt. If the
 * process crashes after the side effect but before finalization, the reservation
 * remains and blocks blind duplicate execution; recovery must inspect/reconcile it.
 */
export async function finalizeExecutionAttempt(
  store: ExecutionAttemptStore,
  claim: ExecutionAttemptClaim,
  receipt: IdentityBoundExecutionReceipt,
): Promise<void> {
  if (!verifyExecutionAttemptClaim(claim)) throw new Error("execution_attempt_claim_invalid");
  if (!verifyIdentityBoundExecutionReceipt(receipt)) throw new Error("execution_receipt_invalid");
  if (receipt.receipt.preExecutionBinding !== claim.preExecutionBinding) {
    throw new Error("execution_receipt_pre_execution_mismatch");
  }
  if (receipt.receipt.proposalBinding !== claim.proposalBinding) {
    throw new Error("execution_receipt_proposal_mismatch");
  }
  if (receipt.receipt.executorId !== claim.executorId) {
    throw new Error("execution_receipt_executor_mismatch");
  }
  if (receipt.executorIdentityBinding !== claim.executorIdentityBinding) {
    throw new Error("execution_receipt_executor_identity_mismatch");
  }

  const finalized = await store.finalizeOnce(
    claim.preExecutionBinding,
    claim.attemptId,
    receipt,
  );
  if (!finalized) throw new Error("execution_attempt_finalize_conflict");
}

function cloneRecord(record: ExecutionAttemptRecord): ExecutionAttemptRecord {
  return structuredClone(record);
}

export function createInMemoryExecutionAttemptStore(): ExecutionAttemptStore {
  const records = new Map<string, ExecutionAttemptRecord>();
  const attemptIds = new Set<string>();

  return {
    storageClass: "TEST_MEMORY",

    async loadByPreExecutionBinding(preExecutionBinding: string): Promise<ExecutionAttemptRecord | null> {
      const record = records.get(preExecutionBinding);
      return record ? cloneRecord(record) : null;
    },

    async reserveOnce(claim: ExecutionAttemptClaim): Promise<boolean> {
      if (!verifyExecutionAttemptClaim(claim)) throw new Error("execution_attempt_claim_invalid");
      if (records.has(claim.preExecutionBinding) || attemptIds.has(claim.attemptId)) return false;
      records.set(claim.preExecutionBinding, {
        version: EXECUTION_ATTEMPT_VERSION,
        status: "RESERVED",
        claim: structuredClone(claim),
      });
      attemptIds.add(claim.attemptId);
      return true;
    },

    async finalizeOnce(
      preExecutionBinding: string,
      expectedAttemptId: string,
      receipt: IdentityBoundExecutionReceipt,
    ): Promise<boolean> {
      const current = records.get(preExecutionBinding);
      if (!current || current.status !== "RESERVED") return false;
      if (current.claim.attemptId !== expectedAttemptId) return false;
      records.set(preExecutionBinding, {
        ...current,
        status: "FINALIZED",
        receipt: structuredClone(receipt),
      });
      return true;
    },
  };
}
