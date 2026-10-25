import { weaveSignals } from "./gagamba.js";
import {
  createSupabaseLifecycleRegistryStore,
} from "./supabase-replay-store.js";
import {
  assertPersistedArchitectureStateActive,
  persistArchitectureState,
} from "./replay-store.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { htArchitect } from "./strand.js";
import { bindArchitectureLifecycle } from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

console.log("Supabase replay-store adapter tests passed");
