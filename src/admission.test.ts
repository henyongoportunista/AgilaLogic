import { admitForSab } from "./admission.js";
import {
  bindOperatorAuthAssertion,
  consumeOperatorAuthAssertion,
  emptyOperatorAuthReplayState,
} from "./auth.js";
import { weaveSignals } from "./gagamba.js";
import {
  emptyLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
} from "./lifecycle.js";
import { compileNorthstarContext } from "./northstar.js";
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

const candidate = {
  id: "admission-preview",
  value: 0.9,
  timing: 0.8,
  confidence: 0.9,
  cost: 0.1,
  risk: 0.1,
  reversibility: 0.9,
  informationGain: 0.7,
};

const envelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["WRITE"],
  allowedScopes: ["SANDBOX"],
  allowedDataSensitivities: ["INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 1,
};

const weave = weaveSignals({
  signals: [
    {
      id: "fact-1",
      kind: "FACT",
      text: "The sandbox preview resource is available.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "fixture-sensor",
        observedAt: "2026-10-25T03:20:00.000Z",
        sourceRef: "fixture://sandbox-preview",
        evidenceRef: "evidence://sandbox-preview-1",
      },
    },
  ],
  candidates: [candidate],
});

const architecture = htArchitect({
  packetId: "admission-architecture",
  objective: "Prepare a bounded sandbox write proposal.",
  weave,
  successCriteria: ["Remain bounded and non-production."],
  nonGoals: ["No production mutation."],
  intentEnvelope: envelope,
});

const architectureLifecycle: PacketLifecycle = {
  lifecycleId: "admission-architecture-lifecycle",
  contextId: "admission-context",
  issuedAt: "2026-10-25T03:25:00.000Z",
  expiresAt: "2026-10-25T04:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const boundArchitecture = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle,
  new Date("2026-10-25T03:30:00.000Z"),
);

const { engineering } = mtEngineer(
  architecture,
  {
    autonomyLevel: 2,
    riskTolerance: 0.3,
    confidenceThreshold: 0.7,
  },
  "admission-engineering",
);

assert(engineering.intent === "PROPOSAL_ONLY", "fixture must produce proposal-only engineering");

const engineeringLifecycle: PacketLifecycle = {
  lifecycleId: "admission-engineering-lifecycle",
  contextId: "admission-context",
  issuedAt: "2026-10-25T03:31:00.000Z",
  expiresAt: "2026-10-25T03:55:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const boundEngineering = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle,
  boundArchitecture,
  new Date("2026-10-25T03:32:00.000Z"),
);

let lifecycleRegistry = emptyLifecycleRegistry();
lifecycleRegistry = registerArchitectureState(lifecycleRegistry, boundArchitecture);
lifecycleRegistry = registerEngineeringState(lifecycleRegistry, boundEngineering);

const expectation = draftUntrustedSabProposal(engineering, "admission-proposal", {
  type: "WRITE",
  scope: "SANDBOX",
  target: "sandbox.preview",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
});

const northstarContext = compileNorthstarContext({
  roleId: "MT",
  principalContext: {
    principal: "UNVERIFIED_PUBLIC",
    verification: "PUBLIC_SESSION",
    sessionId: "public-admission-session",
    issuedAt: "2026-10-25T03:00:00.000Z",
    expiresAt: "2026-10-25T04:00:00.000Z",
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC"],
  now: new Date("2026-10-25T03:30:00.000Z"),
});

const salAuthAssertion = bindOperatorAuthAssertion({
  assertionId: "admission-sal-auth",
  principal: "SAL",
  sessionId: "admission-sal-session",
  issuerId: "future-auth-service",
  nonceId: "admission-sal-nonce",
  issuedAt: "2026-10-25T03:00:00.000Z",
  expiresAt: "2026-10-25T04:00:00.000Z",
  factors: [
    {
      factorId: "admission-sal-knowledge",
      factorClass: "KNOWLEDGE",
      channel: "NORTHSTAR_SECRET",
      verifierId: "secret-verifier",
      verifiedAt: "2026-10-25T02:59:00.000Z",
    },
    {
      factorId: "admission-sal-possession",
      factorClass: "POSSESSION",
      channel: "TOTP",
      verifierId: "totp-verifier",
      verifiedAt: "2026-10-25T02:59:30.000Z",
    },
  ],
});

const salOperatorSession = consumeOperatorAuthAssertion(
  salAuthAssertion,
  emptyOperatorAuthReplayState(),
  new Date("2026-10-25T03:30:00.000Z"),
).session;

const verifiedNorthstarContext = compileNorthstarContext({
  roleId: "MT",
  principalContext: {
    principal: "VERIFIED_SAL",
    verification: "EXTERNAL_AUTH",
    operatorSession: salOperatorSession,
  },
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR"],
  now: new Date("2026-10-25T03:30:00.000Z"),
});

const attestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "admission-attestation",
  requestId: engineering.packetId,
  proposalId: expectation.proposal.id,
  engineeringBinding: engineering.engineeringBinding,
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "mock-adapter-contract",
  observedAt: "2026-10-25T03:33:00.000Z",
  expiresAt: "2026-10-25T03:50:00.000Z",
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

const provenanceLedger = buildProvenanceLedger(weave);
const admissionNow = new Date("2026-10-25T03:34:00.000Z");

{
  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation,
    now: admissionNow,
  });

  assert(result.admitted, "matching source/state/role/lifecycle/operation contracts must be admitted structurally");
  assert(
    result.candidate?.trust === "STRUCTURALLY_ADMITTED_UNAUTHENTICATED",
    "admission must not claim authenticated provenance, adapter identity, or execution authority",
  );
  assert(result.candidate?.proposal.target === "sandbox.preview", "admitted proposal must preserve target");
  assert(result.candidate?.evidence.operatorAuthBinding === null, "public admission must not invent auth evidence");
  assert(
    result.candidate?.evidence.lifecycleRegistryBinding === lifecycleRegistry.binding,
    "admission evidence must preserve active lifecycle registry binding",
  );
}

{
  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext: verifiedNorthstarContext,
    expectation,
    attestation,
    now: admissionNow,
  });

  assert(result.admitted, "verified operator context may pass structural admission when all other contracts match");
  assert(
    result.candidate?.evidence.operatorAuthBinding === salOperatorSession.sessionBinding,
    "admission evidence must preserve the operator-session binding",
  );
  assert(
    result.candidate?.evidence.operatorAuthTrust === salOperatorSession.trust,
    "admission evidence must preserve auth trust calibration",
  );
  assert(result.candidate?.evidence.principal === "VERIFIED_SAL", "admission must preserve principal identity");
}

{
  const brokenLedger = {
    ...provenanceLedger,
    entries: provenanceLedger.entries.map((entry) =>
      entry.kind === "FACT" ? { ...entry, provenance: null } : entry,
    ),
    provenanceGapSignalIds: ["fact-1"],
  };

  const result = admitForSab({
    provenanceLedger: brokenLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation,
    now: admissionNow,
  });

  assert(!result.admitted, "fact provenance gap must block structural admission");
  assert(
    result.reasons.includes("architecture_fact_unresolved_provenance"),
    "missing fact provenance must be explicit",
  );
  assert(result.candidate === undefined, "failed provenance must emit no candidate");
}

{
  const wrongRoleContext = compileNorthstarContext({
    roleId: "HT",
    principalContext: {
      principal: "UNVERIFIED_PUBLIC",
      verification: "PUBLIC_SESSION",
      sessionId: "public-architect-session",
      issuedAt: "2026-10-25T03:00:00.000Z",
      expiresAt: "2026-10-25T04:00:00.000Z",
    },
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC"],
    now: new Date("2026-10-25T03:30:00.000Z"),
  });

  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext: wrongRoleContext,
    expectation,
    attestation,
    now: admissionNow,
  });

  assert(!result.admitted, "architect role context must not stand in for the engineer role at admission");
  assert(result.reasons.includes("northstar_engineer_role_mismatch"), "role mismatch must be explicit");
}

{
  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation: {
      ...attestation,
      attestationId: "admission-attestation-mismatch",
      operation: { ...attestation.operation, target: "production.customer" },
    },
    now: admissionNow,
  });

  assert(!result.admitted, "adapter-operation mismatch must block admission");
  assert(result.reasons.includes("operation_truth_mismatch"), "operation mismatch must be explicit");
  assert(result.reasons.includes("operation_target_mismatch"), "target mismatch must remain inspectable");
}

{
  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation,
    now: new Date("2026-10-25T03:56:00.000Z"),
  });

  assert(!result.admitted, "expired engineering state must block admission");
  assert(result.reasons.includes("engineering_state_not_fresh"), "stale engineering state must be explicit");
}

{
  const replacementLifecycle: PacketLifecycle = {
    lifecycleId: "admission-architecture-lifecycle-2",
    contextId: architectureLifecycle.contextId,
    issuedAt: "2026-10-25T03:35:00.000Z",
    expiresAt: "2026-10-25T04:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
    supersedesLifecycleId: architectureLifecycle.lifecycleId,
  };
  const replacementArchitecture = bindArchitectureLifecycle(
    architecture,
    replacementLifecycle,
    new Date("2026-10-25T03:36:00.000Z"),
  );
  const supersededRegistry = registerArchitectureState(lifecycleRegistry, replacementArchitecture);

  const result = admitForSab({
    provenanceLedger,
    lifecycleRegistry: supersededRegistry,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    attestation,
    now: new Date("2026-10-25T03:37:00.000Z"),
  });

  assert(!result.admitted, "superseded but still time-fresh architecture state must not be replayed");
  assert(
    result.reasons.includes("architecture_lifecycle_not_active"),
    "superseded lifecycle replay must be explicit",
  );
}

console.log("trust admission v0.4 tests passed");
