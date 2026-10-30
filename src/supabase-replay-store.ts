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
> & {
  /** Trusted server-side pin for native transport. Required when using global fetch. */
  expectedOrigin?: string;
};

function parseHttpsOrigin(value: string, label: string): URL {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}_empty`);
  }
  let parsed: URL;
  try { parsed = new URL(value.trim()); }
  catch { throw new TypeError(`${label}_invalid`); }
  if (parsed.protocol !== "https:") throw new TypeError("supabase_https_required");
  if (parsed.username || parsed.password) throw new TypeError("supabase_url_credentials_forbidden");
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new TypeError(`${label}_must_be_origin`);
  }
  return parsed;
}

function normalizeBaseUrl(
  url: string,
  expectedOrigin: string | undefined,
  customTransport: boolean,
): string {
  const parsed = parseHttpsOrigin(url, "supabase_url");

  // Native fetch carries a real service-role credential, so the destination must
  // be independently pinned by trusted server configuration. A custom fetch is
  // itself an injected trusted transport boundary (used by tests); callers may
  // still provide expectedOrigin and receive the same exact-origin enforcement.
  if (expectedOrigin === undefined) {
    if (!customTransport) throw new TypeError("supabase_expected_origin_required");
    return parsed.origin;
  }

  const expected = parseHttpsOrigin(expectedOrigin, "supabase_expected_origin");
  if (parsed.origin !== expected.origin) throw new Error("supabase_origin_mismatch");
  return parsed.origin;
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
  const customTransport = config.fetchImpl !== undefined;
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(config.url, config.expectedOrigin, customTransport);
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
