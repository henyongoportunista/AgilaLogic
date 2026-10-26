import { admitForSab } from "./admission.js";
import {
  attachExecutionVerification,
  completeExecution,
  emptyExecutionLedger,
  reserveExecution,
  startExecution,
  verifyExecutionLedger,
} from "./execution-ledger.js";
import {
  bindExecutionReceipt,
  issueExecutionPermit,
} from "./execution.js";
import { bindExecutionVerification } from "./execution-verification.js";
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

const now = new Date("2026-10-25T11:30:00.000Z");
const weave = weaveSignals({
  signals: [
    {
      id: "ledger-fact",
      kind: "FACT",
      text: "The execution ledger fixture is readable.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "ledger-fixture",
        observedAt: "2026-10-25T11:10:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "ledger-read",
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
  packetId: "ledger-architecture",
  objective: "Read one bounded sandbox fixture with replay-safe bookkeeping.",
  weave,
  successCriteria: ["Reserve before start and preserve exact completion evidence."],
  nonGoals: ["No external mutation."],
  intentEnvelope: envelope,
});

const architectureLifecycle: PacketLifecycle = {
  lifecycleId: "ledger-architecture-life",
  contextId: "ledger-context",
  issuedAt: "2026-10-25T11:15:00.000Z",
  expiresAt: "2026-10-25T12:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundArchitecture = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle,
  new Date("2026-10-25T11:20:00.000Z"),
);

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "ledger-engineering",
);
assert(engineering.intent === "PROPOSAL_ONLY", "ledger fixture must produce proposal-only engineering");

const engineeringLifecycle: PacketLifecycle = {
  lifecycleId: "ledger-engineering-life",
  contextId: "ledger-context",
  issuedAt: "2026-10-25T11:21:00.000Z",
  expiresAt: "2026-10-25T11:58:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};
const boundEngineering = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle,
  boundArchitecture,
  new Date("2026-10-25T11:22:00.000Z"),
);

let lifecycleRegistry = emptyLifecycleRegistry();
lifecycleRegistry = registerArchitectureState(lifecycleRegistry, boundArchitecture);
lifecycleRegistry = registerEngineeringState(lifecycleRegistry, boundEngineering);

const expectation = draftUntrustedSabProposal(engineering, "ledger-proposal", {
  type: "READ",
  scope: "SANDBOX",
  target: "sandbox.execution_ledger_fixture",
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
    sessionId: "ledger-public-session",
    issuedAt: "2026-10-25T11:00:00.000Z",
    expiresAt: "2026-10-25T12:00:00.000Z",
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC"],
  now,
});

const provenanceLedger = buildProvenanceLedger(weave);
const factEntry = provenanceLedger.entries.find((entry) => entry.signalId === "ledger-fact");
assert(factEntry !== undefined, "ledger provenance entry must exist");
const sourceAttestation = bindProvenanceAttestation(factEntry, {
  attestationId: "ledger-source-attestation",
  verifierId: "ledger-source-verifier",
  verifiedAt: "2026-10-25T11:11:00.000Z",
  expiresAt: "2026-10-25T11:55:00.000Z",
});

const operationAttestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "ledger-operation-attestation",
  requestId: engineering.packetId,
  proposalId: expectation.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "ledger-read-adapter",
  observedAt: "2026-10-25T11:25:00.000Z",
  expiresAt: "2026-10-25T11:50:00.000Z",
  operation: {
    type: "READ",
    scope: "SANDBOX",
    target: "sandbox.execution_ledger_fixture",
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
assert(admission.admitted && admission.candidate !== undefined, "ledger fixture must be admitted");

const permit = issueExecutionPermit({
  permitId: "ledger-permit",
  executionId: "ledger-execution",
  candidate: admission.candidate,
  now,
});

let ledger = emptyExecutionLedger();
assert(verifyExecutionLedger(ledger), "empty execution ledger must verify");

ledger = reserveExecution(ledger, permit, now);
assert(ledger.entries[0]?.status === "RESERVED", "reservation must create RESERVED entry");
assert(verifyExecutionLedger(ledger), "reserved execution ledger must verify");

{
  throwsWith(
    () => reserveExecution(ledger, permit, now),
    "execution_id_already_reserved",
    "same execution identity must not be reserved twice",
  );
}

{
  const tampered = {
    ...ledger,
    entries: ledger.entries.map((entry) => ({ ...entry, status: "COMPLETED" as const })),
  };
  assert(!verifyExecutionLedger(tampered), "ledger mutation without rebinding must invalidate ledger");
}

{
  throwsWith(
    () => startExecution(ledger, permit, permit.expiresAt),
    "execution_started_after_permit_expiry",
    "execution must not start at permit expiry",
  );
}

const startedAt = "2026-10-25T11:30:10.000Z";
ledger = startExecution(ledger, permit, startedAt);
assert(ledger.entries[0]?.status === "STARTED", "valid start must advance ledger to STARTED");
assert(ledger.entries[0]?.startedAt === startedAt, "ledger must preserve exact execution start");
assert(verifyExecutionLedger(ledger), "started execution ledger must verify");

{
  throwsWith(
    () => startExecution(ledger, permit, "2026-10-25T11:30:11.000Z"),
    "execution_not_reservable_for_start",
    "started execution must not be started again",
  );
}

const mismatchedReceipt = bindExecutionReceipt(permit, {
  receiptId: "ledger-mismatched-receipt",
  executionId: permit.executionId,
  executorId: "ledger-executor",
  reportedProposal: { ...permit.proposal },
  startedAt: "2026-10-25T11:30:11.000Z",
  completedAt: "2026-10-25T11:30:20.000Z",
  outcome: "SUCCEEDED",
});

{
  throwsWith(
    () => completeExecution(ledger, mismatchedReceipt, permit),
    "execution_receipt_start_mismatch",
    "receipt must not complete a reservation with a different recorded start time",
  );
}

const receipt = bindExecutionReceipt(permit, {
  receiptId: "ledger-receipt",
  executionId: permit.executionId,
  executorId: "ledger-executor",
  reportedProposal: { ...permit.proposal },
  startedAt,
  completedAt: "2026-10-25T11:30:20.000Z",
  outcome: "SUCCEEDED",
  evidenceRef: "opaque:ledger-executor-evidence",
});

ledger = completeExecution(ledger, receipt, permit);
assert(ledger.entries[0]?.status === "COMPLETED", "matching receipt must advance ledger to COMPLETED");
assert(ledger.entries[0]?.receiptBinding === receipt.binding, "ledger must preserve exact receipt binding");
assert(ledger.entries[0]?.outcome === "SUCCEEDED", "ledger must preserve reported outcome without rewriting it");
assert(verifyExecutionLedger(ledger), "completed execution ledger must verify");

{
  throwsWith(
    () => completeExecution(ledger, receipt, permit),
    "execution_not_started",
    "completed execution must not accept a replayed completion",
  );
}

const verificationA = bindExecutionVerification(receipt, permit, {
  verificationId: "ledger-verification-a",
  verifierId: "ledger-independent-verifier-a",
  status: "CONFIRMED",
  observedOutcome: "SUCCEEDED",
  verifiedAt: "2026-10-25T11:30:30.000Z",
  evidenceRef: "opaque:ledger-verification-a",
});
ledger = attachExecutionVerification(ledger, verificationA, receipt, permit);
assert(ledger.entries[0]?.verifications.length === 1, "first verifier evidence must be appended");
assert(verifyExecutionLedger(ledger), "ledger with verification evidence must verify");

{
  throwsWith(
    () => attachExecutionVerification(ledger, verificationA, receipt, permit),
    "execution_verification_id_already_recorded",
    "same verification artifact must not be recorded twice",
  );
}

const verificationSameVerifier = bindExecutionVerification(receipt, permit, {
  verificationId: "ledger-verification-a-second",
  verifierId: "ledger-independent-verifier-a",
  status: "INCONCLUSIVE",
  verifiedAt: "2026-10-25T11:30:31.000Z",
  reason: "Second observation from same verifier should not count as another verifier.",
});
{
  throwsWith(
    () => attachExecutionVerification(ledger, verificationSameVerifier, receipt, permit),
    "execution_verifier_already_recorded",
    "one verifier identity must not create multiple apparent independent ledger votes",
  );
}

const verificationB = bindExecutionVerification(receipt, permit, {
  verificationId: "ledger-verification-b",
  verifierId: "ledger-independent-verifier-b",
  status: "INCONCLUSIVE",
  verifiedAt: "2026-10-25T11:30:32.000Z",
  reason: "Second verifier lacks enough independent evidence.",
});
ledger = attachExecutionVerification(ledger, verificationB, receipt, permit);
assert(ledger.entries[0]?.verifications.length === 2, "distinct verifier evidence should coexist without overwrite");
assert(ledger.entries[0]?.verifications[0]?.status === "CONFIRMED", "first verifier status must be preserved");
assert(ledger.entries[0]?.verifications[1]?.status === "INCONCLUSIVE", "second verifier status must remain separate");
assert(verifyExecutionLedger(ledger), "multi-verifier execution ledger must verify");

console.log("execution replay ledger tests passed");
