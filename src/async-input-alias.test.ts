import {
  assertExecutionPreconditionsUnchanged,
  bindApprovalToNorthstar,
  createConsentOperationBinding,
  createResourceStateSnapshot,
  preparePreExecution,
  type ExecutionPreconditionCheckInput,
  type PreparePreExecutionInput,
  type PreExecutionRequest,
} from "./execution.js";
import { executionSecurityFixture, PREPARED_AT, CHECKED_AT } from "./execution-security.fixture.js";
import { createTestHumanConsentAuthority } from "./human-consent.js";
import { bindProvenanceLedger } from "./provenance-integrity.js";
import {
  assertPersistedArchitectureStateActive,
  persistArchitectureState,
  persistEngineeringState,
  type LifecycleRegistryStore,
} from "./replay-store.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle } from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejection(run: () => Promise<unknown>): Promise<string | undefined> {
  try { await run(); return undefined; }
  catch (error) { return error instanceof Error ? error.message : "non-Error rejection"; }
}

function deferredStore(store: LifecycleRegistryStore) {
  let announce!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { announce = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delayed: LifecycleRegistryStore = {
    ...store,
    async load(contextId) {
      announce();
      await gate;
      return store.load(contextId);
    },
  };
  return { store: delayed, entered, release };
}

const REPLACED_AT = "2026-10-25T06:35:30.000Z";
const NEXT_APPROVED_AT = "2026-10-25T06:36:00.000Z";

/** Independent test responses only; no real provider or human governance mapping. */
async function supersedingFixture(prepareOld: boolean) {
  const f = await executionSecurityFixture();
  const oldApproval = await f.approve();
  const oldRequest = prepareOld ? await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: oldApproval.boundApproval, now: new Date(PREPARED_AT),
  }, "test") : undefined;

  const priorArchitecture = f.admission.architectureState;
  const priorEngineering = f.admission.engineeringState;
  const architectureState = bindArchitectureLifecycle(priorArchitecture.architecture, {
    ...priorArchitecture.lifecycle,
    lifecycleId: `${priorArchitecture.lifecycle.lifecycleId}-async-next`,
    issuedAt: REPLACED_AT,
    supersedesLifecycleId: priorArchitecture.lifecycle.lifecycleId,
  }, new Date(REPLACED_AT));
  const engineeringState = bindEngineeringLifecycle(priorEngineering.engineering, {
    ...priorEngineering.lifecycle,
    lifecycleId: `${priorEngineering.lifecycle.lifecycleId}-async-next`,
    issuedAt: REPLACED_AT,
    supersedesLifecycleId: priorEngineering.lifecycle.lifecycleId,
  }, architectureState, new Date(REPLACED_AT));
  await persistArchitectureState(f.lifecycleStore, architectureState);
  await persistEngineeringState(f.lifecycleStore, engineeringState);
  const admission = {
    ...f.admission, architectureState, engineeringState,
    provenanceIntegrity: bindProvenanceLedger(f.admission.provenanceLedger, architectureState),
  };
  const operationBinding = createConsentOperationBinding({ admission, resourceState: f.resourceState });
  const authority = createTestHumanConsentAuthority({
    providerId: "async-alias-fixture-consent",
    async verify(_evidence, challenge) {
      return {
        decision: "APPROVED", challengeId: challenge.challengeId,
        principal: challenge.principal, sessionId: challenge.sessionId,
      };
    },
  }, () => true);
  const challenge = authority.issueChallenge({
    proposal: f.proposal, operationBinding, policyVersion: SAB_POLICY_VERSION,
  }, f.northstarContext, new Date(NEXT_APPROVED_AT));
  const receipt = await authority.resolveConsent(challenge.challengeId, {
    providerId: "async-alias-fixture-consent", challengeId: challenge.challengeId,
    verificationRef: "fixture://independently-approved-async-next",
  }, f.northstarContext, new Date(NEXT_APPROVED_AT));
  const rawApproval = { ...f.rawApproval(), issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt };
  const boundApproval = bindApprovalToNorthstar(f.proposal, rawApproval, f.northstarContext,
    new Date(NEXT_APPROVED_AT), { authority, receipt, operationBinding }, "test");
  return { f, admission, boundApproval, oldApproval, oldRequest };
}

let cases = 0;
async function test(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  cases += 1;
  console.log(`PASS async input alias: ${name}`);
}

await test("preparation cannot replace checked admission with a superseded transaction during I/O", async () => {
  const { f, admission, boundApproval, oldApproval } = await supersedingFixture(false);
  const delayed = deferredStore(f.lifecycleStore);
  const input: PreparePreExecutionInput = {
    admission, lifecycleStore: delayed.store, resourceState: f.resourceState,
    sessionBoundApproval: boundApproval, now: new Date(NEXT_APPROVED_AT),
  };
  let prepared: PreExecutionRequest | undefined;
  const result = preparePreExecution(input, "test").then((request) => { prepared = request; });
  const outcome = rejection(() => result);
  await delayed.entered;
  input.admission = f.admission;
  input.sessionBoundApproval = oldApproval.boundApproval;
  delayed.release();
  const error = await outcome;
  assert(error !== undefined || prepared?.architectureTrustBinding === admission.architectureState.trustBinding,
    "only the entry admission may prepare; substituted superseded state must never acquire issuance");
  assert(await rejection(() => assertPersistedArchitectureStateActive(f.lifecycleStore, f.admission.architectureState)) === "lifecycle_superseded",
    "the substitution must actually target superseded Architecture");
});

await test("final checkpoint cannot swap to a genuinely issued but superseded request during I/O", async () => {
  const { f, admission, boundApproval, oldRequest } = await supersedingFixture(true);
  assert(oldRequest !== undefined, "the attack requires a genuine prior preparation");
  const currentRequest = await preparePreExecution({
    admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: boundApproval, now: new Date(NEXT_APPROVED_AT),
  }, "test");
  const delayed = deferredStore(f.lifecycleStore);
  const input: ExecutionPreconditionCheckInput = {
    request: currentRequest, lifecycleStore: delayed.store,
    architectureState: admission.architectureState, engineeringState: admission.engineeringState,
    currentResourceState: f.resourceState, now: new Date(CHECKED_AT),
  };
  const outcome = rejection(() => assertExecutionPreconditionsUnchanged(input, "test"));
  await delayed.entered;
  input.request = oldRequest;
  delayed.release();
  const error = await outcome;
  if (error === undefined) {
    const repeat = await rejection(() => assertExecutionPreconditionsUnchanged({
      ...input, request: currentRequest, lifecycleStore: f.lifecycleStore,
    }, "test"));
    assert(repeat === "pre_execution_already_consumed",
      "successful continuation must consume the originally checked request, never its replacement");
  }
  assert(await rejection(() => assertPersistedArchitectureStateActive(f.lifecycleStore, f.admission.architectureState)) === "lifecycle_superseded",
    "the substituted private-issued request must actually refer to superseded state");
});

await test("nested resource mutation cannot repair an initially mismatching final observation during I/O", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  const resource = createResourceStateSnapshot({ ...f.resourceState, stateToken: "unexpected-resource-v8" });
  const delayed = deferredStore(f.lifecycleStore);
  const outcome = rejection(() => assertExecutionPreconditionsUnchanged({
    request, lifecycleStore: delayed.store,
    architectureState: f.admission.architectureState, engineeringState: f.admission.engineeringState,
    currentResourceState: resource, now: new Date(CHECKED_AT),
  }, "test"));
  await delayed.entered;
  Object.assign(resource, f.resourceState);
  delayed.release();
  assert(await outcome !== undefined, "a nested alias must not change the resource submitted for the checkpoint");
});

await test("nested lifecycle mutation cannot replace an unregistered entry identity during I/O", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  const architectureState = {
    ...f.admission.architectureState,
    lifecycle: { ...f.admission.architectureState.lifecycle, lifecycleId: "unregistered-async-alias" },
  };
  const delayed = deferredStore(f.lifecycleStore);
  const outcome = rejection(() => assertExecutionPreconditionsUnchanged({
    request, lifecycleStore: delayed.store, architectureState,
    engineeringState: f.admission.engineeringState, currentResourceState: f.resourceState,
    now: new Date(CHECKED_AT),
  }, "test"));
  await delayed.entered;
  architectureState.lifecycle.lifecycleId = f.admission.architectureState.lifecycle.lifecycleId;
  delayed.release();
  assert(await outcome !== undefined, "the loaded registry must validate the entry identity captured at invocation");
});

await test("mutating an explicit Date during I/O cannot restore expired consent", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const clock = new Date("2026-10-25T06:40:00.000Z");
  const delayed = deferredStore(f.lifecycleStore);
  const outcome = rejection(() => preparePreExecution({
    admission: f.admission, lifecycleStore: delayed.store, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: clock,
  }, "test"));
  await delayed.entered;
  clock.setTime(new Date(PREPARED_AT).getTime());
  delayed.release();
  assert(await outcome !== undefined, "an explicit trusted clock must be captured by value across awaited reads");
});

console.log(`async input alias regression tests passed (${cases} cases)`);
