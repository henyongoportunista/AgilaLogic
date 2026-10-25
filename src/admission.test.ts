import { admitForSab } from "./admission.js";
import { weaveSignals } from "./gagamba.js";
import { compileNorthstarContext } from "./northstar.js";
import { bindProvenanceLedger } from "./provenance-integrity.js";
import {
  RUNTIME_IDENTITY_VERSION,
  bindAdapterAttestationToIdentity,
  resolveRuntimeIdentity,
  type RuntimeIdentityVerifier,
} from "./runtime-identity.js";
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

const adapterVerifier: RuntimeIdentityVerifier = {
  providerId: "fixture-runtime-provider",
  async verify() {
    return {
      verified: true,
      providerId: "fixture-runtime-provider",
      actorKind: "ADAPTER",
      actorId: "mock-adapter-contract",
      sessionId: "adapter-session-1",
      subjectRef: "fixture-runtime://adapter/mock-adapter-contract",
      assurance: "SIGNED_ASSERTION",
      authenticatedAt: "2026-10-25T03:00:00.000Z",
      expiresAt: "2026-10-25T04:00:00.000Z",
      revoked: false,
    };
  },
};

const adapterIdentity = await resolveRuntimeIdentity(
  {
    version: RUNTIME_IDENTITY_VERSION,
    providerId: "fixture-runtime-provider",
    actorKind: "ADAPTER",
    sessionHandle: "adapter-session-1",
    verificationRef: "opaque://runtime/adapter-session-1",
  },
  adapterVerifier,
  new Date("2026-10-25T03:34:00.000Z"),
);
const verifiedAttestation = bindAdapterAttestationToIdentity(
  attestation,
  adapterIdentity,
  new Date("2026-10-25T03:34:00.000Z"),
);

const provenanceLedger = buildProvenanceLedger(weave);
const provenanceIntegrity = bindProvenanceLedger(provenanceLedger, boundArchitecture);
const admissionNow = new Date("2026-10-25T03:34:00.000Z");

{
  const result = admitForSab({
    provenanceLedger,
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    verifiedAttestation,
    now: admissionNow,
  });

  assert(result.admitted, "matching source/state/role/operation/adapter identity contracts must be admitted structurally");
  assert(
    result.candidate?.trust === "STRUCTURALLY_ADMITTED_UNAUTHENTICATED",
    "admission must not overclaim cryptographic or execution authority",
  );
  assert(result.candidate?.proposal.target === "sandbox.preview", "admitted proposal must preserve target");
  assert(
    result.candidate?.evidence.provenanceIntegrityBinding === provenanceIntegrity.binding,
    "admission evidence must retain exact provenance integrity binding",
  );
  assert(
    result.candidate?.evidence.adapterIdentityBinding === adapterIdentity.binding,
    "admission evidence must retain exact resolved adapter identity binding",
  );
}

{
  const forgedVerifiedAttestation = {
    ...verifiedAttestation,
    identity: { ...verifiedAttestation.identity },
  };
  const result = admitForSab({
    provenanceLedger,
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    verifiedAttestation: forgedVerifiedAttestation,
    now: admissionNow,
  });
  assert(!result.admitted, "copied adapter identity wrapper must lose runtime verification stamp");
  assert(result.reasons.includes("adapter_identity_not_verified_or_fresh"), "adapter identity failure must be explicit");
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
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    verifiedAttestation,
    now: admissionNow,
  });

  assert(!result.admitted, "fact provenance mutation must block structural admission");
  assert(result.reasons.includes("provenance_integrity_invalid"), "ledger mutation must break provenance integrity binding");
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
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext: wrongRoleContext,
    expectation,
    verifiedAttestation,
    now: admissionNow,
  });

  assert(!result.admitted, "architect role context must not stand in for the engineer role at admission");
  assert(result.reasons.includes("northstar_engineer_role_mismatch"), "role mismatch must be explicit");
}

{
  const mismatchedAttestation: AdapterAttestation = {
    ...attestation,
    attestationId: "admission-attestation-mismatch",
    operation: { ...attestation.operation, target: "production.customer" },
  };
  const verifiedMismatch = bindAdapterAttestationToIdentity(
    mismatchedAttestation,
    adapterIdentity,
    admissionNow,
  );
  const result = admitForSab({
    provenanceLedger,
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    verifiedAttestation: verifiedMismatch,
    now: admissionNow,
  });

  assert(!result.admitted, "adapter-operation mismatch must block admission");
  assert(result.reasons.includes("operation_truth_mismatch"), "operation mismatch must be explicit");
  assert(result.reasons.includes("operation_target_mismatch"), "target mismatch must remain inspectable");
}

{
  const result = admitForSab({
    provenanceLedger,
    provenanceIntegrity,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    northstarContext,
    expectation,
    verifiedAttestation,
    now: new Date("2026-10-25T03:56:00.000Z"),
  });

  assert(!result.admitted, "expired engineering state must block admission");
  assert(result.reasons.includes("engineering_state_not_fresh"), "stale engineering state must be explicit");
}

console.log("trust admission v0.4 adapter identity tests passed");
