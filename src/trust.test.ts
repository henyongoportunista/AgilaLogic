import { weaveSignals } from "./gagamba.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import {
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
  type ArchitectureIntentEnvelope,
} from "./strand.js";
import {
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

const now = new Date("2026-10-25T02:30:00.000Z");
const provenance = {
  sourceClass: "TOOL_OBSERVED" as const,
  producer: "fixture-sensor",
  observedAt: "2026-10-25T02:20:00.000Z",
  sourceRef: "fixture://sandbox-state",
  evidenceRef: "evidence://sandbox-state-1",
};

const candidate = {
  id: "trust-preview",
  value: 0.9,
  timing: 0.8,
  confidence: 0.9,
  cost: 0.1,
  risk: 0.1,
  reversibility: 0.9,
  informationGain: 0.7,
};

const envelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["READ", "DRAFT", "WRITE"],
  allowedScopes: ["LOCAL", "SANDBOX"],
  allowedDataSensitivities: ["PUBLIC", "INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 1,
};

const weave = weaveSignals({
  signals: [
    {
      id: "fact-provenanced",
      kind: "FACT",
      text: "The sandbox preview endpoint is available.",
      provenance,
    },
    {
      id: "resource-gap",
      kind: "RESOURCE",
      text: "A local test harness exists.",
    },
  ],
  candidates: [candidate],
});

{
  const ledger = buildProvenanceLedger(weave);
  assert(ledger.entries.length === 2, "accepted signals must enter provenance ledger");
  assert(ledger.entries[0]?.provenance?.sourceClass === "TOOL_OBSERVED", "tool provenance must survive");
  assert(ledger.provenanceGapSignalIds.includes("resource-gap"), "missing provenance must remain explicit");
  assert(!ledger.provenanceGapSignalIds.includes("fact-provenanced"), "known provenance must not become a gap");
}

{
  const invalidFact = weaveSignals({
    signals: [
      {
        id: "model-fact",
        kind: "FACT",
        text: "The model says this is certainly true.",
        provenance: {
          sourceClass: "MODEL_DERIVED",
          producer: "model-fixture",
          observedAt: "2026-10-25T02:20:00.000Z",
        },
      },
    ],
    candidates: [],
  });

  assert(invalidFact.observation.facts.length === 0, "model-derived input must not self-label as FACT");
  assert(invalidFact.trace.withheldSignalIds.includes("model-fact"), "invalid FACT provenance must be withheld");
  assert(
    invalidFact.trace.reasons.includes("model_derived_signal_cannot_self_label_fact"),
    "withholding reason must be inspectable",
  );
}

const architecture = htArchitect({
  packetId: "trust-architecture",
  objective: "Prepare a bounded sandbox proposal for trust-spine validation.",
  weave,
  successCriteria: ["The proposal remains bounded and non-executing."],
  nonGoals: ["No production mutation."],
  intentEnvelope: envelope,
});

const architectureLifecycle: PacketLifecycle = {
  lifecycleId: "architecture-lifecycle-1",
  contextId: "trust-context-1",
  issuedAt: "2026-10-25T02:25:00.000Z",
  expiresAt: "2026-10-25T03:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const boundArchitecture = bindArchitectureLifecycle(architecture, architectureLifecycle, now);
assert(verifyBoundArchitectureState(boundArchitecture), "bound architecture state must verify");

{
  throwsWith(
    () => assertPacketLifecycleFresh(architectureLifecycle, new Date("2026-10-25T03:00:00.000Z")),
    "packet_expired",
    "packet must fail exactly at expiry",
  );

  throwsWith(
    () => normalizePacketLifecycle({ ...architectureLifecycle, policyVersion: "obsolete-policy" }),
    "packet_policy_version_mismatch",
    "packet lifecycle must bind current SAB policy version",
  );
}

const { engineering } = mtEngineer(
  architecture,
  {
    autonomyLevel: 2,
    riskTolerance: 0.3,
    confidenceThreshold: 0.7,
  },
  "trust-engineering",
);
assert(engineering.intent === "PROPOSAL_ONLY", "fixture must produce proposal-only engineering");

const engineeringLifecycle: PacketLifecycle = {
  lifecycleId: "engineering-lifecycle-1",
  contextId: "trust-context-1",
  issuedAt: "2026-10-25T02:31:00.000Z",
  expiresAt: "2026-10-25T02:55:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const engineeringNow = new Date("2026-10-25T02:32:00.000Z");
const boundEngineering = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle,
  boundArchitecture,
  engineeringNow,
);
assert(verifyBoundEngineeringState(boundEngineering), "bound engineering state must verify");

{
  throwsWith(
    () => bindEngineeringLifecycle(
      engineering,
      { ...engineeringLifecycle, expiresAt: "2026-10-25T03:05:00.000Z" },
      boundArchitecture,
      engineeringNow,
    ),
    "engineering_validity_exceeds_architecture",
    "engineering lifecycle must not outlive architecture lifecycle",
  );

  throwsWith(
    () => bindEngineeringLifecycle(
      engineering,
      { ...engineeringLifecycle, contextId: "wrong-context" },
      boundArchitecture,
      engineeringNow,
    ),
    "packet_context_mismatch",
    "engineering lifecycle must remain in architecture context",
  );
}

{
  const rfi = openRfi({
    rfiId: "rfi-1",
    architectureBinding: architecture.architectureBinding,
    engineeringBinding: engineering.engineeringBinding,
    contextId: architectureLifecycle.contextId,
    owner: "ARCHITECT_OR_HUMAN",
    question: "Which exact target is intended?",
    maxRounds: 2,
    openedAt: "2026-10-25T02:32:00.000Z",
    expiresAt: "2026-10-25T02:50:00.000Z",
  });
  assert(verifyRfiLifecycle(rfi), "opened RFI must verify");

  const secondRound = continueRfi(
    rfi,
    "The first response was ambiguous; identify the exact resource.",
    new Date("2026-10-25T02:35:00.000Z"),
  );
  assert(secondRound.status === "OPEN" && secondRound.round === 2, "RFI should advance within max rounds");

  const terminal = continueRfi(
    secondRound,
    "A third clarification would exceed the configured round budget.",
    new Date("2026-10-25T02:36:00.000Z"),
  );
  assert(terminal.status === "UNRESOLVABLE", "RFI must terminate after configured round budget");

  const resolved = resolveRfi(
    rfi,
    "Target is sandbox.preview only.",
    new Date("2026-10-25T02:34:00.000Z"),
  );
  assert(resolved.status === "RESOLVED", "RFI can resolve before expiry");
  assert(verifyRfiLifecycle(resolved), "resolved RFI binding must verify");

  const expirable = openRfi({
    rfiId: "rfi-expire",
    architectureBinding: architecture.architectureBinding,
    engineeringBinding: engineering.engineeringBinding,
    contextId: architectureLifecycle.contextId,
    owner: "ARCHITECT",
    question: "Provide missing evidence.",
    maxRounds: 3,
    openedAt: "2026-10-25T02:32:00.000Z",
    expiresAt: "2026-10-25T02:33:00.000Z",
  });
  const expired = expireRfi(expirable, new Date("2026-10-25T02:33:00.000Z"));
  assert(expired.status === "EXPIRED", "RFI must support explicit expiry terminal state");
}

const untrusted = draftUntrustedSabProposal(engineering, "trust-proposal", {
  type: "WRITE",
  scope: "SANDBOX",
  target: "sandbox.preview",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
});

const matchingAttestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "attestation-1",
  requestId: engineering.packetId,
  proposalId: untrusted.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "mock-adapter-contract",
  observedAt: "2026-10-25T02:33:00.000Z",
  expiresAt: "2026-10-25T02:40:00.000Z",
  operation: {
    type: "WRITE",
    scope: "SANDBOX",
    target: "sandbox.preview",
    reversible: true,
    dataSensitivity: "INTERNAL",
    affectedRecords: 1,
    estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" },
    containsSecrets: false,
  },
};

{
  const comparison = compareAdapterAttestation(
    untrusted,
    matchingAttestation,
    new Date("2026-10-25T02:34:00.000Z"),
  );
  assert(comparison.matched, "exact adapter operation must match the proposal");
  assert(
    comparison.candidate?.trust === "ADAPTER_MATCHED_UNAUTHENTICATED",
    "match must not pretend adapter identity is authenticated",
  );
}

{
  const mismatch = compareAdapterAttestation(
    untrusted,
    {
      ...matchingAttestation,
      attestationId: "attestation-mismatch",
      operation: { ...matchingAttestation.operation, target: "production.customer" },
    },
    new Date("2026-10-25T02:34:00.000Z"),
  );
  assert(!mismatch.matched, "operation mismatch must fail closed");
  assert(mismatch.reasons.includes("operation_target_mismatch"), "target mismatch must be explicit");
  assert(mismatch.candidate === undefined, "mismatched operation must not produce an adapter-matched proposal");
}

{
  const incompatibleCostUnit = compareAdapterAttestation(
    untrusted,
    {
      ...matchingAttestation,
      attestationId: "attestation-cost-unit",
      operation: {
        ...matchingAttestation.operation,
        estimatedCost: { amount: 0, unit: "USD", currency: "USD" },
      },
    },
    new Date("2026-10-25T02:34:00.000Z"),
  );
  assert(!incompatibleCostUnit.matched, "unitful production cost must not collapse into prototype scalar semantics");
  assert(
    incompatibleCostUnit.reasons.includes("cost_unit_not_sab_compatible"),
    "cost-unit incompatibility must be explicit",
  );
}

console.log("trust spine tests passed");
