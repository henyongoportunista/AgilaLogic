import type { BoundArchitectureState, BoundEngineeringState } from "./trust.js";

export const REPLAY_GUARD_VERSION = "2026-10-25.1" as const;

export type LifecycleKind = "ARCHITECTURE" | "ENGINEERING";

export interface LifecycleRegistryEntry {
  lifecycleId: string;
  kind: LifecycleKind;
  contextId: string;
  trustBinding: string;
  issuedAt: string;
  expiresAt: string;
  supersededByLifecycleId?: string;
}

export interface LifecycleRegistry {
  version: typeof REPLAY_GUARD_VERSION;
  entries: LifecycleRegistryEntry[];
}

export function createLifecycleRegistry(): LifecycleRegistry {
  return { version: REPLAY_GUARD_VERSION, entries: [] };
}

function assertRegistry(registry: LifecycleRegistry): void {
  if (registry.version !== REPLAY_GUARD_VERSION || !Array.isArray(registry.entries)) {
    throw new Error("invalid_lifecycle_registry");
  }
}

function register(
  registry: LifecycleRegistry,
  entry: Omit<LifecycleRegistryEntry, "supersededByLifecycleId">,
  supersedesLifecycleId?: string,
): LifecycleRegistry {
  assertRegistry(registry);
  if (registry.entries.some((item) => item.lifecycleId === entry.lifecycleId)) {
    throw new Error("lifecycle_replay_detected");
  }

  const next = registry.entries.map((item) => ({ ...item }));
  if (supersedesLifecycleId !== undefined) {
    const prior = next.find((item) => item.lifecycleId === supersedesLifecycleId);
    if (!prior) throw new Error("superseded_lifecycle_not_registered");
    if (prior.kind !== entry.kind) throw new Error("supersession_kind_mismatch");
    if (prior.contextId !== entry.contextId) throw new Error("supersession_context_mismatch");
    if (prior.supersededByLifecycleId !== undefined) throw new Error("lifecycle_already_superseded");
    prior.supersededByLifecycleId = entry.lifecycleId;
  }

  next.push({ ...entry });
  return { version: REPLAY_GUARD_VERSION, entries: next };
}

export function registerArchitectureState(
  registry: LifecycleRegistry,
  state: BoundArchitectureState,
): LifecycleRegistry {
  return register(
    registry,
    {
      lifecycleId: state.lifecycle.lifecycleId,
      kind: "ARCHITECTURE",
      contextId: state.lifecycle.contextId,
      trustBinding: state.trustBinding,
      issuedAt: state.lifecycle.issuedAt,
      expiresAt: state.lifecycle.expiresAt,
    },
    state.lifecycle.supersedesLifecycleId,
  );
}

export function registerEngineeringState(
  registry: LifecycleRegistry,
  state: BoundEngineeringState,
): LifecycleRegistry {
  return register(
    registry,
    {
      lifecycleId: state.lifecycle.lifecycleId,
      kind: "ENGINEERING",
      contextId: state.lifecycle.contextId,
      trustBinding: state.trustBinding,
      issuedAt: state.lifecycle.issuedAt,
      expiresAt: state.lifecycle.expiresAt,
    },
    state.lifecycle.supersedesLifecycleId,
  );
}

function assertActive(
  registry: LifecycleRegistry,
  lifecycleId: string,
  kind: LifecycleKind,
  contextId: string,
  trustBinding: string,
): void {
  assertRegistry(registry);
  const entry = registry.entries.find((item) => item.lifecycleId === lifecycleId);
  if (!entry) throw new Error("lifecycle_not_registered");
  if (entry.kind !== kind) throw new Error("lifecycle_kind_mismatch");
  if (entry.contextId !== contextId) throw new Error("lifecycle_context_mismatch");
  if (entry.trustBinding !== trustBinding) throw new Error("lifecycle_registry_binding_mismatch");
  if (entry.supersededByLifecycleId !== undefined) throw new Error("lifecycle_superseded");
}

export function assertArchitectureStateActive(
  registry: LifecycleRegistry,
  state: BoundArchitectureState,
): void {
  assertActive(
    registry,
    state.lifecycle.lifecycleId,
    "ARCHITECTURE",
    state.lifecycle.contextId,
    state.trustBinding,
  );
}

export function assertEngineeringStateActive(
  registry: LifecycleRegistry,
  state: BoundEngineeringState,
): void {
  assertActive(
    registry,
    state.lifecycle.lifecycleId,
    "ENGINEERING",
    state.lifecycle.contextId,
    state.trustBinding,
  );
}
