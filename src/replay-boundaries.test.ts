import { weaveSignals } from "./gagamba.js";
import {
  MAX_LIFECYCLE_ENTRIES_PER_CONTEXT,
  assertArchitectureStateActive,
  createLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
  type LifecycleRegistry,
} from "./replay.js";
import {
  LIFECYCLE_STORE_VERSION,
  assertStoredLifecycleRegistry,
  createInMemoryLifecycleRegistryStore,
  persistArchitectureState,
  type LifecycleRegistryStore,
  type StoredLifecycleRegistry,
} from "./replay-store.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { htArchitect, mtEngineer } from "./strand.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle } from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rejects(fn: () => unknown, expected: string): void {
  let matched = false;
  try { fn(); }
  catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `expected rejection: ${expected}`);
}

async function rejectsAsync(fn: () => Promise<unknown>, expected: string): Promise<void> {
  let matched = false;
  try { await fn(); }
  catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `expected async rejection: ${expected}`);
}

const contextId = "capacity-context";
const now = new Date("2026-10-25T07:10:00.000Z");
const architecture = htArchitect({
  packetId: "capacity-architecture",
  objective: "Bound a context without losing replay evidence.",
  weave: weaveSignals({
    signals: [{
      id: "capacity-fact", kind: "FACT", text: "A fictional sandbox fixture exists.",
      provenance: { sourceClass: "HUMAN_STATED", producer: "fixture", observedAt: "2026-10-25T07:00:00.000Z" },
    }],
    candidates: [{ id: "capacity-candidate", value: 1, timing: 1, confidence: 1, cost: 0, risk: 0, reversibility: 1 }],
  }),
  successCriteria: ["Full registries reject without evicting tombstones."],
  nonGoals: ["No live storage or external execution."],
  intentEnvelope: {
    allowedActionTypes: ["WRITE"], allowedScopes: ["SANDBOX"], allowedDataSensitivities: ["INTERNAL"],
    requireReversible: true, allowSecrets: false,
  },
});

function state(index: number) {
  return bindArchitectureLifecycle(architecture, {
    lifecycleId: `capacity-life-${index}`, contextId,
    issuedAt: "2026-10-25T07:00:00.000Z", expiresAt: "2026-10-25T08:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
    ...(index === 0 ? {} : { supersedesLifecycleId: `capacity-life-${index - 1}` }),
  }, now);
}

let full = createLifecycleRegistry();
for (let index = 0; index < MAX_LIFECYCLE_ENTRIES_PER_CONTEXT; index += 1) {
  full = registerArchitectureState(full, state(index));
}
assert(full.entries.length === MAX_LIFECYCLE_ENTRIES_PER_CONTEXT, "the exact capacity must remain usable");
const history = JSON.stringify(full);
const latest = state(MAX_LIFECYCLE_ENTRIES_PER_CONTEXT - 1);
const extra = state(MAX_LIFECYCLE_ENTRIES_PER_CONTEXT);

rejects(() => registerArchitectureState(full, extra), "lifecycle_registry_capacity_exceeded");
assert(JSON.stringify(full) === history, "rejected supersession must not mutate or prune full history");
rejects(() => registerArchitectureState(full, state(0)), "lifecycle_replay_detected");
rejects(() => assertArchitectureStateActive(full, state(0)), "lifecycle_superseded");
assertArchitectureStateActive(full, latest);

const { engineering } = mtEngineer(architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 }, "capacity-engineering");
const engineeringState = bindEngineeringLifecycle(engineering, {
  lifecycleId: "capacity-engineering-life", contextId,
  issuedAt: "2026-10-25T07:00:00.000Z", expiresAt: "2026-10-25T08:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
}, latest, now);
rejects(() => registerEngineeringState(full, engineeringState), "lifecycle_registry_capacity_exceeded");
assert(JSON.stringify(full) === history, "engineering rejection must preserve all replay evidence");

// A hostile oversized array must fail before entry inspection or cloning.
const oversizedEntries = new Array(MAX_LIFECYCLE_ENTRIES_PER_CONTEXT + 1);
Object.defineProperty(oversizedEntries, 0, {
  get() { throw new Error("oversized_entries_must_not_be_inspected"); },
});
const oversized: LifecycleRegistry = { version: full.version, entries: oversizedEntries };
rejects(() => registerArchitectureState(oversized, extra), "lifecycle_registry_capacity_exceeded");
rejects(() => assertArchitectureStateActive(oversized, latest), "lifecycle_registry_capacity_exceeded");

const oversizedStored: StoredLifecycleRegistry = {
  version: LIFECYCLE_STORE_VERSION, contextId, revision: 1, registry: oversized,
};
rejects(() => assertStoredLifecycleRegistry(oversizedStored, contextId), "lifecycle_registry_capacity_exceeded");
const emptyStore = createInMemoryLifecycleRegistryStore();
await rejectsAsync(() => emptyStore.compareAndSwap(contextId, null, oversizedStored), "lifecycle_registry_capacity_exceeded");
assert(await emptyStore.load(contextId) === null, "rejected CAS must not retain an oversized record");

const fullStore = createInMemoryLifecycleRegistryStore();
assert(await fullStore.compareAndSwap(contextId, null, {
  version: LIFECYCLE_STORE_VERSION, contextId, revision: 1, registry: full,
}), "exact-capacity history must persist");
await rejectsAsync(() => persistArchitectureState(fullStore, extra), "lifecycle_registry_capacity_exceeded");
const after = await fullStore.load(contextId);
assert(after?.revision === 1 && JSON.stringify(after.registry) === history,
  "rejected persistence must preserve revision, active state and every replay tombstone");

let attemptedCas = false;
const hostileLoadStore: LifecycleRegistryStore = {
  storageClass: "EXTERNAL_STORE",
  async load() { return oversizedStored; },
  async compareAndSwap() { attemptedCas = true; return true; },
};
await rejectsAsync(() => persistArchitectureState(hostileLoadStore, extra), "lifecycle_registry_capacity_exceeded");
assert(!attemptedCas, "oversized external state must be rejected before mutation");

console.log("replay registry capacity adversarial tests passed");
