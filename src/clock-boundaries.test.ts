import {
  assertExecutionPreconditionsUnchanged,
  createResourceStateSnapshot,
  preparePreExecution,
} from "./execution.js";
import {
  executionSecurityFixture,
  PREPARED_AT,
  type ExecutionSecurityFixture,
} from "./execution-security.fixture.js";
import type { LifecycleRegistryStore } from "./replay-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejectsWith(run: () => Promise<unknown>, expected: string): Promise<void> {
  let observed = "no rejection";
  try { await run(); }
  catch (error) { observed = error instanceof Error ? error.message : "non-Error rejection"; }
  assert(observed === expected, `Expected ${expected}; received ${observed}`);
}

/** Deterministic default-clock movement across an awaited read; no sleep or I/O. */
async function withClock(
  initial: string,
  run: (advance: (instant: string) => void) => Promise<void>,
): Promise<void> {
  const OriginalDate = globalThis.Date;
  let nowMs = OriginalDate.parse(initial);
  class ControlledDate extends OriginalDate {
    constructor(value?: string | number | Date) {
      if (arguments.length === 0) super(nowMs);
      else super(value as string);
    }
    static now(): number { return nowMs; }
  }
  globalThis.Date = ControlledDate as unknown as DateConstructor;
  try { await run((instant) => { nowMs = OriginalDate.parse(instant); }); }
  finally { globalThis.Date = OriginalDate; }
}

function delayedStore(
  fixture: ExecutionSecurityFixture,
  advance: (instant: string) => void,
  completionTime: string,
): LifecycleRegistryStore {
  return {
    ...fixture.lifecycleStore,
    async load(contextId) {
      const snapshot = await fixture.lifecycleStore.load(contextId);
      advance(completionTime);
      return snapshot;
    },
  };
}

let cases = 0;
async function test(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  cases += 1;
  console.log(`PASS clock boundary: ${name}`);
}

await test("consent expiring during lifecycle reads cannot be consumed with a stale default clock", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  await withClock(PREPARED_AT, async (advance) => {
    await rejectsWith(() => preparePreExecution({
      admission: f.admission,
      lifecycleStore: delayedStore(f, advance, "2026-10-25T06:40:00.000Z"),
      resourceState: f.resourceState,
      sessionBoundApproval: approved.boundApproval,
    }, "test"), "session_bound_approval_invalid");
  });
});

await test("resource expiry during lifecycle reads blocks default-clock preparation", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  await withClock(PREPARED_AT, async (advance) => {
    await rejectsWith(() => preparePreExecution({
      admission: f.admission,
      lifecycleStore: delayedStore(f, advance, "2026-10-25T06:46:00.000Z"),
      resourceState: f.resourceState,
      sessionBoundApproval: approved.boundApproval,
    }, "test"), "resource_state_expired");
  });
});

await test("prepared-request expiry during final lifecycle reads blocks continuation", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  await withClock("2026-10-25T06:37:00.000Z", async (advance) => {
    await rejectsWith(() => assertExecutionPreconditionsUnchanged({
      request,
      lifecycleStore: delayedStore(f, advance, "2026-10-25T06:40:00.000Z"),
      architectureState: f.admission.architectureState,
      engineeringState: f.admission.engineeringState,
      currentResourceState: f.resourceState,
    }, "test"), "pre_execution_expired");
  });
});

await test("a newer resource observation expiring during final reads is rejected", async () => {
  const f = await executionSecurityFixture();
  const approved = await f.approve();
  const request = await preparePreExecution({
    admission: f.admission, lifecycleStore: f.lifecycleStore, resourceState: f.resourceState,
    sessionBoundApproval: approved.boundApproval, now: new Date(PREPARED_AT),
  }, "test");
  const currentResourceState = createResourceStateSnapshot({
    adapterId: f.resourceState.adapterId, target: f.resourceState.target,
    stateToken: f.resourceState.stateToken,
    observedAt: "2026-10-25T06:36:00.000Z", expiresAt: "2026-10-25T06:37:30.000Z",
  });
  await withClock("2026-10-25T06:37:00.000Z", async (advance) => {
    await rejectsWith(() => assertExecutionPreconditionsUnchanged({
      request,
      lifecycleStore: delayedStore(f, advance, "2026-10-25T06:38:00.000Z"),
      architectureState: f.admission.architectureState,
      engineeringState: f.admission.engineeringState,
      currentResourceState,
    }, "test"), "resource_state_expired");
  });
});

console.log(`async clock boundary tests passed (${cases} cases)`);
