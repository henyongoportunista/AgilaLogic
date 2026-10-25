import {
  assertExecutionPermitFresh,
  verifyExecutionPermit,
  verifyExecutionReceipt,
  type ExecutionOutcome,
  type ExecutionPermit,
  type ExecutionReceipt,
} from "./execution.js";
import {
  verifyExecutionVerification,
  type ExecutionVerification,
  type ExecutionVerificationStatus,
} from "./execution-verification.js";

export const EXECUTION_LEDGER_VERSION = "2026-10-25.1" as const;

export type ExecutionLedgerStatus = "RESERVED" | "STARTED" | "COMPLETED";

export interface ExecutionLedgerVerificationRef {
  verificationId: string;
  verifierId: string;
  verificationBinding: string;
  status: ExecutionVerificationStatus;
}

export interface ExecutionLedgerEntry {
  executionId: string;
  permitBinding: string;
  admissionBinding: string;
  proposalBinding: string;
  resourcePreconditionBinding: string | null;
  status: ExecutionLedgerStatus;
  reservedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  receiptBinding: string | null;
  outcome: ExecutionOutcome | null;
  verifications: ExecutionLedgerVerificationRef[];
  binding: string;
}

export interface ExecutionLedger {
  version: typeof EXECUTION_LEDGER_VERSION;
  entries: ExecutionLedgerEntry[];
  binding: string;
}

const MAX_ID_LENGTH = 200;
const MAX_BINDING_LENGTH = 200_000;
const STATUSES = new Set<ExecutionLedgerStatus>(["RESERVED", "STARTED", "COMPLETED"]);
const OUTCOMES = new Set<ExecutionOutcome>(["SUCCEEDED", "FAILED", "PARTIAL", "UNKNOWN"]);
const VERIFICATION_STATUSES = new Set<ExecutionVerificationStatus>([
  "CONFIRMED",
  "CONTRADICTED",
  "INCONCLUSIVE",
]);

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

function entryBinding(entry: Omit<ExecutionLedgerEntry, "binding">): string {
  return canonicalString(entry);
}

function ledgerBinding(ledger: Omit<ExecutionLedger, "binding">): string {
  return canonicalString(ledger);
}

function bindEntry(entry: Omit<ExecutionLedgerEntry, "binding">): ExecutionLedgerEntry {
  return { ...entry, binding: entryBinding(entry) };
}

function bindLedger(entries: ExecutionLedgerEntry[]): ExecutionLedger {
  const payload: Omit<ExecutionLedger, "binding"> = {
    version: EXECUTION_LEDGER_VERSION,
    entries: entries.map((entry) => ({
      ...entry,
      verifications: entry.verifications.map((verification) => ({ ...verification })),
    })),
  };
  return { ...payload, binding: ledgerBinding(payload) };
}

function verifyVerificationRef(ref: ExecutionLedgerVerificationRef): boolean {
  try {
    boundedText(ref.verificationId, MAX_ID_LENGTH, "execution_verification_id");
    boundedText(ref.verifierId, MAX_ID_LENGTH, "execution_verifier_id");
    boundedText(ref.verificationBinding, MAX_BINDING_LENGTH, "execution_verification_binding");
  } catch {
    return false;
  }
  return VERIFICATION_STATUSES.has(ref.status);
}

function verifyEntry(entry: ExecutionLedgerEntry): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  if (!STATUSES.has(entry.status)) return false;
  if (!Array.isArray(entry.verifications) || !entry.verifications.every(verifyVerificationRef)) return false;

  const verificationIds = entry.verifications.map((verification) => verification.verificationId);
  const verificationBindings = entry.verifications.map((verification) => verification.verificationBinding);
  if (new Set(verificationIds).size !== verificationIds.length) return false;
  if (new Set(verificationBindings).size !== verificationBindings.length) return false;

  try {
    boundedText(entry.executionId, MAX_ID_LENGTH, "execution_id");
    boundedText(entry.permitBinding, MAX_BINDING_LENGTH, "execution_permit_binding");
    boundedText(entry.admissionBinding, MAX_BINDING_LENGTH, "admission_binding");
    boundedText(entry.proposalBinding, MAX_BINDING_LENGTH, "proposal_binding");
    if (entry.resourcePreconditionBinding !== null) {
      boundedText(entry.resourcePreconditionBinding, MAX_BINDING_LENGTH, "resource_precondition_binding");
    }
    const reservedAt = parseIsoInstant(entry.reservedAt, "execution_reserved_at");

    if (entry.status === "RESERVED") {
      if (
        entry.startedAt !== null ||
        entry.completedAt !== null ||
        entry.receiptBinding !== null ||
        entry.outcome !== null ||
        entry.verifications.length > 0
      ) {
        return false;
      }
    }

    if (entry.status === "STARTED") {
      if (entry.startedAt === null) return false;
      const startedAt = parseIsoInstant(entry.startedAt, "execution_started_at");
      if (startedAt.getTime() < reservedAt.getTime()) return false;
      if (
        entry.completedAt !== null ||
        entry.receiptBinding !== null ||
        entry.outcome !== null ||
        entry.verifications.length > 0
      ) {
        return false;
      }
    }

    if (entry.status === "COMPLETED") {
      if (entry.startedAt === null || entry.completedAt === null || entry.receiptBinding === null || entry.outcome === null) {
        return false;
      }
      const startedAt = parseIsoInstant(entry.startedAt, "execution_started_at");
      const completedAt = parseIsoInstant(entry.completedAt, "execution_completed_at");
      if (startedAt.getTime() < reservedAt.getTime()) return false;
      if (completedAt.getTime() < startedAt.getTime()) return false;
      boundedText(entry.receiptBinding, MAX_BINDING_LENGTH, "execution_receipt_binding");
      if (!OUTCOMES.has(entry.outcome)) return false;
    }
  } catch {
    return false;
  }

  const { binding, ...payload } = entry;
  return binding === entryBinding(payload);
}

export function emptyExecutionLedger(): ExecutionLedger {
  return bindLedger([]);
}

export function verifyExecutionLedger(ledger: ExecutionLedger): boolean {
  if (typeof ledger !== "object" || ledger === null) return false;
  if (ledger.version !== EXECUTION_LEDGER_VERSION) return false;
  if (!Array.isArray(ledger.entries) || !ledger.entries.every(verifyEntry)) return false;

  const executionIds = ledger.entries.map((entry) => entry.executionId);
  const permitBindings = ledger.entries.map((entry) => entry.permitBinding);
  if (new Set(executionIds).size !== executionIds.length) return false;
  if (new Set(permitBindings).size !== permitBindings.length) return false;

  const { binding, ...payload } = ledger;
  return binding === ledgerBinding(payload);
}

function exactPermitEntry(entry: ExecutionLedgerEntry, permit: ExecutionPermit): boolean {
  return (
    entry.executionId === permit.executionId &&
    entry.permitBinding === permit.binding &&
    entry.admissionBinding === permit.admissionBinding &&
    entry.proposalBinding === permit.proposalBinding &&
    entry.resourcePreconditionBinding === (permit.resourcePrecondition?.binding ?? null)
  );
}

function findExactEntry(ledger: ExecutionLedger, permit: ExecutionPermit): ExecutionLedgerEntry {
  const entry = ledger.entries.find((candidate) => candidate.executionId === permit.executionId);
  if (entry === undefined) throw new Error("execution_not_reserved");
  if (!exactPermitEntry(entry, permit)) throw new Error("execution_ledger_permit_mismatch");
  return entry;
}

/**
 * Reserves one execution identity before any executor may begin work.
 *
 * The ledger is caller-supplied prototype state. Production replay prevention
 * requires this transition to be persisted atomically by a trusted backend.
 */
export function reserveExecution(
  ledger: ExecutionLedger,
  permit: ExecutionPermit,
  now = new Date(),
): ExecutionLedger {
  if (!verifyExecutionLedger(ledger)) throw new Error("execution_ledger_invalid");
  if (!verifyExecutionPermit(permit)) throw new Error("execution_permit_invalid");
  assertExecutionPermitFresh(permit, now);

  if (ledger.entries.some((entry) => entry.executionId === permit.executionId)) {
    throw new Error("execution_id_already_reserved");
  }
  if (ledger.entries.some((entry) => entry.permitBinding === permit.binding)) {
    throw new Error("execution_permit_already_reserved");
  }

  const entry = bindEntry({
    executionId: permit.executionId,
    permitBinding: permit.binding,
    admissionBinding: permit.admissionBinding,
    proposalBinding: permit.proposalBinding,
    resourcePreconditionBinding: permit.resourcePrecondition?.binding ?? null,
    status: "RESERVED",
    reservedAt: now.toISOString(),
    startedAt: null,
    completedAt: null,
    receiptBinding: null,
    outcome: null,
    verifications: [],
  });

  return bindLedger([...ledger.entries, entry]);
}

export function startExecution(
  ledger: ExecutionLedger,
  permit: ExecutionPermit,
  startedAtValue: string,
): ExecutionLedger {
  if (!verifyExecutionLedger(ledger)) throw new Error("execution_ledger_invalid");
  if (!verifyExecutionPermit(permit)) throw new Error("execution_permit_invalid");
  const entry = findExactEntry(ledger, permit);
  if (entry.status !== "RESERVED") throw new Error("execution_not_reservable_for_start");

  const startedAt = parseIsoInstant(startedAtValue, "execution_started_at");
  const reservedAt = parseIsoInstant(entry.reservedAt, "execution_reserved_at");
  const issuedAt = parseIsoInstant(permit.issuedAt, "execution_permit_issued_at");
  const expiresAt = parseIsoInstant(permit.expiresAt, "execution_permit_expires_at");
  if (startedAt.getTime() < reservedAt.getTime() || startedAt.getTime() < issuedAt.getTime()) {
    throw new Error("execution_started_before_reservation_or_permit");
  }
  if (startedAt.getTime() >= expiresAt.getTime()) {
    throw new Error("execution_started_after_permit_expiry");
  }

  const updated = bindEntry({
    ...entry,
    status: "STARTED",
    startedAt: startedAt.toISOString(),
    binding: undefined as never,
  });

  return bindLedger(ledger.entries.map((candidate) => (candidate.executionId === entry.executionId ? updated : candidate)));
}

export function completeExecution(
  ledger: ExecutionLedger,
  receipt: ExecutionReceipt,
  permit: ExecutionPermit,
): ExecutionLedger {
  if (!verifyExecutionLedger(ledger)) throw new Error("execution_ledger_invalid");
  if (!verifyExecutionReceipt(receipt, permit)) throw new Error("execution_receipt_invalid");
  const entry = findExactEntry(ledger, permit);
  if (entry.status !== "STARTED") throw new Error("execution_not_started");
  if (entry.startedAt !== receipt.startedAt) throw new Error("execution_receipt_start_mismatch");

  const updated = bindEntry({
    ...entry,
    status: "COMPLETED",
    completedAt: receipt.completedAt,
    receiptBinding: receipt.binding,
    outcome: receipt.outcome,
    binding: undefined as never,
  });

  return bindLedger(ledger.entries.map((candidate) => (candidate.executionId === entry.executionId ? updated : candidate)));
}

export function attachExecutionVerification(
  ledger: ExecutionLedger,
  verification: ExecutionVerification,
  receipt: ExecutionReceipt,
  permit: ExecutionPermit,
): ExecutionLedger {
  if (!verifyExecutionLedger(ledger)) throw new Error("execution_ledger_invalid");
  if (!verifyExecutionVerification(verification, receipt, permit)) {
    throw new Error("execution_verification_invalid");
  }
  const entry = findExactEntry(ledger, permit);
  if (entry.status !== "COMPLETED" || entry.receiptBinding !== receipt.binding) {
    throw new Error("execution_not_completed_with_receipt");
  }
  if (entry.verifications.some((item) => item.verificationId === verification.verificationId)) {
    throw new Error("execution_verification_id_already_recorded");
  }
  if (entry.verifications.some((item) => item.verificationBinding === verification.binding)) {
    throw new Error("execution_verification_already_recorded");
  }

  const updated = bindEntry({
    ...entry,
    verifications: [
      ...entry.verifications,
      {
        verificationId: verification.verificationId,
        verifierId: verification.verifierId,
        verificationBinding: verification.binding,
        status: verification.status,
      },
    ],
    binding: undefined as never,
  });

  return bindLedger(ledger.entries.map((candidate) => (candidate.executionId === entry.executionId ? updated : candidate)));
}
