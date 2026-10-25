import {
  verifyExecutionPermit,
  verifyExecutionReceipt,
  type ExecutionOutcome,
  type ExecutionPermit,
  type ExecutionReceipt,
} from "./execution.js";

export const EXECUTION_VERIFICATION_VERSION = "2026-10-25.1" as const;

export type ExecutionVerificationStatus = "CONFIRMED" | "CONTRADICTED" | "INCONCLUSIVE";

export interface BindExecutionVerificationInput {
  verificationId: string;
  verifierId: string;
  status: ExecutionVerificationStatus;
  observedOutcome?: ExecutionOutcome;
  verifiedAt: string;
  evidenceRef?: string;
  reason?: string;
}

export interface ExecutionVerification {
  version: typeof EXECUTION_VERIFICATION_VERSION;
  trust: "EXECUTION_VERIFICATION_REPORTED_UNAUTHENTICATED_VERIFIER";
  verificationId: string;
  verifierId: string;
  receiptBinding: string;
  permitBinding: string;
  executionId: string;
  proposalBinding: string;
  reportedOutcome: ExecutionOutcome;
  status: ExecutionVerificationStatus;
  observedOutcome: ExecutionOutcome | null;
  verifiedAt: string;
  evidenceRef?: string;
  reason?: string;
  binding: string;
}

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 1000;
const MAX_REASON_LENGTH = 2000;
const STATUSES = new Set<ExecutionVerificationStatus>(["CONFIRMED", "CONTRADICTED", "INCONCLUSIVE"]);
const OUTCOMES = new Set<ExecutionOutcome>(["SUCCEEDED", "FAILED", "PARTIAL", "UNKNOWN"]);

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

function verificationBinding(value: Omit<ExecutionVerification, "binding">): string {
  return canonicalString(value);
}

function validateStatusOutcome(
  status: ExecutionVerificationStatus,
  reportedOutcome: ExecutionOutcome,
  observedOutcome: ExecutionOutcome | null,
): void {
  if (status === "CONFIRMED") {
    if (observedOutcome === null || observedOutcome !== reportedOutcome) {
      throw new Error("confirmed_verification_requires_matching_observed_outcome");
    }
    return;
  }

  if (status === "CONTRADICTED") {
    if (observedOutcome === null || observedOutcome === reportedOutcome) {
      throw new Error("contradicted_verification_requires_different_observed_outcome");
    }
    return;
  }

  // INCONCLUSIVE may preserve an observation without claiming that it proves or disproves the receipt.
}

/**
 * Creates a separate verification artifact over an executor receipt.
 * This never rewrites the executor-reported outcome and does not authenticate the verifier.
 */
export function bindExecutionVerification(
  receipt: ExecutionReceipt,
  permit: ExecutionPermit,
  input: BindExecutionVerificationInput,
): ExecutionVerification {
  if (!verifyExecutionPermit(permit)) throw new Error("execution_permit_invalid");
  if (!verifyExecutionReceipt(receipt, permit)) throw new Error("execution_receipt_invalid");
  if (!STATUSES.has(input.status)) throw new TypeError("invalid_execution_verification_status");

  const observedOutcome = input.observedOutcome ?? null;
  if (observedOutcome !== null && !OUTCOMES.has(observedOutcome)) {
    throw new TypeError("invalid_observed_execution_outcome");
  }
  validateStatusOutcome(input.status, receipt.outcome, observedOutcome);

  const verifiedAt = parseIsoInstant(input.verifiedAt, "execution_verification_verified_at");
  const completedAt = parseIsoInstant(receipt.completedAt, "execution_completed_at");
  if (verifiedAt.getTime() < completedAt.getTime()) {
    throw new Error("execution_verification_predates_completion");
  }

  const payload: Omit<ExecutionVerification, "binding"> = {
    version: EXECUTION_VERIFICATION_VERSION,
    trust: "EXECUTION_VERIFICATION_REPORTED_UNAUTHENTICATED_VERIFIER",
    verificationId: boundedText(input.verificationId, MAX_ID_LENGTH, "execution_verification_id"),
    verifierId: boundedText(input.verifierId, MAX_ID_LENGTH, "execution_verifier_id"),
    receiptBinding: receipt.binding,
    permitBinding: permit.binding,
    executionId: receipt.executionId,
    proposalBinding: receipt.proposalBinding,
    reportedOutcome: receipt.outcome,
    status: input.status,
    observedOutcome,
    verifiedAt: verifiedAt.toISOString(),
    ...(input.evidenceRef === undefined
      ? {}
      : { evidenceRef: boundedText(input.evidenceRef, MAX_REF_LENGTH, "execution_verification_evidence_ref") }),
    ...(input.reason === undefined
      ? {}
      : { reason: boundedText(input.reason, MAX_REASON_LENGTH, "execution_verification_reason") }),
  };

  return { ...payload, binding: verificationBinding(payload) };
}

export function verifyExecutionVerification(
  verification: ExecutionVerification,
  receipt: ExecutionReceipt,
  permit: ExecutionPermit,
): boolean {
  if (!verifyExecutionPermit(permit) || !verifyExecutionReceipt(receipt, permit)) return false;
  if (typeof verification !== "object" || verification === null) return false;
  if (verification.version !== EXECUTION_VERIFICATION_VERSION) return false;
  if (verification.trust !== "EXECUTION_VERIFICATION_REPORTED_UNAUTHENTICATED_VERIFIER") return false;
  if (!STATUSES.has(verification.status)) return false;
  if (verification.observedOutcome !== null && !OUTCOMES.has(verification.observedOutcome)) return false;
  if (verification.receiptBinding !== receipt.binding) return false;
  if (verification.permitBinding !== permit.binding) return false;
  if (verification.executionId !== receipt.executionId) return false;
  if (verification.proposalBinding !== receipt.proposalBinding) return false;
  if (verification.reportedOutcome !== receipt.outcome) return false;

  try {
    boundedText(verification.verificationId, MAX_ID_LENGTH, "execution_verification_id");
    boundedText(verification.verifierId, MAX_ID_LENGTH, "execution_verifier_id");
    const verifiedAt = parseIsoInstant(verification.verifiedAt, "execution_verification_verified_at");
    const completedAt = parseIsoInstant(receipt.completedAt, "execution_completed_at");
    if (verifiedAt.getTime() < completedAt.getTime()) return false;
    if (verification.evidenceRef !== undefined) {
      boundedText(verification.evidenceRef, MAX_REF_LENGTH, "execution_verification_evidence_ref");
    }
    if (verification.reason !== undefined) {
      boundedText(verification.reason, MAX_REASON_LENGTH, "execution_verification_reason");
    }
    validateStatusOutcome(verification.status, verification.reportedOutcome, verification.observedOutcome);
  } catch {
    return false;
  }

  const { binding, ...payload } = verification;
  return binding === verificationBinding(payload);
}
