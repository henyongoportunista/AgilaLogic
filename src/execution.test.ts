import { weaveSignals } from "./gagamba.js";
import { compileNorthstarContext } from "./northstar.js";
import { proposalBinding, SAB_POLICY_VERSION, type ApprovalRecord } from "./sab.js";
import {
  ARCHITECT_ENGINEER_STRAND_VERSION,
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
  type ArchitectureIntentEnvelope,
} from "./strand.js";
import {
  TRUST_SPINE_VERSION,
  bindArchitectureLifecycle,
  bindEngineeringLifecycle,
  buildProvenanceLedger,
  type AdapterAttestation,
  type PacketLifecycle,
} from "./trust.js";
import {
  assertResourceStateUnchanged,
  bindApprovalToNorthstar,
  createResourceStateSnapshot,
  preparePreExecution,
  recordExecutionReceipt,
  verifyExecutionReceipt,
  verifyPreExecutionRequest,
} from "./execution.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try {
    fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const weave = weaveSignals({
  signals: [
    {
      id: "execution-fact-1",
      kind: "FACT",
      text: "The staging customer resource is available.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "fixture-resource-observer",
        observedAt: "2026-10-25T06:15:00.000Z",
        sourceRef: "fixture://staging/customer",
        evidenceRef: "evidence://staging/customer/1",
      },
    },
  ],
  candidates: [
    {
      id: "execution-candidate",
      value: 0.9,
      timing: 0.8,
      confidence: 0.9,
      cost: 0.1,
      risk: 0.2,
      reversibility: 0.9,
      informationGain: 0.5,
    },
  ],
});

const envelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["WRITE"],
  allowedScopes: ["STAGING"],
  allowedDataSensitivities: ["SENSITIVE"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 5,
  maxEstimatedCost: 1,
};

const architecture = htArchitect({
  packetId: "execution-architecture",
  objective: "Prepare a bounded staging write with human authorization.",
  weave,
  successCriteria: ["State remains unchanged between preparation and execution."],
  nonGoals: ["No production mutation."],
  intentEnvelope: envelope,
});

const architectureLifecycle: PacketLifecycle = {
  lifecycleId: "execution-architecture-life",
  contextId: "execution-context",
  issuedAt: "2026-10-25T06:20:00.000Z",
  expiresAt: "2026-10-25T07:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundArchitecture = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle,
  new Date("2026-10-25T06:25:00.000Z"),
);

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "execution-engineering",
);
assert(engineering.intent === "PROPOSAL_ONLY", "fixture must yield a proposal");

const engineeringLifecycle: PacketLifecycle = {
  lifecycleId: "execution-engineering-life",
  contextId: "execution-context",
  issuedAt: "2026-10-25T06:26:00.000Z",
  expiresAt: "2026-10-25T06:55:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundEngineering = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle,
  boundArchitecture,
  new Date("2026-10-25T06:27:00.000Z"),
);

const expectation = draftUntrustedSabProposal(engineering, "execution-proposal", {
  type: "WRITE",
  scope: "STAGING",
  target: "staging.customer.42",
  reversible: true,
  dataSensitivity: "SENSITIVE",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
});

const northstarContext = compileNorthstarContext({
  roleId: "MT",
  principalContext: {
    principal: "VERIFIED_SAL",
    verification: "EXTERNAL_AUTH",
    sessionId: "external-session-sal-1",
    issuedAt: "2026-10-25T06:00:00.000Z",
    expiresAt: "2026-10-25T07:00:00.000Z",
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC", "INTERNAL"],
  now: new Date("2026-10-25T06:25:00.000Z"),
});

const attestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "execution-operation-attestation",
  requestId: engineering.packetId,
  proposalId: expectation.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "staging-adapter-contract",
  observedAt: "2026-10-25T06:30:00.000Z",
  expiresAt: "2026-10-25T06:50:00.000Z",
  operation: {
    type: "WRITE",
    scope: "STAGING",
    target: "staging.customer.42",
    reversible: true,
    dataSensitivity: "SENSITIVE",
    affectedRecords: 1,
    estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" },
    containsSecrets: false,
  },
};

const admissionInput = {
  provenanceLedger: buildProvenanceLedger(weave),
  architectureState: boundArchitecture,
  engineeringState: boundEngineering,
  northstarContext,
  expectation,
  attestation,
};

const approval: ApprovalRecord = {
  proposalId: expectation.proposal.id,
  proposalBinding: proposalBinding(expectation.proposal),
  approved: true,
  approvedBy: "VERIFIED_SAL",
  issuedAt: "2026-10-25T06:34:00.000Z",
  expiresAt: "2026-10-25T06:40:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const sessionApproval = bindApprovalToNorthstar(
  expectation.proposal,
  approval,
  northstarContext,
  new Date("2026-10-25T06:35:00.000Z"),
);

const initialResourceState = createResourceStateSnapshot({
  adapterId: "staging-adapter-contract",
  target: "staging.customer.42",
  stateToken: "etag-customer-42-v7",
  observedAt: "2026-10-25T06:33:00.000Z",
  expiresAt: "2026-10-25T06:45:00.000Z",
});

const prepared = preparePreExecution({
  admission: admissionInput,
  resourceState: initialResourceState,
  sessionBoundApproval: sessionApproval,
  now: new Date("2026-10-25T06:35:00.000Z"),
});

assert(
  prepared.trust === "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED",
  "pre-execution must not claim authenticated execution authority",
);
assert(verifyPreExecutionRequest(prepared), "prepared request must verify");
assert(prepared.sabRoute === "REQUIRE_HUMAN_APPROVAL", "sensitive staging write must retain human approval route");
assert(prepared.expiresAt === approval.expiresAt, "shortest trust window must bound pre-execution lifetime");

{
  throwsWith(
    () => preparePreExecution({
      admission: admissionInput,
      resourceState: initialResourceState,
      now: new Date("2026-10-25T06:35:00.000Z"),
    }),
    "human_approval_required",
    "approval-required proposal must not prepare without session-bound approval",
  );
}

const unchangedResourceState = createResourceStateSnapshot({
  adapterId: "staging-adapter-contract",
  target: "staging.customer.42",
  stateToken: "etag-customer-42-v7",
  observedAt: "2026-10-25T06:36:00.000Z",
  expiresAt: "2026-10-25T06:39:30.000Z",
});
assertResourceStateUnchanged(prepared, unchangedResourceState, new Date("2026-10-25T06:37:00.000Z"));

{
  const changedResourceState = createResourceStateSnapshot({
    adapterId: "staging-adapter-contract",
    target: "staging.customer.42",
    stateToken: "etag-customer-42-v8",
    observedAt: "2026-10-25T06:36:00.000Z",
    expiresAt: "2026-10-25T06:39:30.000Z",
  });
  throwsWith(
    () => assertResourceStateUnchanged(prepared, changedResourceState, new Date("2026-10-25T06:37:00.000Z")),
    "resource_state_changed_since_preparation",
    "changed resource token must fail closed before adapter execution",
  );
}

{
  const brokenLedger = {
    ...admissionInput.provenanceLedger,
    entries: admissionInput.provenanceLedger.entries.map((entry) => ({ ...entry, provenance: null })),
    provenanceGapSignalIds: ["execution-fact-1"],
  };
  throwsWith(
    () => preparePreExecution({
      admission: { ...admissionInput, provenanceLedger: brokenLedger },
      resourceState: initialResourceState,
      sessionBoundApproval: sessionApproval,
      now: new Date("2026-10-25T06:35:00.000Z"),
    }),
    "trust_admission_failed",
    "pre-execution must recompute Trust Admission instead of trusting a label",
  );
}

const receipt = recordExecutionReceipt(prepared, unchangedResourceState, {
  receiptId: "execution-receipt-1",
  executorId: "mock-executor-contract",
  outcome: "SUCCEEDED",
  startedAt: "2026-10-25T06:37:00.000Z",
  completedAt: "2026-10-25T06:37:01.000Z",
  resultRef: "fixture://execution/result/1",
});
assert(receipt.trust === "UNAUTHENTICATED_EXECUTION_RECEIPT", "receipt must not claim authenticated evidence");
assert(verifyExecutionReceipt(receipt), "receipt binding must verify");

{
  const tampered = { ...receipt, outcome: "FAILED" as const };
  assert(!verifyExecutionReceipt(tampered), "mutated receipt must fail deterministic binding verification");
}

console.log("pre-execution and receipt contract tests passed");
