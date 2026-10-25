import type { IdentityBoundExecutionReceipt } from "./execution-evidence.js";
import {
  createInMemoryExecutionReceiptStore,
  persistIdentityBoundExecutionReceipt,
} from "./receipt-store.js";

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

function fakeReceipt(receiptId: string, preExecutionBinding: string): IdentityBoundExecutionReceipt {
  return {
    version: "2026-10-25.1",
    trust: "EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT",
    receipt: {
      version: "2026-10-25.1",
      trust: "UNAUTHENTICATED_EXECUTION_RECEIPT",
      receiptId,
      preExecutionBinding,
      proposalBinding: "fake-proposal-binding",
      adapterId: "adapter-a",
      executorId: "executor-a",
      principal: "VERIFIED_SAL",
      sessionId: "session-a",
      resourceStateBeforeBinding: "state-binding",
      resourceStateBeforeToken: "state-token",
      outcome: "UNKNOWN",
      startedAt: "2026-10-25T10:00:00.000Z",
      completedAt: "2026-10-25T10:00:01.000Z",
      binding: "intentionally-invalid-inner-binding",
    },
    executorIdentityBinding: "executor-binding",
    executorIdentityProviderId: "provider-a",
    executorIdentityAssurance: "SIGNED_ASSERTION",
    executorIdentitySubjectRef: "subject://executor-a",
    binding: "intentionally-invalid-outer-binding",
  };
}

const store = createInMemoryExecutionReceiptStore();
const first = fakeReceipt("receipt-1", "preexec-1");
assert(await store.appendOnce(first), "first receipt/pre-execution pair must append");
assert(!(await store.appendOnce(first)), "duplicate receipt ID must be rejected");
assert(
  !(await store.appendOnce(fakeReceipt("receipt-2", "preexec-1"))),
  "different receipt ID must not reuse the same pre-execution binding",
);

const loadedById = await store.loadByReceiptId("receipt-1");
assert(loadedById?.receipt.receiptId === "receipt-1", "receipt must load by ID");
const loadedByPreExecution = await store.loadByPreExecutionBinding("preexec-1");
assert(loadedByPreExecution?.receipt.receiptId === "receipt-1", "receipt must load by pre-execution binding");

await rejectsWith(
  () => persistIdentityBoundExecutionReceipt(
    createInMemoryExecutionReceiptStore(),
    fakeReceipt("invalid-receipt", "invalid-preexec"),
  ),
  "execution_receipt_invalid",
  "high-level persistence helper must reject an invalid deterministic receipt binding",
);

console.log("append-once receipt store tests passed");
