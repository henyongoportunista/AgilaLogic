export { decide } from "./orchestrator.js";
export { GAGAMBA_WEAVE_VERSION, weaveSignals } from "./gagamba.js";
export type {
  GagambaAcceptedSignal,
  GagambaIntake,
  GagambaObservation,
  GagambaSignal,
  GagambaSignalKind,
  GagambaTrace,
  GagambaWeaveResult,
  ProvenanceEnvelope,
  ProvenanceSourceClass,
} from "./gagamba.js";
export {
  ARCHITECT_ENGINEER_PAIRS,
  ARCHITECT_ENGINEER_STRAND_VERSION,
  architectureBinding,
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
  runHtMtStrand,
  verifyArchitecturePacket,
  verifyEngineeringPacket,
} from "./strand.js";
export type {
  ActionProposalMetadata,
  AgilaEngineerId,
  ArchitectEngineerPair,
  ArchitectureIntentEnvelope,
  ArchitecturePacket,
  EngineeringIntent,
  EngineeringPacket,
  GagambaArchitectId,
  HtArchitectureInput,
  HtMtStrandResult,
  MtEngineerResult,
  UntrustedSabProposalCandidate,
} from "./strand.js";
export {
  TRUST_SPINE_VERSION,
  assertPacketLifecycleFresh,
  bindArchitectureLifecycle,
  bindEngineeringLifecycle,
  buildProvenanceLedger,
  compareAdapterAttestation,
  continueRfi,
  expireRfi,
  normalizePacketLifecycle,
  openRfi,
  resolveRfi,
  verifyBoundArchitectureState,
  verifyBoundEngineeringState,
  verifyRfiLifecycle,
} from "./trust.js";
export type {
  AdapterAttestation,
  AdapterAttestationComparison,
  AdapterMatchedProposalCandidate,
  AttestedCost,
  AttestedOperation,
  BoundArchitectureState,
  BoundEngineeringState,
  OpenRfiInput,
  PacketLifecycle,
  ProvenanceLedger,
  ProvenanceLedgerEntry,
  RfiLifecycle,
  RfiOwner,
  RfiStatus,
} from "./trust.js";
export {
  PROVENANCE_INTEGRITY_VERSION,
  bindProvenanceLedger,
  provenanceLedgerBinding,
  verifyProvenanceIntegrity,
} from "./provenance-integrity.js";
export type { ProvenanceIntegrityEnvelope } from "./provenance-integrity.js";
export {
  PROVENANCE_ATTESTATION_VERSION,
  assertProvenanceAttestationFresh,
  bindProvenanceAttestation,
  provenanceAttestationMatchesEntry,
  verifyProvenanceAttestation,
} from "./provenance-attestation.js";
export type {
  BindProvenanceAttestationInput,
  ProvenanceAttestation,
} from "./provenance-attestation.js";
export {
  MAX_LIFECYCLE_ENTRIES_PER_CONTEXT,
  REPLAY_GUARD_VERSION,
  assertArchitectureStateActive,
  assertEngineeringStateActive,
  createLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
} from "./replay.js";
export type {
  LifecycleKind,
  LifecycleRegistry,
  LifecycleRegistryEntry,
} from "./replay.js";
export {
  LIFECYCLE_STORE_VERSION,
  assertPersistedArchitectureStateActive,
  assertPersistedLifecyclePairActive,
  assertPersistedEngineeringStateActive,
  assertStoredLifecycleRegistry,
  createInMemoryLifecycleRegistryStore,
  persistArchitectureState,
  persistEngineeringState,
} from "./replay-store.js";
export type {
  LifecycleRegistryStore,
  LifecycleStorageClass,
  StoredLifecycleRegistry,
} from "./replay-store.js";
export {
  SUPABASE_REPLAY_STORE_VERSION,
  createSupabaseLifecycleRegistryStore,
} from "./supabase-replay-store.js";
export type { SupabaseReplayStoreConfig } from "./supabase-replay-store.js";
export { RFI_RESOLUTION_VERSION, prepareRfiReinjection } from "./rfi-resolution.js";
export type {
  RfiReinjection,
  RfiResolutionInput,
  RfiResolutionKind,
} from "./rfi-resolution.js";
export {
  NORTHSTAR_IMMUTABLE_PRINCIPLES,
  NORTHSTAR_ROLE_CONTRACTS,
  NORTHSTAR_VERSION,
  assertNorthstarContextFresh,
  compileNorthstarContext,
  getTrustedNorthstarAuthentication,
  verifyNorthstarContextPack,
} from "./northstar.js";
export type {
  CompileNorthstarContextInput,
  NorthstarAuthorityCeiling,
  NorthstarContextPack,
  NorthstarKnowledgeClass,
  NorthstarLane,
  NorthstarPrincipal,
  NorthstarRoleContract,
  NorthstarRoleId,
  PrincipalContext,
  PrincipalVerification,
} from "./northstar.js";
export {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createProductionAuthVerifierRegistry,
  createTestAuthVerifierRegistry,
  createPublicPrincipalContext,
  getTrustedPrincipalAuthentication,
  isExternallyVerifiedPrincipalContext,
  resolveVerifiedPrincipalContext,
} from "./external-auth.js";
export type {
  AuthenticationAssurance,
  AuthRuntimeMode,
  AuthVerifierRegistry,
  ExternalAuthEvidence,
  ExternalPrincipalVerifier,
  ExternalSessionVerification,
  RejectedExternalSession,
  VerifiedExternalSession,
  VerifiedOperatorPrincipal,
  VerifiedPrincipalContext,
  TrustedPrincipalAuthentication,
} from "./external-auth.js";
export { MAX_PROVENANCE_ATTESTATIONS, TRUST_ADMISSION_VERSION, admitForSab } from "./admission.js";
export type {
  SabAdmissibleCandidate,
  TrustAdmissionInput,
  TrustAdmissionResult,
} from "./admission.js";
export {
  EXECUTION_RECEIPT_VERSION,
  PRE_EXECUTION_VERSION,
  assertExecutionPreconditionsUnchanged,
  assertResourceStateFresh,
  assertResourceStateUnchanged,
  bindApprovalToNorthstar,
  createConsentOperationBinding,
  createResourceStateSnapshot,
  preparePreExecution,
  recordExecutionReceipt,
  verifyExecutionReceipt,
  verifyPreExecutionRequest,
  verifyResourceStateSnapshot,
  verifySessionBoundApproval,
} from "./execution.js";
export type {
  ConsentBindingInput,
  CreateResourceStateSnapshotInput,
  ExecutionOutcome,
  ExecutionPreconditionCheckInput,
  ExecutionReceipt,
  PreExecutionRequest,
  PreparePreExecutionInput,
  RecordExecutionReceiptInput,
  ResourceStateSnapshot,
  SessionBoundApproval,
} from "./execution.js";
export {
  ASSURANCE_POLICY_VERSION,
  assertAuthenticationAssurance,
  requiredAuthenticationAssurance,
} from "./assurance-policy.js";
export {
  HUMAN_CONSENT_VERSION,
  MAX_CONSENT_CHALLENGES,
  MAX_HUMAN_CONSENT_TTL_MS,
  createProductionHumanConsentAuthority,
  createTestHumanConsentAuthority,
  getHumanConsentAuthorityMode,
} from "./human-consent.js";
export type {
  HumanConsentAuthority,
  HumanConsentChallenge,
  HumanConsentEvidence,
  HumanConsentReceipt,
  HumanConsentTransaction,
  HumanConsentVerification,
  HumanConsentVerifier,
  PrincipalConsentCapability,
} from "./human-consent.js";
export { createSupabaseAdapter, toAgentPolicy } from "./supabase.js";
export * from "./types.js";
export type {
  AgentRow,
  EventInboxRow,
  RecordedDecisionRow,
  SupabaseRuntimeConfig,
} from "./supabase.js";
