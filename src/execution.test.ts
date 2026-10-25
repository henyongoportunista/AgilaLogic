import { admitForSab, type SabAdmissibleCandidate } from "./admission.js";
import {
  assertExecutionPermitFresh,
  bindExecutionReceipt,
  issueExecutionPermit,
  verifyExecutionPermit,
  verifyExecutionReceipt,
} from "./execution.js";
import { weaveSignals } from "./gagamba.js";
import {
  emptyLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
} from "./lifecycle.js";
import { compileNorthstarContext } from "./northstar.js";
import { bindProvenanceAttestation } from "./provenance-attestation.js";
import {
  SAB_POLICY_VERSION,
  proposalBinding,
  type ActionProposal,
  type ApprovalRecord,
} from "./sab.js";
import {
  ARCHITECT_ENGINEER_STRAND_VERSION,
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
  type ActionProposalMetadata,
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

const baseNow = new Date("2026-10-25T09:30:00.000Z");

function makeCandidate(
  suffix: string,
  metadata: ActionProposalMetadata,
  envelope: ArchitectureIntentEnvelope,
): SabAdmissibleCandidate {
  const weave = weaveSignals({
    signals: [
      {
        id: `fact-${suffix}`,
        kind: "FACT",
        text: `Execution fixture ${suffix} is available.`,
        provenance: {
          sourceClass: "TOOL_OBSERVED",
          producer: "execution-fixture",
          observedAt: "2026-10-25T09:10:00.000Z",
          sourceRef: `fixture://${suffix}`,
        },
      },
    ],
    candidates: [
      {
        id: `candidate-${suffix}`,
        value: 0.9,
        timing: 0.8,
        confidence: 0.9,
        cost: 0.1,
        risk: 0.1,
        reversibility: 0.9,
      },
    ],
  });

  const architecture = htArchitect({
    packetId: `architecture-${suffix}`,
    objective: `Prepare ${suffix} proposal.`,
    weave,
    successCriteria: ["Preserve exact operation semantics."],
    nonGoals: ["No operation outside the stated envelope."],
    intentEnvelope: envelope,
  });

  const architectureLifecycle: PacketLifecycle = {
    lifecycleId: `architecture-life-${suffix}`,
    contextId: `execution-context-${suffix}`,
    issuedAt: "2026-10-25T09:15:00.000Z",
    expiresAt: "2026-10-25T10:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  };
  const boundArchitecture = bindArchitectureLifecycle(
    architecture,
    architectureLifecycle,
    new Date("2026-10-25T09:20:00.000Z"),
  );

  const { engineering } = mtEngineer(
    architecture,
    { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
    `engineering-${suffix}`,
  );
  assert(engineering.intent === "PROPOSAL_ONLY", "execution fixture must produce proposal-only engineering");

  const engineeringLifecycle: PacketLifecycle = {
    lifecycleId: `engineering-life-${suffix}`,
    contextId: `execution-context-${suffix}`,
    issuedAt: "2026-10-25T09:21:00.000Z",
    expiresAt: "2026-10-25T09:58:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  };
  const boundEngineering = bindEngineeringLifecycle(
    engineering,
    engineeringLifecycle,
    boundArchitecture,
    new Date("2026-10-25T09:22:00.000Z"),
  );

  let lifecycleRegistry = emptyLifecycleRegistry();
  lifecycleRegistry = registerArchitectureState(lifecycleRegistry, boundArchitecture);
  lifecycleRegistry = registerEngineeringState(lifecycleRegistry, boundEngineering);

  const expectation = draftUntrustedSabProposal(
    engineering,
    `proposal-${suffix}`,
    metadata,
  );

  const northstarContext = compileNorthstarContext({
    roleId: "MT",
    principalContext: {
      principal: "UNVERIFIED_PUBLIC",
      verification: "PUBLIC_SESSION",
      sessionId: `public-session-${suffix}`,
      issuedAt: "2026-10-25T09:00:00.000Z",
      expiresAt: "2026-10-25T10:00:00.000Z",
    },
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC"],
    now: baseNow,
  });

  const provenanceLedger = buildProvenanceLedger(weave);
  const factEntry = provenanceLedger.entries.find((entry) => entry.signalId === `fact-${suffix}`);
  assert(factEntry !== undefined, "execution fixture provenance entry must exist");
  const provenanceAttestation = bindProvenanceAttestation(factEntry, {
    attestationId: `source-attestation-${suffix}`,
    verifierId: "execution-source-verifier",
    verifiedAt: "2026-10-25T09:11:00.000Z",
    expiresAt: "2026-10-25T09:55:00.000Z",
  });

  const adapterAttestation: AdapterAttestation = {
    version: TRUST_SPINE_VERSION,
    attestationId: `operation-attestation-${suffix}`,
    requestId: engineering.packetId,
    proposalId: expectation.proposal.id,
    engineeringBinding: engineering.engineeringBinding,
    policyVersion: SAB_POLICY_VERSION,
    adapterId: "future-execution-adapter",
    observedAt: "2026-10-25T09:25:00.000Z",
    expiresAt: "2026-10-25T09:50:00.000Z",
    operation: {
      type: metadata.type,
      scope: metadata.scope,
      target: metadata.target,
      reversible: metadata.reversible,
      dataSensitivity: metadata.dataSensitivity,
      ...(metadata.affectedRecords === undefined ? {} : { affectedRecords: metadata.affectedRecords }),
      ...(metadata.estimatedCost === undefined
        ? {}
        : { estimatedCost: { amount: metadata.estimatedCost, unit: "PROTOTYPE_SCALAR" as const } }),
      ...(metadata.containsSecrets === undefined ? {} : { containsSecrets: metadata.containsSecrets }),
    },
  };

  const result = admitForSab({
    provenanceLedger,
    provenanceAttestations: [provenanceAttestation],
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation: adapterAttestation,
    now: baseNow,
  });
  assert(result.admitted && result.candidate !== undefined, `execution fixture ${suffix} must admit`);
  return result.candidate;
}

const sandboxMetadata: ActionProposalMetadata = {
  type: "WRITE",
  scope: "SANDBOX",
  target: "sandbox.execution_fixture",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};
const sandboxEnvelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["WRITE"],
  allowedScopes: ["SANDBOX"],
  allowedDataSensitivities: ["INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 0,
};
const sandboxCandidate = makeCandidate("sandbox", sandboxMetadata, sandboxEnvelope);

{
  assert(sandboxCandidate.validUntil === "2026-10-25T09:50:00.000Z", "admission validity must use earliest dependency expiry");
  const permit = issueExecutionPermit({
    permitId: "permit-sandbox",
    candidate: sandboxCandidate,
    now: baseNow,
  });
  assert(permit.sabRoute === "ALLOW_WITH_LOG", "bounded sandbox write should retain SAB route");
  assert(verifyExecutionPermit(permit), "issued execution permit must verify structurally");
  assertExecutionPermitFresh(permit, new Date("2026-10-25T09:31:00.000Z"));

  const receipt = bindExecutionReceipt(permit, {
    receiptId: "receipt-sandbox",
    executionId: "execution-sandbox",
    executorId: "future-n8n-adapter",
    reportedProposal: { ...permit.proposal },
    startedAt: "2026-10-25T09:31:00.000Z",
    completedAt: "2026-10-25T09:31:05.000Z",
    outcome: "SUCCEEDED",
    evidenceRef: "opaque:execution-evidence-sandbox",
  });
  assert(receipt.trust === "EXECUTION_REPORTED_UNAUTHENTICATED_EXECUTOR", "receipt must not claim independent verification");
  assert(verifyExecutionReceipt(receipt, permit), "matching receipt must verify structurally against permit");

  const tamperedReceipt = { ...receipt, outcome: "FAILED" as const };
  assert(!verifyExecutionReceipt(tamperedReceipt, permit), "receipt outcome mutation must invalidate binding");

  throwsWith(
    () => bindExecutionReceipt(permit, {
      receiptId: "receipt-mismatch",
      executionId: "execution-mismatch",
      executorId: "future-n8n-adapter",
      reportedProposal: { ...permit.proposal, target: "production.other_target" },
      startedAt: "2026-10-25T09:31:00.000Z",
      completedAt: "2026-10-25T09:31:05.000Z",
      outcome: "SUCCEEDED",
    }),
    "execution_reported_operation_mismatch",
    "executor must not report a different operation under the same permit",
  );

  throwsWith(
    () => bindExecutionReceipt(permit, {
      receiptId: "receipt-late-start",
      executionId: "execution-late-start",
      executorId: "future-n8n-adapter",
      reportedProposal: { ...permit.proposal },
      startedAt: permit.expiresAt,
      completedAt: permit.expiresAt,
      outcome: "UNKNOWN",
    }),
    "execution_started_after_permit_expiry",
    "execution must not begin at or after permit expiry",
  );
}

const productionMetadata: ActionProposalMetadata = {
  type: "WRITE",
  scope: "PRODUCTION",
  target: "production.execution_fixture",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};
const productionEnvelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["WRITE"],
  allowedScopes: ["PRODUCTION"],
  allowedDataSensitivities: ["INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 0,
};
const productionCandidate = makeCandidate("production", productionMetadata, productionEnvelope);

{
  throwsWith(
    () => issueExecutionPermit({
      permitId: "permit-production-no-approval",
      candidate: productionCandidate,
      now: baseNow,
    }),
    "sab_execution_not_authorized",
    "production write must not receive a permit without required approval",
  );

  const approval: ApprovalRecord = {
    proposalId: productionCandidate.proposal.id,
    proposalBinding: proposalBinding(productionCandidate.proposal),
    approved: true,
    approvedBy: "prototype-node-alpha",
    issuedAt: "2026-10-25T09:29:00.000Z",
    expiresAt: "2026-10-25T09:40:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  };
  const permit = issueExecutionPermit({
    permitId: "permit-production-approved",
    candidate: productionCandidate,
    approval,
    now: baseNow,
  });
  assert(permit.sabRoute === "REQUIRE_HUMAN_APPROVAL", "production permit must preserve approval route");
  assert(permit.approvalSnapshotBinding !== null, "human-required permit must bind approval snapshot");
}

{
  const mutatedCandidate = {
    ...sandboxCandidate,
    proposal: { ...sandboxCandidate.proposal, target: "sandbox.mutated" },
  };
  throwsWith(
    () => issueExecutionPermit({
      permitId: "permit-mutated-admission",
      candidate: mutatedCandidate,
      now: baseNow,
    }),
    "admission_candidate_invalid",
    "proposal mutation after Trust Admission must invalidate the admission candidate",
  );
}

{
  throwsWith(
    () => issueExecutionPermit({
      permitId: "permit-expired-admission",
      candidate: sandboxCandidate,
      now: new Date(sandboxCandidate.validUntil),
    }),
    "sab_admissible_candidate_expired",
    "expired admission candidate must not be converted into an execution permit",
  );
}

console.log("execution permit and receipt tests passed");
