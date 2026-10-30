import {
  MAX_LIFECYCLE_ENTRIES_PER_CONTEXT,
  REPLAY_GUARD_VERSION,
  assertArchitectureStateActive,
  assertEngineeringStateActive,
  createLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
  type LifecycleRegistry,
} from "./replay.js";
import type { BoundArchitectureState, BoundEngineeringState } from "./trust.js";

export const LIFECYCLE_STORE_VERSION = "2026-10-25.1" as const;

export type LifecycleStorageClass = "TEST_MEMORY" | "EXTERNAL_STORE";

export interface StoredLifecycleRegistry {
  version: typeof LIFECYCLE_STORE_VERSION;
  contextId: string;
  revision: number;
  registry: LifecycleRegistry;
}

/**
 * Persistence boundary for replay/supersession state.
 *
 * compareAndSwap MUST be atomic in a production implementation. The interface
 * cannot prove that an external adapter actually provides durability or atomicity;
 * those properties must be established by the storage implementation and tests.
 */
export interface LifecycleRegistryStore {
  storageClass: LifecycleStorageClass;
  load(contextId: string): Promise<StoredLifecycleRegistry | null>;
  compareAndSwap(
    contextId: string,
    expectedRevision: number | null,
    next: StoredLifecycleRegistry,
  ): Promise<boolean>;
}

const MAX_RETRIES = 3;

function cloneRegistry(registry: LifecycleRegistry): LifecycleRegistry {
  return {
    version: registry.version,
    entries: registry.entries.map((entry) => ({ ...entry })),
  };
}

function cloneStored(stored: StoredLifecycleRegistry): StoredLifecycleRegistry {
  return {
    version: stored.version,
    contextId: stored.contextId,
    revision: stored.revision,
    registry: cloneRegistry(stored.registry),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseIso(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("lifecycle_store_registry_invalid_time");
  }
  return parsed.getTime();
}

/**
 * Validates data reloaded from an external replay store before it can influence
 * active/superseded state. This is structural validation, not storage authentication.
 */
export function assertStoredLifecycleRegistry(
  stored: StoredLifecycleRegistry,
  expectedContextId: string,
): void {
  if (stored.version !== LIFECYCLE_STORE_VERSION) {
    throw new Error("lifecycle_store_version_mismatch");
  }
  if (stored.contextId !== expectedContextId) {
    throw new Error("lifecycle_store_context_mismatch");
  }
  if (!Number.isInteger(stored.revision) || stored.revision < 1) {
    throw new Error("lifecycle_store_revision_invalid");
  }
  if (
    !stored.registry ||
    stored.registry.version !== REPLAY_GUARD_VERSION ||
    !Array.isArray(stored.registry.entries)
  ) {
    throw new Error("lifecycle_store_registry_invalid");
  }
  if (stored.registry.entries.length > MAX_LIFECYCLE_ENTRIES_PER_CONTEXT) {
    throw new Error("lifecycle_registry_capacity_exceeded");
  }

  const byId = new Map<string, (typeof stored.registry.entries)[number]>();
  const supersededTargets = new Set<string>();

  for (const entry of stored.registry.entries) {
    if (!entry || typeof entry !== "object") throw new Error("lifecycle_store_registry_entry_invalid");
    if (!isNonEmptyString(entry.lifecycleId) || !isNonEmptyString(entry.trustBinding)) {
      throw new Error("lifecycle_store_registry_entry_invalid");
    }
    if (entry.kind !== "ARCHITECTURE" && entry.kind !== "ENGINEERING") {
      throw new Error("lifecycle_store_registry_entry_invalid");
    }
    if (entry.contextId !== expectedContextId) {
      throw new Error("lifecycle_store_cross_context_entry");
    }
    const issuedAt = parseIso(entry.issuedAt);
    const expiresAt = parseIso(entry.expiresAt);
    if (expiresAt <= issuedAt) throw new Error("lifecycle_store_registry_invalid_window");
    if (byId.has(entry.lifecycleId)) throw new Error("lifecycle_store_duplicate_lifecycle");
    byId.set(entry.lifecycleId, entry);

    if (entry.supersededByLifecycleId !== undefined) {
      if (!isNonEmptyString(entry.supersededByLifecycleId)) {
        throw new Error("lifecycle_store_registry_entry_invalid");
      }
      if (entry.supersededByLifecycleId === entry.lifecycleId) {
        throw new Error("lifecycle_store_self_supersession");
      }
      if (supersededTargets.has(entry.supersededByLifecycleId)) {
        throw new Error("lifecycle_store_multiple_predecessors");
      }
      supersededTargets.add(entry.supersededByLifecycleId);
    }
  }

  for (const entry of stored.registry.entries) {
    if (entry.supersededByLifecycleId === undefined) continue;
    const successor = byId.get(entry.supersededByLifecycleId);
    if (!successor) throw new Error("lifecycle_store_missing_successor");
    if (successor.kind !== entry.kind) throw new Error("lifecycle_store_supersession_kind_mismatch");
    if (successor.contextId !== entry.contextId) throw new Error("lifecycle_store_supersession_context_mismatch");
    if (new Date(successor.issuedAt).getTime() < new Date(entry.issuedAt).getTime()) {
      throw new Error("lifecycle_store_supersession_time_reversal");
    }
  }
}

async function persistWithCas(
  store: LifecycleRegistryStore,
  contextId: string,
  register: (registry: LifecycleRegistry) => LifecycleRegistry,
): Promise<StoredLifecycleRegistry> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await store.load(contextId);
    if (current) assertStoredLifecycleRegistry(current, contextId);

    const baseRegistry = current ? cloneRegistry(current.registry) : createLifecycleRegistry();
    const nextRegistry = register(baseRegistry);
    const next: StoredLifecycleRegistry = {
      version: LIFECYCLE_STORE_VERSION,
      contextId,
      revision: (current?.revision ?? 0) + 1,
      registry: nextRegistry,
    };
    assertStoredLifecycleRegistry(next, contextId);

    const swapped = await store.compareAndSwap(
      contextId,
      current?.revision ?? null,
      cloneStored(next),
    );
    if (swapped) return next;
  }

  throw new Error("lifecycle_store_conflict");
}

export function persistArchitectureState(
  store: LifecycleRegistryStore,
  state: BoundArchitectureState,
): Promise<StoredLifecycleRegistry> {
  return persistWithCas(
    store,
    state.lifecycle.contextId,
    (registry) => registerArchitectureState(registry, state),
  );
}

export function persistEngineeringState(
  store: LifecycleRegistryStore,
  state: BoundEngineeringState,
): Promise<StoredLifecycleRegistry> {
  return persistWithCas(
    store,
    state.lifecycle.contextId,
    (registry) => registerEngineeringState(registry, state),
  );
}

export async function assertPersistedArchitectureStateActive(
  store: LifecycleRegistryStore,
  state: BoundArchitectureState,
): Promise<void> {
  const stored = await store.load(state.lifecycle.contextId);
  if (!stored) throw new Error("lifecycle_not_persisted");
  assertStoredLifecycleRegistry(stored, state.lifecycle.contextId);
  assertArchitectureStateActive(stored.registry, state);
}

export async function assertPersistedEngineeringStateActive(
  store: LifecycleRegistryStore,
  state: BoundEngineeringState,
): Promise<void> {
  const stored = await store.load(state.lifecycle.contextId);
  if (!stored) throw new Error("lifecycle_not_persisted");
  assertStoredLifecycleRegistry(stored, state.lifecycle.contextId);
  assertEngineeringStateActive(stored.registry, state);
}

/**
 * Checks both lifecycles against the same loaded and validated registry version.
 * This is not an atomic check-and-execute operation for a future external effect.
 */
export async function assertPersistedLifecyclePairActive(
  store: LifecycleRegistryStore,
  architectureState: BoundArchitectureState,
  engineeringState: BoundEngineeringState,
): Promise<void> {
  const contextId = architectureState.lifecycle.contextId;
  if (engineeringState.lifecycle.contextId !== contextId) {
    throw new Error("packet_context_mismatch");
  }
  const stored = await store.load(contextId);
  if (!stored) throw new Error("lifecycle_not_persisted");
  assertStoredLifecycleRegistry(stored, contextId);
  assertArchitectureStateActive(stored.registry, architectureState);
  assertEngineeringStateActive(stored.registry, engineeringState);
}

/**
 * Test-only CAS store. It models atomic revision semantics inside one process but
 * is neither durable nor suitable for production replay protection.
 */
export function createInMemoryLifecycleRegistryStore(): LifecycleRegistryStore {
  const records = new Map<string, StoredLifecycleRegistry>();

  return {
    storageClass: "TEST_MEMORY",

    async load(contextId: string): Promise<StoredLifecycleRegistry | null> {
      const record = records.get(contextId);
      if (!record) return null;
      const cloned = cloneStored(record);
      assertStoredLifecycleRegistry(cloned, contextId);
      return cloned;
    },

    async compareAndSwap(
      contextId: string,
      expectedRevision: number | null,
      next: StoredLifecycleRegistry,
    ): Promise<boolean> {
      const current = records.get(contextId);
      if (expectedRevision === null) {
        if (current) return false;
      } else if (!current || current.revision !== expectedRevision) {
        return false;
      }

      if (next.contextId !== contextId) throw new Error("lifecycle_store_context_mismatch");
      if (next.revision !== (current?.revision ?? 0) + 1) {
        throw new Error("lifecycle_store_revision_jump");
      }
      assertStoredLifecycleRegistry(next, contextId);
      records.set(contextId, cloneStored(next));
      return true;
    },
  };
}
