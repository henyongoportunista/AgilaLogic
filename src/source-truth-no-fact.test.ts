import { admitForSab } from "./admission.js";
import { weaveSignals } from "./gagamba.js";
import { compileNorthstarContext } from "./northstar.js";
import { bindProvenanceLedger } from "./provenance-integrity.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import {
  ARCHITECT_ENGINEER_STRAND_VERSION,
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
} from "./strand.js";
import {
  TRUST_SPINE_VERSION,
  bindArchitectureLifecycle,
  bindEngineeringLifecycle,
  buildProvenanceLedger,
  type AdapterAttestation,
} from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const weave = weaveSignals({
  signals: [{
    id: "inference-only",
    kind: "INFERENCE",
    text: "The sandbox resource may be available.",
    provenance: {
      sourceClass: "MODEL_DERIVED",
      producer: "fixture-model",
      observedAt: "2026-10-25T11:00:00.000Z",
    },
  }],
  candidates: [{
    id: "no-fact-candidate",
    value: 0.9,
    timing: 0.8,
    confidence: 0.9,
    cost: 0.1,
    risk: 0.1,
    reversibility: 0.9,
    informationGain: 0.5,
  }],
});

const architecture = htArchitect({
  packetId: "no-fact-architecture",
  objective: "Prepare a bounded sandbox read without inventing a fact.",
  weave,
  successCriteria: ["No inference is promoted into a FACT."],
  nonGoals: ["No external execution."],
  intentEnvelope: {
    allowedActionTypes: ["READ"],
    allowedScopes: ["SANDBOX"],
    allowedDataSensitivities: ["PUBLIC"],
    requireReversible: true,
    allowSecrets: false,
    maxAffectedRecords: 1,
    maxEstimatedCost: 0,
  },
});
assert(architecture.facts.length === 0, "fixture must contain no Architecture FACTs");

const architectureState = bindArchitectureLifecycle(architecture, {
  lifecycleId: "no-fact-architecture-life",
  contextId: "no-fact-context",
  issuedAt: "2026-10-25T11:01:00.000Z",
  expiresAt: "2026-10-25T11:30:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
}, new Date("2026-10-25T11:02:00.000Z"));

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "no-fact-engineering",
);
assert(engineering.intent === "PROPOSAL_ONLY", "fixture must produce a proposal");

const engineeringState = bindEngineeringLifecycle(engineering, {
  lifecycleId: "no-fact-engineering-life",
  contextId: "no-fact-context",
  issuedAt: "2026-10-25T11:03:00.000Z",
  expiresAt: "2026-10-25T11:25:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
}, architectureState, new Date("2026-10-25T11:04:00.000Z"));

const expectation = draftUntrustedSabProposal(engineering, "no-fact-proposal", {
  type: "READ",
  scope: "SANDBOX",
  target: "sandbox.preview",
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
    sessionId: "no-fact-public-session",
    issuedAt: "2026-10-25T11:00:00.000Z",
    expiresAt: "2026-10-25T11:30:00.000Z",
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC"],
  now: new Date("2026-10-25T11:04:00.000Z"),
});

const attestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "no-fact-operation-attestation",
  requestId: engineering.packetId,
  proposalId: expectation.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "fixture-read-adapter",
  observedAt: "2026-10-25T11:05:00.000Z",
  expiresAt: "2026-10-25T11:20:00.000Z",
  operation: {
    type: "READ",
    scope: "SANDBOX",
    target: "sandbox.preview",
    reversible: true,
    dataSensitivity: "PUBLIC",
    affectedRecords: 1,
    estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" },
    containsSecrets: false,
  },
};

const provenanceLedger = buildProvenanceLedger(weave);
const result = admitForSab({
  provenanceLedger,
  provenanceIntegrity: bindProvenanceLedger(provenanceLedger, architectureState),
  provenanceAttestations: [],
  architectureState,
  engineeringState,
  northstarContext,
  expectation,
  attestation,
  now: new Date("2026-10-25T11:06:00.000Z"),
});

assert(result.admitted, "no-FACT architecture must not require a source receipt");
assert(result.candidate?.evidence.provenanceAttestationIds.length === 0, "no-FACT admission must carry no fake source receipts");
assert(
  result.candidate?.evidence.sourceTruthValidUntil === engineeringState.lifecycle.expiresAt,
  "no-FACT source-truth window must fall back to the active state window",
);

console.log("source truth no-FACT path test passed");
