import {
  verifyIdentityBoundExecutionReceipt,
  type IdentityBoundExecutionReceipt,
} from "./execution-evidence.js";
import type { ExecutionReceiptStore } from "./receipt-store.js";
import type { SupabaseRuntimeConfig } from "./supabase.js";

export const SUPABASE_RECEIPT_STORE_VERSION = "2026-10-25.1" as const;

export type SupabaseReceiptStoreConfig = Pick<
  SupabaseRuntimeConfig,
  "url" | "serviceRoleKey" | "fetchImpl"
>;

interface ReceiptRow {
  receipt: unknown;
}

function normalizeBaseUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (normalized.length === 0) throw new TypeError("supabase_url_empty");
  return normalized;
}

function assertServiceRoleKey(key: string): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("supabase_service_role_key_empty");
  }
  return key;
}

function parseReceipt(value: unknown): IdentityBoundExecutionReceipt {
  const receipt = value as IdentityBoundExecutionReceipt;
  if (!verifyIdentityBoundExecutionReceipt(receipt)) {
    throw new Error("stored_execution_receipt_invalid");
  }
  return receipt;
}

export function createSupabaseExecutionReceiptStore(
  config: SupabaseReceiptStoreConfig,
): ExecutionReceiptStore {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(config.url);
  const serviceRoleKey = assertServiceRoleKey(config.serviceRoleKey);

  async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase receipt RPC failed (${response.status}): ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function load(name: string, body: Record<string, unknown>): Promise<IdentityBoundExecutionReceipt | null> {
    const rows = await rpc<ReceiptRow[]>(name, body);
    const row = rows[0];
    return row ? parseReceipt(row.receipt) : null;
  }

  return {
    storageClass: "EXTERNAL_STORE",

    loadByReceiptId(receiptId: string) {
      return load("henyong_execution_receipt_load_by_id", { p_receipt_id: receiptId });
    },

    loadByPreExecutionBinding(preExecutionBinding: string) {
      return load("henyong_execution_receipt_load_by_pre_execution", {
        p_pre_execution_binding: preExecutionBinding,
      });
    },

    async appendOnce(receipt: IdentityBoundExecutionReceipt): Promise<boolean> {
      if (!verifyIdentityBoundExecutionReceipt(receipt)) throw new Error("execution_receipt_invalid");
      return rpc<boolean>("henyong_execution_receipt_append", {
        p_receipt_id: receipt.receipt.receiptId,
        p_pre_execution_binding: receipt.receipt.preExecutionBinding,
        p_receipt: receipt,
      });
    },
  };
}
