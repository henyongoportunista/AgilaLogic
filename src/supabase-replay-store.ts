import {
  LIFECYCLE_STORE_VERSION,
  type LifecycleRegistryStore,
  type StoredLifecycleRegistry,
} from "./replay-store.js";
import type { LifecycleRegistry } from "./replay.js";
import type { SupabaseRuntimeConfig } from "./supabase.js";

export const SUPABASE_REPLAY_STORE_VERSION = "2026-10-25.1" as const;

export type SupabaseReplayStoreConfig = Pick<
  SupabaseRuntimeConfig,
  "url" | "serviceRoleKey" | "fetchImpl"
>;

interface LifecycleRegistryRow {
  context_id: string;
  revision: number;
  registry: unknown;
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

function parseRegistry(value: unknown): LifecycleRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("lifecycle_store_registry_invalid");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.version !== "string" || !Array.isArray(record.entries)) {
    throw new Error("lifecycle_store_registry_invalid");
  }

  return value as LifecycleRegistry;
}

function parseStoredRow(row: LifecycleRegistryRow, expectedContextId: string): StoredLifecycleRegistry {
  if (row.context_id !== expectedContextId) throw new Error("lifecycle_store_context_mismatch");
  if (!Number.isInteger(row.revision) || row.revision < 1) {
    throw new Error("lifecycle_store_revision_invalid");
  }

  return {
    version: LIFECYCLE_STORE_VERSION,
    contextId: row.context_id,
    revision: row.revision,
    registry: parseRegistry(row.registry),
  };
}

/**
 * Supabase/PostgREST implementation of LifecycleRegistryStore.
 *
 * It relies on two service-role-only SQL RPCs:
 * - henyong_lifecycle_registry_load
 * - henyong_lifecycle_registry_cas
 *
 * The CAS RPC must perform the revision comparison and write atomically inside
 * PostgreSQL. This adapter does not expose or log the service-role key.
 */
export function createSupabaseLifecycleRegistryStore(
  config: SupabaseReplayStoreConfig,
): LifecycleRegistryStore {
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
      throw new Error(`Supabase lifecycle RPC failed (${response.status}): ${text}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    storageClass: "EXTERNAL_STORE",

    async load(contextId: string): Promise<StoredLifecycleRegistry | null> {
      const rows = await rpc<LifecycleRegistryRow[]>("henyong_lifecycle_registry_load", {
        p_context_id: contextId,
      });
      const row = rows[0];
      return row ? parseStoredRow(row, contextId) : null;
    },

    async compareAndSwap(
      contextId: string,
      expectedRevision: number | null,
      next: StoredLifecycleRegistry,
    ): Promise<boolean> {
      if (next.version !== LIFECYCLE_STORE_VERSION) {
        throw new Error("lifecycle_store_version_mismatch");
      }
      if (next.contextId !== contextId) throw new Error("lifecycle_store_context_mismatch");
      if (next.revision !== (expectedRevision ?? 0) + 1) {
        throw new Error("lifecycle_store_revision_jump");
      }

      return rpc<boolean>("henyong_lifecycle_registry_cas", {
        p_context_id: contextId,
        p_expected_revision: expectedRevision,
        p_next_revision: next.revision,
        p_registry: next.registry,
      });
    },
  };
}
