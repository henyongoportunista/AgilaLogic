import { weaveSignals } from "./gagamba.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { htArchitect, mtEngineer } from "./strand.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle } from "./trust.js";
import {
  assertPersistedArchitectureStateActive,
  assertPersistedEngineeringStateActive,
  createInMemoryLifecycleRegistryStore,
  persistArchitectureState,
  persistEngineeringState,
  type LifecycleRegistryStore,
  type StoredLifecycleRegistry,
} from "./replay-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejectsWith(
  fn: () => Promise<unknown>,
  expected: string,
  message: string,
): Promise<void> {
  let matched = false;
  try {
    await fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const weave = weaveSignals({
  signals: [
    {
      id: "persist-fact",
      kind: "FACT",
      text: "Sandbox persistence fixture exists.",
      provenance: {
        sourceClass: "HUMAN_STATED",
        producer: "fixture-human",
        observedAt: "2026-10-25T07:00:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "persist-candidate",
      value: 1,
      timing: 1,
      confidence: 1,
      cost: 0,
      risk: 0,
      reversibility: 1,
    },
  ],
});

const architecture = htArchitect({
  packetId: "persist-architecture",
  objective: "Exercise persisted lifecycle semantics.",
  weave,
  successCriteria: ["Replay and supersession survive registry reloads."],
  nonGoals: ["No real database connection."],
  intentEnvelope: {
    allowedActionTypes: ["WRITE"],
    allowedScopes: ["SANDBOX"],
    allowedDataSensitivities: ["INTERNAL"],
    requireReversible: true,
    allowSecrets: false,
  },
});

const firstArchitecture = bindArchitectureLifecycle(
  architecture,
  {
    lifecycleId: "persist-arch-life-1",
    contextId: "persist-context",
    issuedAt: "2026-10-25T07:00:00.000Z",
    expiresAt: "2026-10-25T08:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  },
  new Date("2026-10-25T07:10:00.000Z"),
);

const store = createInMemoryLifecycleRegistryStore();
const storedFirst = await persistArchitectureState(store, firstArchitecture);
assert(storedFirst.revision === 1, "first persisted lifecycle must create revision 1");
await assertPersistedArchitectureStateActive(store, firstArchitecture);

await rejectsWith(
  () => persistArchitectureState(store, firstArchitecture),
  "lifecycle_replay_detected",
  "duplicate persisted lifecycle must be rejected after reload",
);

const secondArchitecture = bindArchitectureLifecycle(
  architecture,
  {
    lifecycleId: "persist-arch-life-2",
    contextId: "persist-context",
    issuedAt: "2026-10-25T07:15:00.000Z",
    expiresAt: "2026-10-25T08:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
    supersedesLifecycleId: "persist-arch-life-1",
  },
  new Date("2026-10-25T07:20:00.000Z"),
);

const storedSecond = await persistArchitectureState(store, secondArchitecture);
assert(storedSecond.revision === 2, "superseding lifecycle must advance storage revision");
await rejectsWith(
  () => assertPersistedArchitectureStateActive(store, firstArchitecture),
  "lifecycle_superseded",
  "persisted supersession must make prior architecture inactive",
);
await assertPersistedArchitectureStateActive(store, secondArchitecture);

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "persist-engineering",
);
const engineeringState = bindEngineeringLifecycle(
  engineering,
  {
    lifecycleId: "persist-eng-life-1",
    contextId: "persist-context",
    issuedAt: "2026-10-25T07:21:00.000Z",
    expiresAt: "2026-10-25T07:50:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  },
  secondArchitecture,
  new Date("2026-10-25T07:22:00.000Z"),
);

const storedEngineering = await persistEngineeringState(store, engineeringState);
assert(storedEngineering.revision === 3, "engineering persistence must share the context revision stream");
await assertPersistedEngineeringStateActive(store, engineeringState);

{
  const underlying = createInMemoryLifecycleRegistryStore();
  let forcedConflict = true;
  const conflictOnceStore: LifecycleRegistryStore = {
    storageClass: "TEST_MEMORY",
    load(contextId: string): Promise<StoredLifecycleRegistry | null> {
      return underlying.load(contextId);
    },
    async compareAndSwap(
      contextId: string,
      expectedRevision: number | null,
      next: StoredLifecycleRegistry,
    ): Promise<boolean> {
      if (forcedConflict) {
        forcedConflict = false;
        return false;
      }
      return underlying.compareAndSwap(contextId, expectedRevision, next);
    },
  };

  const retried = await persistArchitectureState(conflictOnceStore, firstArchitecture);
  assert(retried.revision === 1, "CAS conflict should reload and retry without revision corruption");
  await assertPersistedArchitectureStateActive(conflictOnceStore, firstArchitecture);
}

{
  const emptyStore = createInMemoryLifecycleRegistryStore();
  await rejectsWith(
    () => assertPersistedArchitectureStateActive(emptyStore, firstArchitecture),
    "lifecycle_not_persisted",
    "unpersisted state must never be treated as active",
  );
}

console.log("persistent replay boundary tests passed");
