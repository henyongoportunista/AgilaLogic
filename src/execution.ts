import {
  assertSabAdmissibleCandidateFresh,
  verifySabAdmissibleCandidate,
  type SabAdmissibleCandidate,
} from "./admission.js";
import {
  SAB_POLICY_VERSION,
  evaluateProposal,
  isExecutionAuthorized,
  proposalBinding,
  validateProposal,
  type ActionProposal,
  type ApprovalRecord,
  type SabRoute,
} from "./sab.js";

export const EXECUTION_CONTRACT_VERSION = "2026-10-25.1" as const;

export type ExecutionOutcome = "SUCCEEDED" | "FAILED" | "PARTIAL" | "UNKNOWN";

export interface ExecutionPermit {
  version: typeof EXECUTION_CONTRACT_VERSION;
  trust: "SAB_POLICY_PERMIT_STRUCTURAL_UNAUTHENTICATED_APPROVER_IF_REQUIRED";
  permitId: string;
  admissionBinding: string;
  proposal: ActionProposal;
  proposalBinding: string;
  sabRoute: Exclude<SabRoute, "DENY">;
  policyVersion: typeof SAB_POLICY_VERSION;
  approvalSnapshotBinding: string | null;
  issuedAt: string;
  expiresAt: string;
  binding: string;
}

export interface IssueExecutionPermitInput {
  permitId: string;
  candidate: SabAdmissibleCandidate;
  approval?: ApprovalRecord;
  now?: Date;
}

export interface BindExecutionReceiptInput {
  receiptId: string;
  executionId: string;
  executorId: string;
  reportedProposal: ActionProposal;
  startedAt: string;
  completedAt: string;
  outcome: ExecutionOutcome;
  evidenceRef?: string;
  errorCode?: string;
}

export interface ExecutionReceipt {
  version: typeof EXECUTION_CONTRACT_VERSION;
  trust: "EXECUTION_REPORTED_UNAUTHENTICATED_EXECUTOR";
  receiptId: string;
  executionId: string;
  executorId: string;
  permitBinding: string;
  admissionBinding: string;
  proposalBinding: string;
  startedAt: string;
  completedAt: string;
  outcome: ExecutionOutcome;
  evidenceRef?: string;
  errorCode?: string;
  binding: string;
}

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 1000;
const MAX_PERMIT_TTL_MS = 2 * 60_000;
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

function permitBinding(permit: Omit<ExecutionPermit, "binding">): string {
  return canonicalString(permit);
}

function receiptBinding(receipt: Omit<ExecutionReceipt, "binding">): string {
  return canonicalString(receipt);
}

function approvalSnapshotBinding(approval?: ApprovalRecord): string | null {
  return approval === undefined ? null : canonicalString(approval);
}

/**
 * Issues a short-lived structural permit only after Trust Admission is still fresh
 * and the current SAB policy says the proposal is authorized.
 *
 * ApprovalRecord identity is not authenticated by this prototype, so the trust
 * label remains explicit about that limitation when human approval is required.
 */
export function issueExecutionPermit(input: IssueExecutionPermitInput): ExecutionPermit {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");
  if (!verifySabAdmissibleCandidate(input.candidate)) throw new Error("admission_candidate_invalid");
  assertSabAdmissibleCandidateFresh(input.candidate, now);

  const decision = evaluateProposal(input.candidate.proposal);
  if (decision.route === "DENY") throw new Error("sab_denied_execution_permit");
  if (!isExecutionAuthorized(input.candidate.proposal, input.approval, now)) {
    throw new Error("sab_execution_not_authorized");
  }

  const candidateExpiry = parseIsoInstant(input.candidate.validUntil, "admission_valid_until").getTime();
  const localExpiry = now.getTime() + MAX_PERMIT_TTL_MS;
  const expiresAt = new Date(Math.min(candidateExpiry, localExpiry));
  if (expiresAt.getTime() <= now.getTime()) throw new Error("execution_permit_window_empty");

  const payload: Omit<ExecutionPermit, "binding"> = {
    version: EXECUTION_CONTRACT_VERSION,
    trust: "SAB_POLICY_PERMIT_STRUCTURAL_UNAUTHENTICATED_APPROVER_IF_REQUIRED",
    permitId: boundedText(input.permitId, MAX_ID_LENGTH, "execution_permit_id"),
    admissionBinding: boundedText(input.candidate.admissionBinding, 100_000, "admission_binding"),
    proposal: { ...input.candidate.proposal },
    proposalBinding: proposalBinding(input.candidate.proposal),
    sabRoute: decision.route,
    policyVersion: SAB_POLICY_VERSION,
    approvalSnapshotBinding: decision.requiresApproval ? approvalSnapshotBinding(input.approval) : null,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return { ...payload, binding: permitBinding(payload) };
}

export function verifyExecutionPermit(permit: ExecutionPermit): boolean {
  if (typeof permit !== "object" || permit === null) return false;
  if (permit.version !== EXECUTION_CONTRACT_VERSION) return false;
  if (permit.trust !== "SAB_POLICY_PERMIT_STRUCTURAL_UNAUTHENTICATED_APPROVER_IF_REQUIRED") return false;
  if (permit.policyVersion !== SAB_POLICY_VERSION) return false;
  if (permit.sabRoute === "DENY") return false;
  if (validateProposal(permit.proposal).length > 0) return false;
  if (permit.proposalBinding !== proposalBinding(permit.proposal)) return false;

  try {
    boundedText(permit.permitId, MAX_ID_LENGTH, "execution_permit_id");
    boundedText(permit.admissionBinding, 100_000, "admission_binding");
    const issuedAt = parseIsoInstant(permit.issuedAt, "execution_permit_issued_at");
    const expiresAt = parseIsoInstant(permit.expiresAt, "execution_permit_expires_at");
    if (expiresAt.getTime() <= issuedAt.getTime()) return false;
    if (expiresAt.getTime() - issuedAt.getTime() > MAX_PERMIT_TTL_MS) return false;
    if (permit.sabRoute === "REQUIRE_HUMAN_APPROVAL") {
      if (typeof permit.approvalSnapshotBinding !== "string" || permit.approvalSnapshotBinding.length === 0) return false;
    } else if (permit.approvalSnapshotBinding !== null) {
      return false;
    }
  } catch {
    return false;
  }

  const { binding, ...payload } = permit;
  return binding === permitBinding(payload);
}

export function assertExecutionPermitFresh(permit: ExecutionPermit, now = new Date()): void {
  if (!verifyExecutionPermit(permit)) throw new Error("execution_permit_invalid");
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");
  const issuedAt = new Date(permit.issuedAt).getTime();
  const expiresAt = new Date(permit.expiresAt).getTime();
  if (now.getTime() < issuedAt) throw new Error("execution_permit_not_yet_valid");
  if (now.getTime() >= expiresAt) throw new Error("execution_permit_expired");
}

/**
 * Records what an executor reports happened. It is not an independent verification
 * of success and therefore never upgrades the executor's identity or outcome claim.
 */
export function bindExecutionReceipt(
  permit: ExecutionPermit,
  input: BindExecutionReceiptInput,
): ExecutionReceipt {
  if (!verifyExecutionPermit(permit)) throw new Error("execution_permit_invalid");
  if (!OUTCOMES.has(input.outcome)) throw new TypeError("invalid_execution_outcome");
  if (validateProposal(input.reportedProposal).length > 0) throw new Error("reported_proposal_invalid");
  if (proposalBinding(input.reportedProposal) !== permit.proposalBinding) {
    throw new Error("execution_reported_operation_mismatch");
  }

  const startedAt = parseIsoInstant(input.startedAt, "execution_started_at");
  const completedAt = parseIsoInstant(input.completedAt, "execution_completed_at");
  const permitIssuedAt = parseIsoInstant(permit.issuedAt, "execution_permit_issued_at");
  const permitExpiresAt = parseIsoInstant(permit.expiresAt, "execution_permit_expires_at");
  if (startedAt.getTime() < permitIssuedAt.getTime()) throw new Error("execution_started_before_permit");
  if (startedAt.getTime() >= permitExpiresAt.getTime()) throw new Error("execution_started_after_permit_expiry");
  if (completedAt.getTime() < startedAt.getTime()) throw new Error("execution_completed_before_start");

  const payload: Omit<ExecutionReceipt, "binding"> = {
    version: EXECUTION_CONTRACT_VERSION,
    trust: "EXECUTION_REPORTED_UNAUTHENTICATED_EXECUTOR",
    receiptId: boundedText(input.receiptId, MAX_ID_LENGTH, "execution_receipt_id"),
    executionId: boundedText(input.executionId, MAX_ID_LENGTH, "execution_id"),
    executorId: boundedText(input.executorId, MAX_ID_LENGTH, "executor_id"),
    permitBinding: permit.binding,
    admissionBinding: permit.admissionBinding,
    proposalBinding: permit.proposalBinding,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    outcome: input.outcome,
    ...(input.evidenceRef === undefined
      ? {}
      : { evidenceRef: boundedText(input.evidenceRef, MAX_REF_LENGTH, "execution_evidence_ref") }),
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: boundedText(input.errorCode, MAX_ID_LENGTH, "execution_error_code") }),
  };

  return { ...payload, binding: receiptBinding(payload) };
}

export function verifyExecutionReceipt(receipt: ExecutionReceipt, permit: ExecutionPermit): boolean {
  if (!verifyExecutionPermit(permit)) return false;
  if (typeof receipt !== "object" || receipt === null) return false;
  if (receipt.version !== EXECUTION_CONTRACT_VERSION) return false;
  if (receipt.trust !== "EXECUTION_REPORTED_UNAUTHENTICATED_EXECUTOR") return false;
  if (!OUTCOMES.has(receipt.outcome)) return false;
  if (receipt.permitBinding !== permit.binding) return false;
  if (receipt.admissionBinding !== permit.admissionBinding) return false;
  if (receipt.proposalBinding !== permit.proposalBinding) return false;

  try {
    boundedText(receipt.receiptId, MAX_ID_LENGTH, "execution_receipt_id");
    boundedText(receipt.executionId, MAX_ID_LENGTH, "execution_id");
    boundedText(receipt.executorId, MAX_ID_LENGTH, "executor_id");
    const startedAt = parseIsoInstant(receipt.startedAt, "execution_started_at");
    const completedAt = parseIsoInstant(receipt.completedAt, "execution_completed_at");
    if (completedAt.getTime() < startedAt.getTime()) return false;
    const permitIssuedAt = new Date(permit.issuedAt).getTime();
    const permitExpiresAt = new Date(permit.expiresAt).getTime();
    if (startedAt.getTime() < permitIssuedAt || startedAt.getTime() >= permitExpiresAt) return false;
    if (receipt.evidenceRef !== undefined) boundedText(receipt.evidenceRef, MAX_REF_LENGTH, "execution_evidence_ref");
    if (receipt.errorCode !== undefined) boundedText(receipt.errorCode, MAX_ID_LENGTH, "execution_error_code");
  } catch {
    return false;
  }

  const { binding, ...payload } = receipt;
  return binding === receiptBinding(payload);
}
