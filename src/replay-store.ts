import {
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

function assertStoredRegistry(
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
  if (!stored.registry || !Array.isArray(stored.registry.entries)) {
    throw new Error("lifecycle_store_registry_invalid");
  }
  if (stored.registry.entries.some((entry) => entry.contextId !== expectedContextId)) {
    throw new Error("lifecycle_store_cross_context_entry");
  }
}

async function persistWithCas(
  store: LifecycleRegistryStore,
  contextId: string,
  register: (registry: LifecycleRegistry) => LifecycleRegistry,
): Promise<StoredLifecycleRegistry> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const current = await store.load(contextId);
    if (current) assertStoredRegistry(current, contextId);

    const baseRegistry = current ? cloneRegistry(current.registry) : createLifecycleRegistry();
    const nextRegistry = register(baseRegistry);
    if (nextRegistry.entries.some((entry) => entry.contextId !== contextId)) {
      throw new Error("lifecycle_store_cross_context_entry");
    }

    const next: StoredLifecycleRegistry = {
      version: LIFECYCLE_STORE_VERSION,
      contextId,
      revision: (current?.revision ?? 0) + 1,
      registry: nextRegistry,
    };

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
  assertStoredRegistry(stored, state.lifecycle.contextId);
  assertArchitectureStateActive(stored.registry, state);
}

export async function assertPersistedEngineeringStateActive(
  store: LifecycleRegistryStore,
  state: BoundEngineeringState,
): Promise<void> {
  const stored = await store.load(state.lifecycle.contextId);
  if (!stored) throw new Error("lifecycle_not_persisted");
  assertStoredRegistry(stored, state.lifecycle.contextId);
  assertEngineeringStateActive(stored.registry, state);
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
      return record ? cloneStored(record) : null;
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
      assertStoredRegistry(next, contextId);
      records.set(contextId, cloneStored(next));
      return true;
    },
  };
}
