import { admitForSab, type TrustAdmissionInput } from "./admission.js";
import {
  assertNorthstarContextFresh,
  verifyNorthstarContextPack,
  type NorthstarContextPack,
  type NorthstarPrincipal,
} from "./northstar.js";
import {
  SAB_POLICY_VERSION,
  evaluateProposal,
  isExecutionAuthorized,
  proposalBinding,
  type ActionProposal,
  type ApprovalRecord,
  type SabRoute,
} from "./sab.js";

export const PRE_EXECUTION_VERSION = "2026-10-25.1" as const;
export const EXECUTION_RECEIPT_VERSION = "2026-10-25.1" as const;

const MAX_ID_LENGTH = 200;
const MAX_TOKEN_LENGTH = 2000;
const MAX_REF_LENGTH = 4000;

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

export interface ResourceStateSnapshot {
  version: typeof PRE_EXECUTION_VERSION;
  adapterId: string;
  target: string;
  stateToken: string;
  observedAt: string;
  expiresAt: string;
  binding: string;
}

export interface CreateResourceStateSnapshotInput {
  adapterId: string;
  target: string;
  stateToken: string;
  observedAt: string;
  expiresAt: string;
}

function resourceStateBinding(snapshot: Omit<ResourceStateSnapshot, "binding">): string {
  return canonicalString(snapshot);
}

/**
 * Structural resource-state observation for optimistic TOCTOU protection.
 * stateToken is an adapter-supplied opaque ETag/version/checksum-like value.
 * This contract does not authenticate adapter identity or prove the token is truthful.
 */
export function createResourceStateSnapshot(
  input: CreateResourceStateSnapshotInput,
): ResourceStateSnapshot {
  const observedAt = parseIsoInstant(input.observedAt, "resource_observed_at");
  const expiresAt = parseIsoInstant(input.expiresAt, "resource_expires_at");
  if (expiresAt.getTime() <= observedAt.getTime()) {
    throw new TypeError("resource_state_nonpositive_window");
  }

  const payload: Omit<ResourceStateSnapshot, "binding"> = {
    version: PRE_EXECUTION_VERSION,
    adapterId: boundedText(input.adapterId, MAX_ID_LENGTH, "resource_adapter_id"),
    target: boundedText(input.target, MAX_REF_LENGTH, "resource_target"),
    stateToken: boundedText(input.stateToken, MAX_TOKEN_LENGTH, "resource_state_token"),
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return { ...payload, binding: resourceStateBinding(payload) };
}

export function verifyResourceStateSnapshot(snapshot: ResourceStateSnapshot): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  if (snapshot.version !== PRE_EXECUTION_VERSION) return false;
  try {
    boundedText(snapshot.adapterId, MAX_ID_LENGTH, "resource_adapter_id");
    boundedText(snapshot.target, MAX_REF_LENGTH, "resource_target");
    boundedText(snapshot.stateToken, MAX_TOKEN_LENGTH, "resource_state_token");
    const observedAt = parseIsoInstant(snapshot.observedAt, "resource_observed_at");
    const expiresAt = parseIsoInstant(snapshot.expiresAt, "resource_expires_at");
    if (expiresAt.getTime() <= observedAt.getTime()) return false;
  } catch {
    return false;
  }

  const { binding, ...payload } = snapshot;
  return binding === resourceStateBinding(payload);
}

export function assertResourceStateFresh(
  snapshot: ResourceStateSnapshot,
  now = new Date(),
): void {
  if (!verifyResourceStateSnapshot(snapshot)) throw new Error("resource_state_binding_mismatch");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs < new Date(snapshot.observedAt).getTime()) throw new Error("resource_state_not_yet_valid");
  if (nowMs >= new Date(snapshot.expiresAt).getTime()) throw new Error("resource_state_expired");
}

export interface SessionBoundApproval {
  version: typeof PRE_EXECUTION_VERSION;
  approval: ApprovalRecord;
  principal: Exclude<NorthstarPrincipal, "UNVERIFIED_PUBLIC">;
  sessionId: string;
  northstarContextBinding: string;
  binding: string;
}

function sessionApprovalBinding(
  approval: Omit<SessionBoundApproval, "binding">,
): string {
  return canonicalString(approval);
}

/**
 * Binds an already-created SAB approval record to a Northstar context that claims
 * to originate from EXTERNAL_AUTH. Northstar still does not authenticate identity;
 * the production auth boundary must mint the principal/session assertion.
 */
export function bindApprovalToNorthstar(
  proposal: ActionProposal,
  approval: ApprovalRecord,
  northstarContext: NorthstarContextPack,
  now = new Date(),
): SessionBoundApproval {
  if (!verifyNorthstarContextPack(northstarContext)) {
    throw new Error("northstar_context_invalid");
  }
  assertNorthstarContextFresh(northstarContext, now);
  if (northstarContext.principal === "UNVERIFIED_PUBLIC") {
    throw new Error("human_approval_requires_verified_principal");
  }
  if (northstarContext.principalVerification !== "EXTERNAL_AUTH") {
    throw new Error("human_approval_requires_external_auth");
  }
  if (!isExecutionAuthorized(proposal, approval, now)) {
    throw new Error("sab_approval_not_authorized");
  }
  if (approval.approvedBy !== northstarContext.principal) {
    throw new Error("approval_principal_mismatch");
  }

  const payload: Omit<SessionBoundApproval, "binding"> = {
    version: PRE_EXECUTION_VERSION,
    approval: { ...approval },
    principal: northstarContext.principal,
    sessionId: northstarContext.sessionId,
    northstarContextBinding: northstarContext.contextBinding,
  };
  return { ...payload, binding: sessionApprovalBinding(payload) };
}

export function verifySessionBoundApproval(
  proposal: ActionProposal,
  approval: SessionBoundApproval,
  northstarContext: NorthstarContextPack,
  now = new Date(),
): boolean {
  if (typeof approval !== "object" || approval === null) return false;
  if (approval.version !== PRE_EXECUTION_VERSION) return false;
  const { binding, ...payload } = approval;
  if (binding !== sessionApprovalBinding(payload)) return false;
  if (!verifyNorthstarContextPack(northstarContext)) return false;
  try {
    assertNorthstarContextFresh(northstarContext, now);
  } catch {
    return false;
  }
  if (northstarContext.principal === "UNVERIFIED_PUBLIC") return false;
  if (northstarContext.principalVerification !== "EXTERNAL_AUTH") return false;
  if (approval.principal !== northstarContext.principal) return false;
  if (approval.sessionId !== northstarContext.sessionId) return false;
  if (approval.northstarContextBinding !== northstarContext.contextBinding) return false;
  if (approval.approval.approvedBy !== northstarContext.principal) return false;
  return isExecutionAuthorized(proposal, approval.approval, now);
}

export interface PreExecutionRequest {
  version: typeof PRE_EXECUTION_VERSION;
  trust: "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED";
  proposal: ActionProposal;
  proposalBinding: string;
  sabRoute: Exclude<SabRoute, "DENY">;
  policyVersion: typeof SAB_POLICY_VERSION;
  principal: NorthstarPrincipal;
  sessionId: string;
  northstarContextBinding: string;
  adapterId: string;
  expectedResourceStateBinding: string;
  expectedResourceStateToken: string;
  preparedAt: string;
  expiresAt: string;
  binding: string;
}

function preExecutionBinding(
  request: Omit<PreExecutionRequest, "binding">,
): string {
  return canonicalString(request);
}

export interface PreparePreExecutionInput {
  admission: TrustAdmissionInput;
  resourceState: ResourceStateSnapshot;
  sessionBoundApproval?: SessionBoundApproval;
  now?: Date;
}

/**
 * Recomputes Trust Admission rather than trusting an admission label supplied by
 * a caller. It then binds the proposal to a fresh resource-state token and, when
 * SAB requires human approval, to the exact Northstar session that approved it.
 *
 * Output is still structurally unauthenticated and is not an execution command.
 */
export function preparePreExecution(
  input: PreparePreExecutionInput,
): PreExecutionRequest {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");

  const admission = admitForSab({ ...input.admission, now });
  if (!admission.admitted || !admission.candidate) {
    throw new Error("trust_admission_failed");
  }

  const proposal = admission.candidate.proposal;
  const northstar = input.admission.northstarContext;
  if (!verifyNorthstarContextPack(northstar)) throw new Error("northstar_context_invalid");
  assertNorthstarContextFresh(northstar, now);

  if (admission.candidate.evidence.northstarContextBinding !== northstar.contextBinding) {
    throw new Error("admission_northstar_binding_mismatch");
  }
  if (admission.candidate.evidence.principal !== northstar.principal) {
    throw new Error("admission_principal_mismatch");
  }

  assertResourceStateFresh(input.resourceState, now);
  if (input.resourceState.target !== proposal.target) {
    throw new Error("resource_target_mismatch");
  }
  if (input.resourceState.adapterId !== input.admission.attestation.adapterId) {
    throw new Error("resource_adapter_mismatch");
  }

  const decision = evaluateProposal(proposal);
  if (decision.route === "DENY") throw new Error("sab_denied");

  if (decision.route === "REQUIRE_HUMAN_APPROVAL") {
    if (!input.sessionBoundApproval) throw new Error("human_approval_required");
    if (!verifySessionBoundApproval(proposal, input.sessionBoundApproval, northstar, now)) {
      throw new Error("session_bound_approval_invalid");
    }
  }

  const expiryCandidates = [
    new Date(input.resourceState.expiresAt).getTime(),
    new Date(input.admission.architectureState.lifecycle.expiresAt).getTime(),
    new Date(input.admission.engineeringState.lifecycle.expiresAt).getTime(),
    new Date(northstar.expiresAt).getTime(),
    new Date(input.admission.attestation.expiresAt).getTime(),
  ];
  if (input.sessionBoundApproval) {
    expiryCandidates.push(new Date(input.sessionBoundApproval.approval.expiresAt).getTime());
  }
  const expiresAtMs = Math.min(...expiryCandidates);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new Error("pre_execution_window_expired");
  }

  const payload: Omit<PreExecutionRequest, "binding"> = {
    version: PRE_EXECUTION_VERSION,
    trust: "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED",
    proposal: { ...proposal },
    proposalBinding: proposalBinding(proposal),
    sabRoute: decision.route,
    policyVersion: SAB_POLICY_VERSION,
    principal: northstar.principal,
    sessionId: northstar.sessionId,
    northstarContextBinding: northstar.contextBinding,
    adapterId: input.resourceState.adapterId,
    expectedResourceStateBinding: input.resourceState.binding,
    expectedResourceStateToken: input.resourceState.stateToken,
    preparedAt: now.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };

  return { ...payload, binding: preExecutionBinding(payload) };
}

export function verifyPreExecutionRequest(request: PreExecutionRequest): boolean {
  if (typeof request !== "object" || request === null) return false;
  if (request.version !== PRE_EXECUTION_VERSION) return false;
  if (request.trust !== "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED") return false;
  if (request.policyVersion !== SAB_POLICY_VERSION) return false;
  if ((request.sabRoute as SabRoute) === "DENY") return false;
  if (request.proposalBinding !== proposalBinding(request.proposal)) return false;
  try {
    const preparedAt = parseIsoInstant(request.preparedAt, "pre_execution_prepared_at");
    const expiresAt = parseIsoInstant(request.expiresAt, "pre_execution_expires_at");
    if (expiresAt.getTime() <= preparedAt.getTime()) return false;
    boundedText(request.adapterId, MAX_ID_LENGTH, "pre_execution_adapter_id");
    boundedText(request.expectedResourceStateToken, MAX_TOKEN_LENGTH, "pre_execution_state_token");
    boundedText(request.sessionId, MAX_ID_LENGTH, "pre_execution_session_id");
  } catch {
    return false;
  }
  const { binding, ...payload } = request;
  return binding === preExecutionBinding(payload);
}

/**
 * Final optimistic TOCTOU check immediately before a real adapter call.
 * A changed token, target, or adapter fails closed.
 */
export function assertResourceStateUnchanged(
  request: PreExecutionRequest,
  currentState: ResourceStateSnapshot,
  now = new Date(),
): void {
  if (!verifyPreExecutionRequest(request)) throw new Error("pre_execution_binding_mismatch");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs >= new Date(request.expiresAt).getTime()) throw new Error("pre_execution_expired");
  assertResourceStateFresh(currentState, now);
  if (currentState.adapterId !== request.adapterId) throw new Error("resource_adapter_changed");
  if (currentState.target !== request.proposal.target) throw new Error("resource_target_changed");
  if (currentState.stateToken !== request.expectedResourceStateToken) {
    throw new Error("resource_state_changed_since_preparation");
  }
}

export type ExecutionOutcome = "SUCCEEDED" | "FAILED" | "UNKNOWN";

export interface ExecutionReceipt {
  version: typeof EXECUTION_RECEIPT_VERSION;
  trust: "UNAUTHENTICATED_EXECUTION_RECEIPT";
  receiptId: string;
  preExecutionBinding: string;
  proposalBinding: string;
  adapterId: string;
  executorId: string;
  principal: NorthstarPrincipal;
  sessionId: string;
  resourceStateBeforeBinding: string;
  resourceStateBeforeToken: string;
  outcome: ExecutionOutcome;
  startedAt: string;
  completedAt: string;
  resultRef?: string;
  errorCode?: string;
  binding: string;
}

export interface RecordExecutionReceiptInput {
  receiptId: string;
  executorId: string;
  outcome: ExecutionOutcome;
  startedAt: string;
  completedAt: string;
  resultRef?: string;
  errorCode?: string;
}

function executionReceiptBinding(
  receipt: Omit<ExecutionReceipt, "binding">,
): string {
  return canonicalString(receipt);
}

/**
 * Records what a caller reports happened after the final state check. This is an
 * evidence contract, not proof of real execution: executor identity and receipt
 * persistence remain unauthenticated until a production adapter signs/persists them.
 */
export function recordExecutionReceipt(
  request: PreExecutionRequest,
  currentState: ResourceStateSnapshot,
  input: RecordExecutionReceiptInput,
): ExecutionReceipt {
  const startedAt = parseIsoInstant(input.startedAt, "execution_started_at");
  const completedAt = parseIsoInstant(input.completedAt, "execution_completed_at");
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new TypeError("execution_negative_duration");
  }
  if (startedAt.getTime() < new Date(request.preparedAt).getTime()) {
    throw new Error("execution_predates_preparation");
  }

  assertResourceStateUnchanged(request, currentState, startedAt);

  if (input.outcome === "SUCCEEDED" && input.errorCode !== undefined) {
    throw new TypeError("successful_receipt_cannot_have_error_code");
  }
  if (input.outcome !== "SUCCEEDED" && input.resultRef !== undefined && input.resultRef.trim().length === 0) {
    throw new TypeError("execution_result_ref_empty");
  }

  const payload: Omit<ExecutionReceipt, "binding"> = {
    version: EXECUTION_RECEIPT_VERSION,
    trust: "UNAUTHENTICATED_EXECUTION_RECEIPT",
    receiptId: boundedText(input.receiptId, MAX_ID_LENGTH, "receipt_id"),
    preExecutionBinding: request.binding,
    proposalBinding: request.proposalBinding,
    adapterId: request.adapterId,
    executorId: boundedText(input.executorId, MAX_ID_LENGTH, "executor_id"),
    principal: request.principal,
    sessionId: request.sessionId,
    resourceStateBeforeBinding: currentState.binding,
    resourceStateBeforeToken: currentState.stateToken,
    outcome: input.outcome,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    ...(input.resultRef === undefined
      ? {}
      : { resultRef: boundedText(input.resultRef, MAX_REF_LENGTH, "execution_result_ref") }),
    ...(input.errorCode === undefined
      ? {}
      : { errorCode: boundedText(input.errorCode, MAX_ID_LENGTH, "execution_error_code") }),
  };

  return { ...payload, binding: executionReceiptBinding(payload) };
}

export function verifyExecutionReceipt(receipt: ExecutionReceipt): boolean {
  if (typeof receipt !== "object" || receipt === null) return false;
  if (receipt.version !== EXECUTION_RECEIPT_VERSION) return false;
  if (receipt.trust !== "UNAUTHENTICATED_EXECUTION_RECEIPT") return false;
  try {
    boundedText(receipt.receiptId, MAX_ID_LENGTH, "receipt_id");
    boundedText(receipt.executorId, MAX_ID_LENGTH, "executor_id");
    boundedText(receipt.sessionId, MAX_ID_LENGTH, "receipt_session_id");
    const startedAt = parseIsoInstant(receipt.startedAt, "execution_started_at");
    const completedAt = parseIsoInstant(receipt.completedAt, "execution_completed_at");
    if (completedAt.getTime() < startedAt.getTime()) return false;
    if (receipt.outcome === "SUCCEEDED" && receipt.errorCode !== undefined) return false;
  } catch {
    return false;
  }
  const { binding, ...payload } = receipt;
  return binding === executionReceiptBinding(payload);
}
