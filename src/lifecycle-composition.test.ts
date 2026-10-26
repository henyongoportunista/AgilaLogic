import {
  assertExecutionPreconditionsUnchanged,
  preparePreExecution,
  verifyPreExecutionRequest,
  type PreExecutionRequest,
} from "./execution.js";
import {
  executionSecurityFixture,
  PREPARED_AT,
  CHECKED_AT,
  type ExecutionSecurityFixture,
} from "./execution-security.fixture.js";
import {
  assertPersistedArchitectureStateActive,
  assertPersistedLifecyclePairActive,
  persistArchitectureState,
  type LifecycleRegistryStore,
} from "./replay-store.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle } from "./trust.js";
import { evaluateProposal, proposalBinding, type ActionProposal } from "./sab.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejectsWith(run: () => Promise<unknown>, expected: string): Promise<void> {
  let observed = "no rejection";
  try { await run(); }
  catch (error) { observed = error instanceof Error ? error.message : "non-Error rejection"; }
  assert(observed === expected, `Expected ${expected}; received ${observed}`);
}

async function supersedeArchitecture(f: ExecutionSecurityFixture, at: string): Promise<void> {
  const prior = f.admission.architectureState;
  const replacement = bindArchitectureLifecycle(prior.architecture, {
    ...prior.lifecycle,
    lifecycleId: `${prior.lifecycle.lifecycleId}-superseding`,
    issuedAt: at,
    supersedesLifecycleId: prior.lifecycle.lifecycleId,
  }, new Date(at));
  await persistArchitectureState(f.lifecycleStore, replacement);
}

function instrumentStore(f: ExecutionSecurityFixture, beforeSecondLoad?: () => Promise<void>) {
  const observed = { reads: 0 };
  const store: LifecycleRegistryStore = {
    ...f.lifecycleStore,
    async load(contextId) {
      observed.reads += 1;
      if (observed.reads === 2) await beforeSecondLoad?.();
      return f.lifecycleStore.load(contextId);
    },
  };
  return { store, observed };
}

let cases = 0;
async function test(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  cases += 1;
  console.log(`PASS lifecycle composition: ${name}`);
}

await test("preparation checks Architecture and Engineering in exactly one coherent registry read", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const { store, observed } = instrumentStore(f, () => supersedeArchitecture(f, PREPARED_AT));
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: store, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  assert(observed.reads === 1, "preparation must not combine an old Architecture read with a new Engineering read");
  assert(request.architectureTrustBinding === f.admission.architectureState.trustBinding, "the checked source state must remain bound to preparation");
  await assertPersistedArchitectureStateActive(f.lifecycleStore, f.admission.architectureState);
});

await test("the final checkpoint also checks both lifecycle states in exactly one coherent read", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  const { store, observed } = instrumentStore(f, () => supersedeArchitecture(f, CHECKED_AT));
  await assertExecutionPreconditionsUnchanged({
    request, lifecycleStore: store,
    architectureState: f.admission.architectureState,
    engineeringState: f.admission.engineeringState,
    currentResourceState: f.resourceState, now: new Date(CHECKED_AT),
  }, "test");
  assert(observed.reads === 1, "the final checkpoint must not mix persisted lifecycle revisions");
  await assertPersistedArchitectureStateActive(f.lifecycleStore, f.admission.architectureState);
});

await test("superseded Architecture with active Engineering in one snapshot blocks preparation", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  await supersedeArchitecture(f, PREPARED_AT);
  const { store, observed } = instrumentStore(f);
  await rejectsWith(() => preparePreExecution({
    admission: f.admission, lifecycleStore: store, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test"), "lifecycle_superseded");
  assert(observed.reads === 1, "the supersession must be found in the single validated snapshot");
});

await test("superseded Architecture with active Engineering blocks an already prepared checkpoint", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  await supersedeArchitecture(f, CHECKED_AT);
  const { store, observed } = instrumentStore(f);
  await rejectsWith(() => assertExecutionPreconditionsUnchanged({
    request, lifecycleStore: store,
    architectureState: f.admission.architectureState,
    engineeringState: f.admission.engineeringState,
    currentResourceState: f.resourceState, now: new Date(CHECKED_AT),
  }, "test"), "lifecycle_superseded");
  assert(observed.reads === 1, "a valid Engineering entry cannot hide superseded Architecture");
});

await test("different lifecycle contexts fail before reading a registry", async () => {
  const f = await executionSecurityFixture();
  const architecture = f.admission.architectureState;
  const otherArchitecture = bindArchitectureLifecycle(architecture.architecture, {
    ...architecture.lifecycle, contextId: "different-execution-context",
  }, new Date(PREPARED_AT));
  const otherEngineering = bindEngineeringLifecycle(f.admission.engineeringState.engineering, {
    ...f.admission.engineeringState.lifecycle, contextId: "different-execution-context",
  }, otherArchitecture, new Date(PREPARED_AT));
  const { store, observed } = instrumentStore(f);
  await rejectsWith(() => assertPersistedLifecyclePairActive(store, architecture, otherEngineering), "packet_context_mismatch");
  assert(observed.reads === 0, "cross-context state must fail before any backend read");
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, canonical(entry)]));
}

for (const route of ["sandbox-write", "public-read"] as const) {
  await test(`${route} metadata cannot forge preparation provenance or bypass the Architecture envelope`, async () => {
    const f = await executionSecurityFixture();
    const approved = await f.approve();
    const genuine = await preparePreExecution({
      admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
      sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
    }, "test");
    const proposal: ActionProposal = route === "sandbox-write"
      ? { ...f.proposal, scope: "SANDBOX", dataSensitivity: "INTERNAL" }
      : { ...f.proposal, type: "READ", scope: "LOCAL", dataSensitivity: "PUBLIC" };
    const sabRoute = evaluateProposal(proposal).route;
    assert(sabRoute === (route === "sandbox-write" ? "ALLOW_WITH_LOG" : "ALLOW"), "the attack must exercise an actual non-approval policy route");
    assert(!f.admission.architectureState.architecture.intentEnvelope.allowedScopes.includes(proposal.scope), "the forged operation must conflict with the original Architecture envelope");
    const { binding: _binding, consentId: _consentId, consentBinding: _consentBinding, ...prior } = genuine;
    const payload = { ...prior, proposal, proposalBinding: proposalBinding(proposal), sabRoute };
    const forged = { ...payload, binding: JSON.stringify(canonical(payload)) } as PreExecutionRequest;
    assert(!verifyPreExecutionRequest(forged), "recomputing the public deterministic binding must not manufacture server-issued Trust Admission");
    await rejectsWith(() => assertExecutionPreconditionsUnchanged({
      request: forged, lifecycleStore: f.lifecycleStore,
      architectureState: f.admission.architectureState,
      engineeringState: f.admission.engineeringState,
      currentResourceState: f.resourceState, now: new Date(CHECKED_AT),
    }, "test"), "pre_execution_binding_mismatch");
  });
}

// One coherent read does not make a future side effect atomic with its registry
// read. A production adapter still needs appropriate version/transaction checks.
console.log(`coherent lifecycle composition tests passed (${cases} cases)`);
