/**
 * Safe-default runtime facade for future backend / n8n / adapter integration.
 *
 * This module intentionally exposes identity-resolved, replay-aware,
 * precondition-checked contracts while omitting the low-level raw receipt
 * constructor that accepts a caller-supplied executorId.
 *
 * Importing this facade does not create real authentication, execution authority,
 * durability, or cryptographic proof. Those properties depend on the configured
 * external providers/stores/adapters.
 */

export {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createPublicPrincipalContext,
  resolveVerifiedPrincipalContext,
} from "./external-auth.js";
export type {
  ExternalAuthEvidence,
  ExternalPrincipalVerifier,
  VerifiedPrincipalContext,
} from "./external-auth.js";

export {
  RUNTIME_IDENTITY_VERSION,
  assertResolvedRuntimeIdentityFresh,
  assertVerifiedAdapterAttestationFresh,
  bindAdapterAttestationToIdentity,
  resolveRuntimeIdentity,
} from "./runtime-identity.js";
export type {
  ResolvedRuntimeIdentity,
  RuntimeIdentityEvidence,
  RuntimeIdentityVerifier,
  VerifiedAdapterAttestation,
} from "./runtime-identity.js";

export {
  LIFECYCLE_STORE_VERSION,
  assertPersistedArchitectureStateActive,
  assertPersistedEngineeringStateActive,
  persistArchitectureState,
  persistEngineeringState,
} from "./replay-store.js";
export type {
  LifecycleRegistryStore,
  StoredLifecycleRegistry,
} from "./replay-store.js";

export {
  SUPABASE_REPLAY_STORE_VERSION,
  createSupabaseLifecycleRegistryStore,
} from "./supabase-replay-store.js";
export type { SupabaseReplayStoreConfig } from "./supabase-replay-store.js";

export { TRUST_ADMISSION_VERSION, admitForSab } from "./admission.js";
export type {
  SabAdmissibleCandidate,
  TrustAdmissionInput,
  TrustAdmissionResult,
} from "./admission.js";

export {
  PRE_EXECUTION_VERSION,
  assertExecutionPreconditionsUnchanged,
  bindApprovalToNorthstar,
  createResourceStateSnapshot,
  preparePreExecution,
  verifyPreExecutionRequest,
} from "./execution.js";
export type {
  ExecutionPreconditionCheckInput,
  PreExecutionRequest,
  PreparePreExecutionInput,
  ResourceStateSnapshot,
  SessionBoundApproval,
} from "./execution.js";

export {
  EXECUTION_EVIDENCE_VERSION,
  recordIdentityBoundExecutionReceipt,
  verifyIdentityBoundExecutionReceipt,
  verifyIdentityBoundReceiptAgainstLiveExecutor,
} from "./execution-evidence.js";
export type {
  IdentityBoundExecutionReceipt,
  IdentityBoundReceiptInput,
} from "./execution-evidence.js";

export {
  EXECUTION_ATTEMPT_VERSION,
  createExecutionAttemptClaim,
  createInMemoryExecutionAttemptStore,
  finalizeExecutionAttempt,
  reserveExecutionAttempt,
  verifyExecutionAttemptClaim,
} from "./execution-attempt.js";
export type {
  ExecutionAttemptClaim,
  ExecutionAttemptRecord,
  ExecutionAttemptStore,
  ExecutionAttemptStatus,
} from "./execution-attempt.js";

export {
  SUPABASE_EXECUTION_ATTEMPT_STORE_VERSION,
  createSupabaseExecutionAttemptStore,
} from "./supabase-execution-attempt-store.js";
export type { SupabaseExecutionAttemptStoreConfig } from "./supabase-execution-attempt-store.js";

export {
  RECEIPT_STORE_VERSION,
  createInMemoryExecutionReceiptStore,
  persistIdentityBoundExecutionReceipt,
} from "./receipt-store.js";
export type {
  ExecutionReceiptStore,
  ReceiptStorageClass,
} from "./receipt-store.js";

export {
  SUPABASE_RECEIPT_STORE_VERSION,
  createSupabaseExecutionReceiptStore,
} from "./supabase-receipt-store.js";
export type { SupabaseReceiptStoreConfig } from "./supabase-receipt-store.js";
