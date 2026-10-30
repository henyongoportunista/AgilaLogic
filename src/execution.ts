import { admitForSab, type TrustAdmissionInput } from "./admission.js";
import {
  assertNorthstarContextFresh,
  getTrustedNorthstarAuthentication,
  verifyNorthstarContextPack,
  type NorthstarContextPack,
  type NorthstarPrincipal,
} from "./northstar.js";
import {
  assertPersistedLifecyclePairActive,
  type LifecycleRegistryStore,
} from "./replay-store.js";
import {
  SAB_POLICY_VERSION,
  evaluateProposal,
  isExecutionAuthorized,
  proposalBinding,
  type ActionProposal,
  type ApprovalRecord,
  type SabRoute,
} from "./sab.js";
import type { BoundArchitectureState, BoundEngineeringState } from "./trust.js";
import type { AuthRuntimeMode } from "./external-auth.js";
import { assertAuthenticationAssurance } from "./assurance-policy.js";
import {
  getHumanConsentAuthorityMode,
  type HumanConsentAuthority,
  type HumanConsentReceipt,
  type HumanConsentTransaction,
} from "./human-consent.js";

export const PRE_EXECUTION_VERSION = "2026-10-25.3" as const;
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
  consentId: string;
  consentBinding: string;
  operationBinding: string;
  runtimeMode: AuthRuntimeMode;
  binding: string;
}

export interface ConsentBindingInput {
  authority: HumanConsentAuthority;
  receipt: HumanConsentReceipt;
  operationBinding: string;
}

interface BoundConsent {
  authority: HumanConsentAuthority;
  receipt: HumanConsentReceipt;
  binding: string;
  runtimeMode: AuthRuntimeMode;
}
const boundConsents = new WeakMap<object, Readonly<BoundConsent>>();
const issuedPreparations = new WeakMap<object, {
  binding: string;
  runtimeMode: AuthRuntimeMode;
  finalCheckConsumed: boolean;
}>();

function assertRuntimeMode(mode: AuthRuntimeMode): void {
  if (mode !== "production" && mode !== "test") throw new Error("execution_runtime_mode_invalid");
}

/**
 * Exact operation context requested for consent, not an attestation or signature.
 * The same value is recomputed from admitted state immediately before preparation.
 */
export function createConsentOperationBinding(
  input: Pick<PreparePreExecutionInput, "admission" | "resourceState">,
): string {
  if (!verifyResourceStateSnapshot(input.resourceState)) {
    throw new Error("resource_state_binding_mismatch");
  }
  return canonicalString({
    proposalBinding: proposalBinding(input.admission.expectation.proposal),
    architectureTrustBinding: input.admission.architectureState.trustBinding,
    engineeringTrustBinding: input.admission.engineeringState.trustBinding,
    adapterId: input.admission.attestation.adapterId,
    resourceStateBinding: input.resourceState.binding,
    resourceStateToken: input.resourceState.stateToken,
    policyVersion: SAB_POLICY_VERSION,
  });
}

function consentTransaction(proposal: ActionProposal, operationBinding: string): HumanConsentTransaction {
  return { proposal, operationBinding, policyVersion: SAB_POLICY_VERSION };
}

function assertApprovalAssurance(
  proposal: ActionProposal,
  context: NorthstarContextPack,
  mode: AuthRuntimeMode,
): void {
  assertRuntimeMode(mode);
  const authentication = getTrustedNorthstarAuthentication(context);
  if (!authentication) throw new Error("human_approval_requires_external_auth_stamp");
  if (authentication.mode !== mode) throw new Error("human_approval_runtime_mode_mismatch");
  assertAuthenticationAssurance(proposal, authentication.assurance);
}

function sessionApprovalBinding(
  approval: Omit<SessionBoundApproval, "binding">,
): string {
  return canonicalString(approval);
}

/**
 * A SAB record and authenticated session are insufficient: require an independently
 * issued exact-transaction receipt. This check does not consume it; preparation
 * consumes after all policy, lifecycle, resource and session rechecks succeed.
 */
export function bindApprovalToNorthstar(
  proposal: ActionProposal,
  approval: ApprovalRecord,
  northstarContext: NorthstarContextPack,
  now = new Date(),
  consent?: ConsentBindingInput,
  mode: AuthRuntimeMode = "production",
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
  if (approval.approved !== true || approval.proposalId !== proposal.id ||
      approval.proposalBinding !== proposalBinding(proposal) ||
      approval.policyVersion !== SAB_POLICY_VERSION || !isExecutionAuthorized(proposal, approval, now)) {
    throw new Error("sab_approval_not_authorized");
  }
  if (approval.approvedBy !== northstarContext.principal) {
    throw new Error("approval_principal_mismatch");
  }
  assertApprovalAssurance(proposal, northstarContext, mode);
  if (!consent || !consent.receipt) throw new Error("human_consent_receipt_required");
  if (getHumanConsentAuthorityMode(consent.authority) !== mode) {
    throw new Error("human_consent_authority_mode_mismatch");
  }
  if (!consent.authority.verifyReceipt(
    consent.receipt, consentTransaction(proposal, consent.operationBinding), northstarContext, now,
  )) throw new Error("human_consent_receipt_invalid");
  if (approval.issuedAt !== consent.receipt.issuedAt || approval.expiresAt !== consent.receipt.expiresAt) {
    throw new Error("approval_consent_window_mismatch");
  }

  const payload: Omit<SessionBoundApproval, "binding"> = {
    version: PRE_EXECUTION_VERSION,
    approval: { ...approval },
    principal: northstarContext.principal,
    sessionId: northstarContext.sessionId,
    northstarContextBinding: northstarContext.contextBinding,
    consentId: consent.receipt.consentId,
    consentBinding: consent.receipt.binding,
    operationBinding: consent.operationBinding,
    runtimeMode: mode,
  };
  Object.freeze(payload.approval);
  const result = Object.freeze({ ...payload, binding: sessionApprovalBinding(payload) });
  boundConsents.set(result, Object.freeze({
    authority: consent.authority, receipt: consent.receipt, binding: result.binding, runtimeMode: mode,
  }));
  return result;
}

export function verifySessionBoundApproval(
  proposal: ActionProposal,
  approval: SessionBoundApproval,
  northstarContext: NorthstarContextPack,
  now = new Date(),
  operationBinding?: string,
  mode: AuthRuntimeMode = "production",
): boolean {
  try {
    if (typeof approval !== "object" || approval === null) return false;
    const consent = boundConsents.get(approval);
    if (!consent || consent.binding !== approval.binding || consent.runtimeMode !== mode) return false;
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
    if (approval.runtimeMode !== mode || approval.consentId !== consent.receipt.consentId) return false;
    if (approval.consentBinding !== consent.receipt.binding) return false;
    if (operationBinding !== undefined && approval.operationBinding !== operationBinding) return false;
    assertApprovalAssurance(proposal, northstarContext, mode);
    if (getHumanConsentAuthorityMode(consent.authority) !== mode) return false;
    if (!consent.authority.verifyReceipt(
      consent.receipt, consentTransaction(proposal, operationBinding ?? approval.operationBinding), northstarContext, now,
    )) return false;
    return isExecutionAuthorized(proposal, approval.approval, now);
  } catch { return false; }
}

export interface PreExecutionRequest {
  version: typeof PRE_EXECUTION_VERSION;
  trust: "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED";
  proposal: ActionProposal;
  proposalBinding: string;
  architectureTrustBinding: string;
  engineeringTrustBinding: string;
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
  runtimeMode: AuthRuntimeMode;
  consentId?: string;
  consentBinding?: string;
  binding: string;
}

function preExecutionBinding(
  request: Omit<PreExecutionRequest, "binding">,
): string {
  return canonicalString(request);
}

export interface PreparePreExecutionInput {
  admission: TrustAdmissionInput;
  lifecycleStore: LifecycleRegistryStore;
  resourceState: ResourceStateSnapshot;
  sessionBoundApproval?: SessionBoundApproval;
  now?: Date;
}

function snapshotClock(now: Date | undefined): Date | undefined {
  if (now === undefined) return undefined;
  let value: number;
  try { value = Date.prototype.getTime.call(now); }
  catch { throw new TypeError("invalid_now"); }
  if (!Number.isFinite(value)) throw new TypeError("invalid_now");
  return new Date(value);
}

/** Keep the stamped immutable identity; isolate all caller-owned transaction data. */
function snapshotPreparationInput(input: PreparePreExecutionInput): PreparePreExecutionInput {
  const { admission, lifecycleStore, resourceState, sessionBoundApproval, now } = input;
  const { northstarContext, now: _admissionClock, ...transaction } = admission;
  return {
    admission: {
      ...structuredClone(transaction),
      northstarContext: northstarContext.principal === "UNVERIFIED_PUBLIC"
        ? structuredClone(northstarContext)
        : northstarContext,
    },
    lifecycleStore,
    resourceState: structuredClone(resourceState),
    // Genuine bound approvals are frozen and privately stamped; cloning loses authority.
    sessionBoundApproval,
    now: snapshotClock(now),
  };
}

/**
 * Recomputes Trust Admission and requires both Architecture and Engineering
 * lifecycle states to be persisted and currently active. It then binds the
 * proposal to fresh resource state and, when required, to the exact approved
 * Northstar session.
 *
 * Output is still structurally unauthenticated and is not an execution command.
 */
export async function preparePreExecution(
  input: PreparePreExecutionInput,
  mode: AuthRuntimeMode = "production",
): Promise<PreExecutionRequest> {
  assertRuntimeMode(mode);
  input = snapshotPreparationInput(input);
  const initialNow = input.now ?? new Date();
  if (!Number.isFinite(initialNow.getTime())) throw new TypeError("invalid_now");

  await assertPersistedLifecyclePairActive(
    input.lifecycleStore,
    input.admission.architectureState,
    input.admission.engineeringState,
  );

  // External store latency must not preserve a stale default-clock authority
  // window. An explicitly supplied fixture clock remains deterministic.
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

  const operationBinding = createConsentOperationBinding(input);
  let consent: Readonly<BoundConsent> | undefined;
  if (decision.route === "REQUIRE_HUMAN_APPROVAL") {
    if (!input.sessionBoundApproval) throw new Error("human_approval_required");
    assertApprovalAssurance(proposal, northstar, mode);
    if (!verifySessionBoundApproval(proposal, input.sessionBoundApproval, northstar, now, operationBinding, mode)) {
      throw new Error("session_bound_approval_invalid");
    }
    consent = boundConsents.get(input.sessionBoundApproval);
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
    architectureTrustBinding: input.admission.architectureState.trustBinding,
    engineeringTrustBinding: input.admission.engineeringState.trustBinding,
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
    runtimeMode: mode,
    ...(consent ? { consentId: consent.receipt.consentId, consentBinding: consent.receipt.binding } : {}),
  };

  // No await follows consumption: concurrent prepares can consume this receipt
  // only once in this process. No side effect is performed by this boundary.
  if (consent) consent.authority.consumeReceipt(
    consent.receipt, consentTransaction(proposal, operationBinding), northstar, now,
  );
  Object.freeze(payload.proposal);
  const prepared = Object.freeze({ ...payload, binding: preExecutionBinding(payload) });
  issuedPreparations.set(prepared, { binding: prepared.binding, runtimeMode: mode, finalCheckConsumed: false });
  return prepared;
}

export function verifyPreExecutionRequest(request: PreExecutionRequest): boolean {
  try {
    if (typeof request !== "object" || request === null) return false;
    if (request.version !== PRE_EXECUTION_VERSION) return false;
    if (request.trust !== "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED") return false;
    if (request.policyVersion !== SAB_POLICY_VERSION) return false;
    if ((request.sabRoute as SabRoute) === "DENY") return false;
    assertRuntimeMode(request.runtimeMode);
    const decision = evaluateProposal(request.proposal);
    if (decision.route !== request.sabRoute) return false;
    // Every route must originate from recomputed Trust Admission. A caller
    // cannot lower a declared SAB route and forge a new public JSON binding.
    const issued = issuedPreparations.get(request);
    if (!issued || issued.binding !== request.binding || issued.runtimeMode !== request.runtimeMode) return false;
    if (decision.route === "REQUIRE_HUMAN_APPROVAL") {
      if (!request.consentId || !request.consentBinding) return false;
    }
    if (request.proposalBinding !== proposalBinding(request.proposal)) return false;
    try {
      const preparedAt = parseIsoInstant(request.preparedAt, "pre_execution_prepared_at");
      const expiresAt = parseIsoInstant(request.expiresAt, "pre_execution_expires_at");
      if (expiresAt.getTime() <= preparedAt.getTime()) return false;
      boundedText(request.architectureTrustBinding, MAX_REF_LENGTH, "pre_execution_architecture_binding");
      boundedText(request.engineeringTrustBinding, MAX_REF_LENGTH, "pre_execution_engineering_binding");
      boundedText(request.adapterId, MAX_ID_LENGTH, "pre_execution_adapter_id");
      boundedText(request.expectedResourceStateBinding, MAX_REF_LENGTH, "pre_execution_resource_binding");
      boundedText(request.expectedResourceStateToken, MAX_TOKEN_LENGTH, "pre_execution_state_token");
      boundedText(request.sessionId, MAX_ID_LENGTH, "pre_execution_session_id");
    } catch {
      return false;
    }
    const { binding, ...payload } = request;
    return binding === preExecutionBinding(payload);
  } catch { return false; }
}

/**
 * Low-level resource-only optimistic TOCTOU check.
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
  if (currentState.binding !== request.expectedResourceStateBinding && currentState.stateToken !== request.expectedResourceStateToken) {
    throw new Error("resource_state_changed_since_preparation");
  }
  if (currentState.stateToken !== request.expectedResourceStateToken) {
    throw new Error("resource_state_changed_since_preparation");
  }
}

export interface ExecutionPreconditionCheckInput {
  request: PreExecutionRequest;
  lifecycleStore: LifecycleRegistryStore;
  architectureState: BoundArchitectureState;
  engineeringState: BoundEngineeringState;
  currentResourceState: ResourceStateSnapshot;
  now?: Date;
}

/**
 * Mandatory final recheck intended to run immediately before a future adapter
 * side effect. It closes the gap where a lifecycle could be superseded after
 * preparation but before the real operation begins.
 */
export async function assertExecutionPreconditionsUnchanged(
  input: ExecutionPreconditionCheckInput,
  mode: AuthRuntimeMode = "production",
): Promise<void> {
  // Preserve the exact issued request and copy caller-owned data before the first
  // await. Replacing fields or mutating nested aliases cannot change the check.
  input = {
    request: input.request,
    lifecycleStore: input.lifecycleStore,
    architectureState: structuredClone(input.architectureState),
    engineeringState: structuredClone(input.engineeringState),
    currentResourceState: structuredClone(input.currentResourceState),
    now: snapshotClock(input.now),
  };
  if (!verifyPreExecutionRequest(input.request)) {
    throw new Error("pre_execution_binding_mismatch");
  }
  if (input.architectureState.trustBinding !== input.request.architectureTrustBinding) {
    throw new Error("pre_execution_architecture_state_mismatch");
  }
  if (input.engineeringState.trustBinding !== input.request.engineeringTrustBinding) {
    throw new Error("pre_execution_engineering_state_mismatch");
  }

  await assertPersistedLifecyclePairActive(input.lifecycleStore, input.architectureState, input.engineeringState);
  const now = input.now ?? new Date();
  assertResourceStateUnchanged(input.request, input.currentResourceState, now);
  assertRuntimeMode(mode);
  if (input.request.runtimeMode !== mode) throw new Error("pre_execution_runtime_mode_mismatch");
  const issued = issuedPreparations.get(input.request);
  if (!issued || issued.binding !== input.request.binding) throw new Error("pre_execution_origin_unverified");
  if (issued.finalCheckConsumed) throw new Error("pre_execution_already_consumed");
  issued.finalCheckConsumed = true;
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
