import { createSupabaseExecutionReceiptStore } from "./supabase-receipt-store.js";

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

const rpcCalls: string[] = [];
const mockFetch: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const name = url.split("/").at(-1) ?? "";
  rpcCalls.push(name);
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const store = createSupabaseExecutionReceiptStore({
  url: "https://example.supabase.co/",
  serviceRoleKey: "test-service-role-key-not-a-real-secret",
  fetchImpl: mockFetch,
});
assert(store.storageClass === "EXTERNAL_STORE", "Supabase receipt adapter must declare external storage");
assert(await store.loadByReceiptId("missing") === null, "missing receipt ID must return null");
assert(
  await store.loadByPreExecutionBinding("missing-preexec") === null,
  "missing pre-execution receipt must return null",
);
assert(rpcCalls.includes("henyong_execution_receipt_load_by_id"), "receipt ID load RPC must be used");
assert(
  rpcCalls.includes("henyong_execution_receipt_load_by_pre_execution"),
  "pre-execution load RPC must be used",
);

await rejectsWith(
  () => store.appendOnce({
    version: "2026-10-25.1",
    trust: "EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT",
    receipt: {
      version: "2026-10-25.1",
      trust: "UNAUTHENTICATED_EXECUTION_RECEIPT",
      receiptId: "invalid",
      preExecutionBinding: "invalid",
      proposalBinding: "invalid",
      adapterId: "adapter",
      executorId: "executor",
      principal: "UNVERIFIED_PUBLIC",
      sessionId: "session",
      resourceStateBeforeBinding: "state",
      resourceStateBeforeToken: "token",
      outcome: "UNKNOWN",
      startedAt: "2026-10-25T10:00:00.000Z",
      completedAt: "2026-10-25T10:00:01.000Z",
      binding: "bad",
    },
    executorIdentityBinding: "bad",
    executorIdentityProviderId: "provider",
    executorIdentityAssurance: "SIGNED_ASSERTION",
    executorIdentitySubjectRef: "subject",
    binding: "bad",
  }),
  "execution_receipt_invalid",
  "Supabase adapter must reject invalid receipt binding before network append",
);

console.log("Supabase receipt-store boundary tests passed");
