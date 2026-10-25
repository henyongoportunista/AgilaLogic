import {
  verifyIdentityBoundExecutionReceipt,
  type IdentityBoundExecutionReceipt,
} from "./execution-evidence.js";

export const RECEIPT_STORE_VERSION = "2026-10-25.1" as const;

export type ReceiptStorageClass = "TEST_MEMORY" | "EXTERNAL_STORE";

export interface ExecutionReceiptStore {
  storageClass: ReceiptStorageClass;
  loadByReceiptId(receiptId: string): Promise<IdentityBoundExecutionReceipt | null>;
  loadByPreExecutionBinding(preExecutionBinding: string): Promise<IdentityBoundExecutionReceipt | null>;
  appendOnce(receipt: IdentityBoundExecutionReceipt): Promise<boolean>;
}

function cloneReceipt(receipt: IdentityBoundExecutionReceipt): IdentityBoundExecutionReceipt {
  return structuredClone(receipt);
}

/**
 * Durable boundary helper. One pre-execution request may produce at most one
 * persisted receipt attempt. A retry after FAILED/UNKNOWN must obtain a new
 * pre-execution request rather than silently reusing the old consequence token.
 */
export async function persistIdentityBoundExecutionReceipt(
  store: ExecutionReceiptStore,
  receipt: IdentityBoundExecutionReceipt,
): Promise<void> {
  if (!verifyIdentityBoundExecutionReceipt(receipt)) {
    throw new Error("execution_receipt_invalid");
  }
  const appended = await store.appendOnce(receipt);
  if (!appended) throw new Error("execution_receipt_replay_or_duplicate");
}

/**
 * Test-only implementation. It models append-once uniqueness for receiptId and
 * preExecutionBinding in one process; it is not durable production storage.
 */
export function createInMemoryExecutionReceiptStore(): ExecutionReceiptStore {
  const byReceiptId = new Map<string, IdentityBoundExecutionReceipt>();
  const byPreExecutionBinding = new Map<string, string>();

  return {
    storageClass: "TEST_MEMORY",

    async loadByReceiptId(receiptId: string): Promise<IdentityBoundExecutionReceipt | null> {
      const receipt = byReceiptId.get(receiptId);
      return receipt ? cloneReceipt(receipt) : null;
    },

    async loadByPreExecutionBinding(preExecutionBinding: string): Promise<IdentityBoundExecutionReceipt | null> {
      const receiptId = byPreExecutionBinding.get(preExecutionBinding);
      if (!receiptId) return null;
      const receipt = byReceiptId.get(receiptId);
      return receipt ? cloneReceipt(receipt) : null;
    },

    async appendOnce(receipt: IdentityBoundExecutionReceipt): Promise<boolean> {
      const receiptId = receipt.receipt.receiptId;
      const preExecutionBinding = receipt.receipt.preExecutionBinding;
      if (byReceiptId.has(receiptId) || byPreExecutionBinding.has(preExecutionBinding)) {
        return false;
      }
      byReceiptId.set(receiptId, cloneReceipt(receipt));
      byPreExecutionBinding.set(preExecutionBinding, receiptId);
      return true;
    },
  };
}
