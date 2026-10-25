import {
  EXECUTION_ATTEMPT_VERSION,
  verifyExecutionAttemptClaim,
  type ExecutionAttemptRecord,
  type ExecutionAttemptStore,
  type ExecutionAttemptClaim,
} from "./execution-attempt.js";
import {
  verifyIdentityBoundExecutionReceipt,
  type IdentityBoundExecutionReceipt,
} from "./execution-evidence.js";
import type { SupabaseRuntimeConfig } from "./supabase.js";

export const SUPABASE_EXECUTION_ATTEMPT_STORE_VERSION = "2026-10-25.1" as const;

export type SupabaseExecutionAttemptStoreConfig = Pick<
  SupabaseRuntimeConfig,
  "url" | "serviceRoleKey" | "fetchImpl"
>;

interface AttemptRow {
  status: "RESERVED" | "FINALIZED";
  claim: unknown;
  receipt: unknown | null;
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

function parseAttemptRow(row: AttemptRow): ExecutionAttemptRecord {
  const claim = row.claim as ExecutionAttemptClaim;
  if (!verifyExecutionAttemptClaim(claim)) throw new Error("stored_execution_attempt_claim_invalid");
  if (row.status !== "RESERVED" && row.status !== "FINALIZED") {
    throw new Error("stored_execution_attempt_status_invalid");
  }

  if (row.status === "RESERVED") {
    if (row.receipt !== null) throw new Error("reserved_execution_attempt_has_receipt");
    return {
      version: EXECUTION_ATTEMPT_VERSION,
      status: "RESERVED",
      claim,
    };
  }

  const receipt = row.receipt as IdentityBoundExecutionReceipt;
  if (!verifyIdentityBoundExecutionReceipt(receipt)) {
    throw new Error("stored_execution_receipt_invalid");
  }
  if (receipt.receipt.preExecutionBinding !== claim.preExecutionBinding) {
    throw new Error("stored_execution_receipt_pre_execution_mismatch");
  }
  if (receipt.receipt.executorId !== claim.executorId) {
    throw new Error("stored_execution_receipt_executor_mismatch");
  }
  if (receipt.executorIdentityBinding !== claim.executorIdentityBinding) {
    throw new Error("stored_execution_receipt_identity_mismatch");
  }

  return {
    version: EXECUTION_ATTEMPT_VERSION,
    status: "FINALIZED",
    claim,
    receipt,
  };
}

export function createSupabaseExecutionAttemptStore(
  config: SupabaseExecutionAttemptStoreConfig,
): ExecutionAttemptStore {
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
      throw new Error(`Supabase execution attempt RPC failed (${response.status}): ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    storageClass: "EXTERNAL_STORE",

    async loadByPreExecutionBinding(preExecutionBinding: string): Promise<ExecutionAttemptRecord | null> {
      const rows = await rpc<AttemptRow[]>("henyong_execution_attempt_load", {
        p_pre_execution_binding: preExecutionBinding,
      });
      const row = rows[0];
      return row ? parseAttemptRow(row) : null;
    },

    async reserveOnce(claim: ExecutionAttemptClaim): Promise<boolean> {
      if (!verifyExecutionAttemptClaim(claim)) throw new Error("execution_attempt_claim_invalid");
      return rpc<boolean>("henyong_execution_attempt_reserve", {
        p_pre_execution_binding: claim.preExecutionBinding,
        p_attempt_id: claim.attemptId,
        p_claim: claim,
        p_reserved_at: claim.reservedAt,
      });
    },

    async finalizeOnce(
      preExecutionBinding: string,
      expectedAttemptId: string,
      receipt: IdentityBoundExecutionReceipt,
    ): Promise<boolean> {
      if (!verifyIdentityBoundExecutionReceipt(receipt)) throw new Error("execution_receipt_invalid");
      return rpc<boolean>("henyong_execution_attempt_finalize", {
        p_pre_execution_binding: preExecutionBinding,
        p_expected_attempt_id: expectedAttemptId,
        p_receipt: receipt,
      });
    },
  };
}
