import { weaveSignals } from "./gagamba.js";
import {
  assertLifecycleActive,
  emptyLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
  verifyLifecycleRegistry,
} from "./lifecycle.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import {
  htArchitect,
  mtEngineer,
  type ArchitectureIntentEnvelope,
} from "./strand.js";
import {
  bindArchitectureLifecycle,
  bindEngineeringLifecycle,
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
      id: "lifecycle-fact",
      kind: "FACT",
      text: "Lifecycle fixture is available.",
      provenance: {
        sourceClass: "SYSTEM_OBSERVED",
        producer: "lifecycle-fixture",
        observedAt: "2026-10-25T05:00:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "lifecycle-candidate",
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
  packetId: "lifecycle-architecture-packet",
  objective: "Test lifecycle supersession.",
  weave,
  successCriteria: ["Old lifecycle becomes inactive."],
  nonGoals: ["No execution."],
  intentEnvelope: envelope,
});

const { engineering } = mtEngineer(
  architecture,
  {
    autonomyLevel: 2,
    riskTolerance: 0.3,
    confidenceThreshold: 0.7,
  },
  "lifecycle-engineering-packet",
);

assert(engineering.intent === "PROPOSAL_ONLY", "fixture must produce proposal-only engineering");

const architectureLifecycle1: PacketLifecycle = {
  lifecycleId: "architecture-life-1",
  contextId: "lifecycle-context",
  issuedAt: "2026-10-25T05:00:00.000Z",
  expiresAt: "2026-10-25T07:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const architectureState1 = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle1,
  new Date("2026-10-25T05:10:00.000Z"),
);

const engineeringLifecycle1: PacketLifecycle = {
  lifecycleId: "engineering-life-1",
  contextId: "lifecycle-context",
  issuedAt: "2026-10-25T05:15:00.000Z",
  expiresAt: "2026-10-25T06:30:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
};

const engineeringState1 = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle1,
  architectureState1,
  new Date("2026-10-25T05:20:00.000Z"),
);

let registry = emptyLifecycleRegistry();
registry = registerArchitectureState(registry, architectureState1);
registry = registerEngineeringState(registry, engineeringState1);

{
  assert(verifyLifecycleRegistry(registry), "initial lifecycle registry must verify");
  assertLifecycleActive(registry, "ARCHITECTURE", architectureState1.lifecycle, architectureState1.trustBinding);
  assertLifecycleActive(registry, "ENGINEERING", engineeringState1.lifecycle, engineeringState1.trustBinding);
}

{
  const replacementWithoutSupersession: PacketLifecycle = {
    lifecycleId: "architecture-life-invalid-replacement",
    contextId: "lifecycle-context",
    issuedAt: "2026-10-25T05:30:00.000Z",
    expiresAt: "2026-10-25T07:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  };
  const replacementState = bindArchitectureLifecycle(
    architecture,
    replacementWithoutSupersession,
    new Date("2026-10-25T05:35:00.000Z"),
  );
  throwsWith(
    () => registerArchitectureState(registry, replacementState),
    "lifecycle_requires_explicit_supersession",
    "parallel active lifecycle must require explicit supersession",
  );
}

const architectureLifecycle2: PacketLifecycle = {
  lifecycleId: "architecture-life-2",
  contextId: "lifecycle-context",
  issuedAt: "2026-10-25T05:30:00.000Z",
  expiresAt: "2026-10-25T07:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
  supersedesLifecycleId: architectureLifecycle1.lifecycleId,
};

const architectureState2 = bindArchitectureLifecycle(
  architecture,
  architectureLifecycle2,
  new Date("2026-10-25T05:35:00.000Z"),
);
registry = registerArchitectureState(registry, architectureState2);

{
  throwsWith(
    () => assertLifecycleActive(registry, "ARCHITECTURE", architectureState1.lifecycle, architectureState1.trustBinding),
    "lifecycle_not_active",
    "superseded architecture lifecycle must fail active-state check",
  );
  assertLifecycleActive(registry, "ARCHITECTURE", architectureState2.lifecycle, architectureState2.trustBinding);
}

const engineeringLifecycle2: PacketLifecycle = {
  lifecycleId: "engineering-life-2",
  contextId: "lifecycle-context",
  issuedAt: "2026-10-25T05:40:00.000Z",
  expiresAt: "2026-10-25T06:30:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
  supersedesLifecycleId: engineeringLifecycle1.lifecycleId,
};

const engineeringState2 = bindEngineeringLifecycle(
  engineering,
  engineeringLifecycle2,
  architectureState2,
  new Date("2026-10-25T05:45:00.000Z"),
);
registry = registerEngineeringState(registry, engineeringState2);

{
  throwsWith(
    () => assertLifecycleActive(registry, "ENGINEERING", engineeringState1.lifecycle, engineeringState1.trustBinding),
    "lifecycle_not_active",
    "superseded engineering lifecycle must fail active-state check",
  );
  assertLifecycleActive(registry, "ENGINEERING", engineeringState2.lifecycle, engineeringState2.trustBinding);
}

{
  throwsWith(
    () => registerArchitectureState(registry, architectureState2),
    "lifecycle_id_already_registered",
    "registered lifecycle ID must not be reusable",
  );
}

{
  const tampered = {
    ...registry,
    entries: registry.entries.map((entry) =>
      entry.lifecycleId === architectureLifecycle1.lifecycleId
        ? { ...entry, status: "ACTIVE" as const, supersededByLifecycleId: undefined }
        : entry,
    ),
  };
  assert(!verifyLifecycleRegistry(tampered), "registry mutation must invalidate its binding or invariants");
}

console.log("lifecycle registry tests passed");
