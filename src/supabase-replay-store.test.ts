import { weaveSignals } from "./gagamba.js";
import { MAX_LIFECYCLE_ENTRIES_PER_CONTEXT, REPLAY_GUARD_VERSION } from "./replay.js";
import {
  createSupabaseLifecycleRegistryStore,
} from "./supabase-replay-store.js";
import {
  LIFECYCLE_STORE_VERSION,
  assertPersistedArchitectureStateActive,
  persistArchitectureState,
  type StoredLifecycleRegistry,
} from "./replay-store.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { htArchitect } from "./strand.js";
import { bindArchitectureLifecycle } from "./trust.js";

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

interface MockRow {
  context_id: string;
  revision: number;
  registry: unknown;
}

let stored: MockRow | null = null;
const rpcCalls: string[] = [];

const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const name = url.split("/").at(-1) ?? "";
  rpcCalls.push(name);

  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

  if (name === "henyong_lifecycle_registry_load") {
    const contextId = String(body.p_context_id ?? "");
    const rows = stored && stored.context_id === contextId ? [stored] : [];
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (name === "henyong_lifecycle_registry_cas") {
    const contextId = String(body.p_context_id ?? "");
    const expectedRevision = body.p_expected_revision as number | null;
    const nextRevision = Number(body.p_next_revision);
    const registry = body.p_registry;

    let swapped = false;
    if (expectedRevision === null) {
      if (stored === null) {
        stored = { context_id: contextId, revision: nextRevision, registry };
        swapped = true;
      }
    } else if (
      stored !== null &&
      stored.context_id === contextId &&
      stored.revision === expectedRevision
    ) {
      stored = { context_id: contextId, revision: nextRevision, registry };
      swapped = true;
    }

    return new Response(JSON.stringify(swapped), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unexpected_rpc" }), { status: 404 });
};

const store = createSupabaseLifecycleRegistryStore({
  url: "https://example.supabase.co/",
  serviceRoleKey: "test-service-role-key-not-a-real-secret",
  fetchImpl: mockFetch,
});
assert(store.storageClass === "EXTERNAL_STORE", "Supabase adapter must declare external storage class");

const weave = weaveSignals({
  signals: [
    {
      id: "supabase-persist-fact",
      kind: "FACT",
      text: "Supabase lifecycle fixture exists.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "fixture-sensor",
        observedAt: "2026-10-25T08:00:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "supabase-persist-candidate",
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
  packetId: "supabase-persist-architecture",
  objective: "Exercise external lifecycle persistence adapter.",
  weave,
  successCriteria: ["Atomic CAS path preserves replay state."],
  nonGoals: ["No live Supabase project connection."],
  intentEnvelope: {
    allowedActionTypes: ["WRITE"],
    allowedScopes: ["SANDBOX"],
    allowedDataSensitivities: ["INTERNAL"],
    requireReversible: true,
    allowSecrets: false,
  },
});

const first = bindArchitectureLifecycle(
  architecture,
  {
    lifecycleId: "supabase-life-1",
    contextId: "supabase-context",
    issuedAt: "2026-10-25T08:00:00.000Z",
    expiresAt: "2026-10-25T09:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  },
  new Date("2026-10-25T08:10:00.000Z"),
);

const persistedFirst = await persistArchitectureState(store, first);
assert(persistedFirst.revision === 1, "external store must create revision one");
await assertPersistedArchitectureStateActive(store, first);

const second = bindArchitectureLifecycle(
  architecture,
  {
    lifecycleId: "supabase-life-2",
    contextId: "supabase-context",
    issuedAt: "2026-10-25T08:15:00.000Z",
    expiresAt: "2026-10-25T09:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
    supersedesLifecycleId: "supabase-life-1",
  },
  new Date("2026-10-25T08:20:00.000Z"),
);

const persistedSecond = await persistArchitectureState(store, second);
assert(persistedSecond.revision === 2, "external CAS update must increment revision exactly once");
await assertPersistedArchitectureStateActive(store, second);

assert(
  rpcCalls.includes("henyong_lifecycle_registry_load") &&
    rpcCalls.includes("henyong_lifecycle_registry_cas"),
  "adapter must use the service-role RPC load/CAS boundary",
);
const reloaded = await store.load("supabase-context");
assert(reloaded?.revision === 2, "mock external row must retain the latest revision");

stored = {
  context_id: "supabase-context",
  revision: 3,
  registry: { version: "forged-version", entries: [] },
};
await rejectsWith(
  () => store.load("supabase-context"),
  "lifecycle_store_registry_invalid",
  "external row with unknown registry version must fail closed",
);

stored = {
  context_id: "supabase-context",
  revision: 3,
  registry: {
    version: REPLAY_GUARD_VERSION,
    entries: [
      {
        lifecycleId: "cross-context-life",
        kind: "ARCHITECTURE",
        contextId: "other-context",
        trustBinding: "fixture-binding",
        issuedAt: "2026-10-25T08:00:00.000Z",
        expiresAt: "2026-10-25T09:00:00.000Z",
      },
    ],
  },
};
await rejectsWith(
  () => store.load("supabase-context"),
  "lifecycle_store_cross_context_entry",
  "external row must not smuggle another context into the active registry",
);

const backendError = "lifecycle_store_backend_error";
const internalDetail = "service_role internal_lifecycle_registry database error detail fixture-only";

function isolatedStore(fetchImpl: typeof fetch) {
  return createSupabaseLifecycleRegistryStore({
    url: "https://example.supabase.co/",
    serviceRoleKey: "test-service-role-key-not-a-real-secret",
    fetchImpl,
  });
}

async function rejectsSanitized(action: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try { await action(); }
  catch (error) {
    rejected = true;
    assert(error instanceof Error && error.message === backendError, message);
    assert(!("cause" in error), "provider failures must not survive through Error.cause");
    assert(!String(error.stack).includes(internalDetail), "stack must not include provider diagnostics");
    assert(!JSON.stringify(error).includes(internalDetail), "serialized error must not expose provider diagnostics");
  }
  assert(rejected, message);
}

{
  let bodyRead = false;
  const response = new Response(internalDetail, { status: 500 });
  response.text = async () => { bodyRead = true; return internalDetail; };
  const failing = isolatedStore(async () => response);
  await rejectsSanitized(() => failing.load("supabase-context"), "HTTP errors must expose a fixed code only");
  assert(!bodyRead, "failed provider response body must not be read to construct an error");
}

{
  const failing = isolatedStore(async () => { throw new Error(internalDetail); });
  await rejectsSanitized(() => failing.load("supabase-context"), "transport rejection detail must be sanitized");
}

{
  const response = new Response("{}", { status: 200 });
  response.json = async () => { throw new Error(internalDetail); };
  const failing = isolatedStore(async () => response);
  await rejectsSanitized(() => failing.load("supabase-context"), "JSON parser rejection detail must be sanitized");
}

{
  const failing = isolatedStore(async () => new Response(internalDetail, { status: 200 }));
  await rejectsSanitized(() => failing.load("supabase-context"), "invalid JSON must expose no raw parse input");
}

for (const payload of [null, {}, true, internalDetail, [null], [internalDetail], [{}, {}]]) {
  const malformed = isolatedStore(async () => new Response(JSON.stringify(payload), { status: 200 }));
  await rejectsSanitized(() => malformed.load("supabase-context"), "malformed load result must fail closed");
}

const emptyNext: StoredLifecycleRegistry = {
  version: LIFECYCLE_STORE_VERSION,
  contextId: "supabase-context",
  revision: 1,
  registry: { version: REPLAY_GUARD_VERSION, entries: [] },
};
for (const payload of [null, {}, [], "true", 1, internalDetail]) {
  const malformed = isolatedStore(async () => new Response(JSON.stringify(payload), { status: 200 }));
  await rejectsSanitized(() => malformed.compareAndSwap("supabase-context", null, emptyNext),
    "CAS must require a boolean result, never a truthy cast");
}

for (const swapped of [true, false]) {
  const valid = isolatedStore(async () => new Response(JSON.stringify(swapped), { status: 200 }));
  assert(await valid.compareAndSwap("supabase-context", null, emptyNext) === swapped,
    "the adapter must preserve actual CAS success/conflict booleans");
}

{
  const emptyResponse = isolatedStore(async () => new Response(null, { status: 204 }));
  await rejectsSanitized(() => emptyResponse.load("supabase-context"), "load must reject a bodyless response");
  await rejectsSanitized(() => emptyResponse.compareAndSwap("supabase-context", null, emptyNext),
    "CAS must reject a bodyless response");
}

{
  let calls = 0;
  const oversizedRegistry = {
    version: REPLAY_GUARD_VERSION,
    entries: Array.from({ length: MAX_LIFECYCLE_ENTRIES_PER_CONTEXT + 1 }, (_, index) => ({
      lifecycleId: `oversized-${index}`, kind: "ARCHITECTURE" as const,
      contextId: "supabase-context", trustBinding: "fixture-binding",
      issuedAt: "2026-10-25T08:00:00.000Z", expiresAt: "2026-10-25T09:00:00.000Z",
    })),
  };
  const oversized = isolatedStore(async () => {
    calls += 1;
    return new Response(JSON.stringify([{
      context_id: "supabase-context", revision: 1, registry: oversizedRegistry,
    }]), { status: 200 });
  });
  await rejectsWith(() => oversized.load("supabase-context"), "lifecycle_registry_capacity_exceeded",
    "external oversized registries must be rejected before use");
  await rejectsWith(() => oversized.compareAndSwap("supabase-context", null, {
    ...emptyNext, registry: oversizedRegistry,
  }), "lifecycle_registry_capacity_exceeded", "outgoing oversized CAS must be rejected before transport");
  assert(calls === 1, "oversized CAS must not reach the backend");
}

console.log("Supabase replay-store adapter, capacity and sanitized-error tests passed");
