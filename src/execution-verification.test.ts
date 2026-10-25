import { admitForSab } from "./admission.js";
import {
  bindExecutionReceipt,
  issueExecutionPermit,
} from "./execution.js";
import {
  bindExecutionVerification,
  verifyExecutionVerification,
} from "./execution-verification.js";
import { weaveSignals } from "./gagamba.js";
import {
  emptyLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
} from "./lifecycle.js";
import { compileNorthstarContext } from "./northstar.js";
import { bindProvenanceAttestation } from "./provenance-attestation.js";
import { SAB_POLICY_VERSION } from "./sab.js";
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

const now = new Date("2026-10-25T10:30:00.000Z");
const weave = weaveSignals({
  signals: [
    {
      id: "verification-fact",
      kind: "FACT",
      text: "The verification fixture is readable.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "verification-fixture",
        observedAt: "2026-10-25T10:10:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "verification-read",
      value: 0.9,
      timing: 0.8,
      confidence: 0.9,
      cost: 0.05,
      risk: 0.05,
      reversibility: 1,
    },
  ],
});

const envelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["READ"],
  allowedScopes: ["SANDBOX"],
  allowedDataSensitivities: ["PUBLIC"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 0,
};

const architecture = htArchitect({
  packetId: "verification-architecture",
  objective: "Read one public sandbox verification fixture.",
  weave,
  successCriteria: ["Read only the bounded fixture."],
  nonGoals: ["No mutation."],
  intentEnvelope: envelope,
});

const architectureLifecycle: PacketLifecycle = {
  lifecycleId: "verification-architecture-life",
  contextId: "verification-context",
  issuedAt: "2026-10-25T10:15:00.000Z",
  expiresAt: "2026-10-25T11:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundArchitecture = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle,
  new Date("2026-10-25T10:20:00.000Z"),
);

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "verification-engineering",
);
assert(engineering.intent === "PROPOSAL_ONLY", "verification fixture must produce proposal-only engineering");

const engineeringLifecycle: PacketLifecycle = {
  lifecycleId: "verification-engineering-life",
  contextId: "verification-context",
  issuedAt: "2026-10-25T10:21:00.000Z",
  expiresAt: "2026-10-25T10:58:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundEngineering = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle,
  boundArchitecture,
  new Date("2026-10-25T10:22:00.000Z"),
);

let lifecycleRegistry = emptyLifecycleRegistry();
lifecycleRegistry = registerArchitectureState(lifecycleRegistry, boundArchitecture);
lifecycleRegistry = registerEngineeringState(lifecycleRegistry, boundEngineering);

const expectation = draftUntrustedSabProposal(engineering, "verification-proposal", {
  type: "READ",
  scope: "SANDBOX",
  target: "sandbox.verification_fixture",
  reversible: true,
  dataSensitivity: "PUBLIC",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
});

const northstarContext = compileNorthstarContext({
  roleId: "MT",
  principalContext: {
    principal: "UNVERIFIED_PUBLIC",
    verification: "PUBLIC_SESSION",
    sessionId: "verification-public-session",
    issuedAt: "2026-10-25T10:00:00.000Z",
    expiresAt: "2026-10-25T11:00:00.000Z",
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC"],
  now,
});

const provenanceLedger = buildProvenanceLedger(weave);
const factEntry = provenanceLedger.entries.find((entry) => entry.signalId === "verification-fact");
assert(factEntry !== undefined, "verification provenance entry must exist");
const sourceAttestation = bindProvenanceAttestation(factEntry, {
  attestationId: "verification-source-attestation",
  verifierId: "verification-source-verifier",
  verifiedAt: "2026-10-25T10:11:00.000Z",
  expiresAt: "2026-10-25T10:55:00.000Z",
});

const operationAttestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "verification-operation-attestation",
  requestId: engineering.packetId,
  proposalId: expectation.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "verification-read-adapter",
  observedAt: "2026-10-25T10:25:00.000Z",
  expiresAt: "2026-10-25T10:50:00.000Z",
  operation: {
    type: "READ",
    scope: "SANDBOX",
    target: "sandbox.verification_fixture",
    reversible: true,
    dataSensitivity: "PUBLIC",
    affectedRecords: 1,
    estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" },
    containsSecrets: false,
  },
};

const admission = admitForSab({
  provenanceLedger,
  provenanceAttestations: [sourceAttestation],
  lifecycleRegistry,
  architectureState: boundArchitecture,
  engineeringState: boundEngineering,
  northstarContext,
  expectation,
  attestation: operationAttestation,
  now,
});
assert(admission.admitted && admission.candidate !== undefined, "verification fixture must be structurally admitted");

const permit = issueExecutionPermit({
  permitId: "verification-permit",
  executionId: "verification-execution",
  candidate: admission.candidate,
  now,
});

const receipt = bindExecutionReceipt(permit, {
  receiptId: "verification-receipt",
  executionId: permit.executionId,
  executorId: "reported-executor",
  reportedProposal: { ...permit.proposal },
  startedAt: "2026-10-25T10:30:10.000Z",
  completedAt: "2026-10-25T10:30:20.000Z",
  outcome: "SUCCEEDED",
  evidenceRef: "opaque:executor-report",
});

{
  const verification = bindExecutionVerification(receipt, permit, {
    verificationId: "verification-confirmed",
    verifierId: "independent-verifier",
    status: "CONFIRMED",
    observedOutcome: "SUCCEEDED",
    verifiedAt: "2026-10-25T10:30:30.000Z",
    evidenceRef: "opaque:independent-success-evidence",
  });
  assert(verification.reportedOutcome === "SUCCEEDED", "verification must preserve executor-reported outcome");
  assert(verification.status === "CONFIRMED", "matching independent observation may confirm the report");
  assert(verifyExecutionVerification(verification, receipt, permit), "confirmed verification must verify structurally");
}

{
  const verification = bindExecutionVerification(receipt, permit, {
    verificationId: "verification-contradicted",
    verifierId: "independent-verifier",
    status: "CONTRADICTED",
    observedOutcome: "FAILED",
    verifiedAt: "2026-10-25T10:30:30.000Z",
    reason: "Independent evidence does not show the intended read outcome.",
  });
  assert(verification.reportedOutcome === "SUCCEEDED", "contradiction must not rewrite original receipt");
  assert(verification.observedOutcome === "FAILED", "contradicting observation must remain separate");
  assert(verifyExecutionVerification(verification, receipt, permit), "contradicted verification must remain valid evidence");
}

{
  const verification = bindExecutionVerification(receipt, permit, {
    verificationId: "verification-inconclusive",
    verifierId: "independent-verifier",
    status: "INCONCLUSIVE",
    verifiedAt: "2026-10-25T10:30:30.000Z",
    reason: "Evidence is insufficient to independently determine the result.",
  });
  assert(verification.observedOutcome === null, "inconclusive verification may carry no observed outcome");
  assert(verifyExecutionVerification(verification, receipt, permit), "inconclusive result must remain a valid non-success state");
}

{
  throwsWith(
    () => bindExecutionVerification(receipt, permit, {
      verificationId: "false-confirmation",
      verifierId: "independent-verifier",
      status: "CONFIRMED",
      observedOutcome: "FAILED",
      verifiedAt: "2026-10-25T10:30:30.000Z",
    }),
    "confirmed_verification_requires_matching_observed_outcome",
    "CONFIRMED must not be used when independent observation differs from the receipt",
  );
}

{
  throwsWith(
    () => bindExecutionVerification(receipt, permit, {
      verificationId: "false-contradiction",
      verifierId: "independent-verifier",
      status: "CONTRADICTED",
      observedOutcome: "SUCCEEDED",
      verifiedAt: "2026-10-25T10:30:30.000Z",
    }),
    "contradicted_verification_requires_different_observed_outcome",
    "CONTRADICTED must not be used when observation merely repeats the receipt",
  );
}

{
  throwsWith(
    () => bindExecutionVerification(receipt, permit, {
      verificationId: "predating-verification",
      verifierId: "independent-verifier",
      status: "INCONCLUSIVE",
      verifiedAt: "2026-10-25T10:30:19.000Z",
    }),
    "execution_verification_predates_completion",
    "independent verification must not predate reported execution completion",
  );
}

console.log("independent execution verification tests passed");
