import {
  LIFECYCLE_STORE_VERSION,
  assertStoredLifecycleRegistry,
  type LifecycleRegistryStore,
  type StoredLifecycleRegistry,
} from "./replay-store.js";
import {
  MAX_LIFECYCLE_ENTRIES_PER_CONTEXT,
  REPLAY_GUARD_VERSION,
  type LifecycleRegistry,
} from "./replay.js";
import type { SupabaseRuntimeConfig } from "./supabase.js";

export const SUPABASE_REPLAY_STORE_VERSION = "2026-10-25.1" as const;

export type SupabaseReplayStoreConfig = Pick<
  SupabaseRuntimeConfig,
  "url" | "serviceRoleKey" | "fetchImpl"
>;

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
  if (record.version !== REPLAY_GUARD_VERSION || !Array.isArray(record.entries)) {
    throw new Error("lifecycle_store_registry_invalid");
  }
  if (record.entries.length > MAX_LIFECYCLE_ENTRIES_PER_CONTEXT) {
    throw new Error("lifecycle_registry_capacity_exceeded");
  }

  return value as LifecycleRegistry;
}

function parseStoredRow(row: unknown, expectedContextId: string): StoredLifecycleRegistry {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("lifecycle_store_backend_error");
  }
  const record = row as Record<string, unknown>;
  if (record.context_id !== expectedContextId) throw new Error("lifecycle_store_context_mismatch");
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision) || record.revision < 1) {
    throw new Error("lifecycle_store_revision_invalid");
  }

  const stored: StoredLifecycleRegistry = {
    version: LIFECYCLE_STORE_VERSION,
    contextId: expectedContextId,
    revision: record.revision,
    registry: parseRegistry(record.registry),
  };
  assertStoredLifecycleRegistry(stored, expectedContextId);
  return stored;
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

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    try {
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

      if (!response.ok) throw new Error("lifecycle_store_backend_error");
      if (response.status === 204) return undefined;
      return await response.json();
    } catch {
      // Provider, transport and parser diagnostics may contain secrets. Do not
      // read failed response bodies or retain the original error as a cause.
      throw new Error("lifecycle_store_backend_error");
    }
  }

  return {
    storageClass: "EXTERNAL_STORE",

    async load(contextId: string): Promise<StoredLifecycleRegistry | null> {
      const rows = await rpc("henyong_lifecycle_registry_load", {
        p_context_id: contextId,
      });
      if (!Array.isArray(rows) || rows.length > 1) {
        throw new Error("lifecycle_store_backend_error");
      }
      return rows.length === 0 ? null : parseStoredRow(rows[0], contextId);
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
      assertStoredLifecycleRegistry(next, contextId);

      const swapped = await rpc("henyong_lifecycle_registry_cas", {
        p_context_id: contextId,
        p_expected_revision: expectedRevision,
        p_next_revision: next.revision,
        p_registry: next.registry,
      });
      if (typeof swapped !== "boolean") throw new Error("lifecycle_store_backend_error");
      return swapped;
    },
  };
}
