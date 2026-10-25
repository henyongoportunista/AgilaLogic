import {
  normalizePacketLifecycle,
  verifyBoundArchitectureState,
  verifyBoundEngineeringState,
  type BoundArchitectureState,
  type BoundEngineeringState,
  type PacketLifecycle,
} from "./trust.js";

export const LIFECYCLE_REGISTRY_VERSION = "2026-10-25.1" as const;

export type LifecycleKind = "ARCHITECTURE" | "ENGINEERING";
export type LifecycleRegistryStatus = "ACTIVE" | "SUPERSEDED";

export interface LifecycleRegistryEntry {
  kind: LifecycleKind;
  contextId: string;
  lifecycleId: string;
  trustBinding: string;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string;
  status: LifecycleRegistryStatus;
  supersedesLifecycleId?: string;
  supersededByLifecycleId?: string;
}

export interface LifecycleRegistry {
  version: typeof LIFECYCLE_REGISTRY_VERSION;
  entries: LifecycleRegistryEntry[];
  binding: string;
}

const MAX_BINDING_LENGTH = 100_000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function registryBinding(registry: Omit<LifecycleRegistry, "binding">): string {
  return canonicalString(registry);
}

function normalizedEntry(entry: LifecycleRegistryEntry): LifecycleRegistryEntry {
  if (typeof entry !== "object" || entry === null) throw new Error("lifecycle_registry_entry_invalid");
  if (entry.kind !== "ARCHITECTURE" && entry.kind !== "ENGINEERING") {
    throw new Error("lifecycle_registry_kind_invalid");
  }
  if (entry.status !== "ACTIVE" && entry.status !== "SUPERSEDED") {
    throw new Error("lifecycle_registry_status_invalid");
  }
  if (typeof entry.trustBinding !== "string" || entry.trustBinding.length === 0 || entry.trustBinding.length > MAX_BINDING_LENGTH) {
    throw new Error("lifecycle_registry_trust_binding_invalid");
  }

  const lifecycle = normalizePacketLifecycle({
    lifecycleId: entry.lifecycleId,
    contextId: entry.contextId,
    issuedAt: entry.issuedAt,
    expiresAt: entry.expiresAt,
    policyVersion: entry.policyVersion,
    ...(entry.supersedesLifecycleId === undefined ? {} : { supersedesLifecycleId: entry.supersedesLifecycleId }),
  });

  if (entry.status === "ACTIVE" && entry.supersededByLifecycleId !== undefined) {
    throw new Error("active_lifecycle_has_successor");
  }
  if (entry.status === "SUPERSEDED" && entry.supersededByLifecycleId === undefined) {
    throw new Error("superseded_lifecycle_missing_successor");
  }
  if (entry.supersededByLifecycleId !== undefined) {
    if (typeof entry.supersededByLifecycleId !== "string" || entry.supersededByLifecycleId.trim().length === 0) {
      throw new Error("superseded_by_lifecycle_id_invalid");
    }
  }

  return {
    kind: entry.kind,
    contextId: lifecycle.contextId,
    lifecycleId: lifecycle.lifecycleId,
    trustBinding: entry.trustBinding,
    policyVersion: lifecycle.policyVersion,
    issuedAt: lifecycle.issuedAt,
    expiresAt: lifecycle.expiresAt,
    status: entry.status,
    ...(lifecycle.supersedesLifecycleId === undefined ? {} : { supersedesLifecycleId: lifecycle.supersedesLifecycleId }),
    ...(entry.supersededByLifecycleId === undefined ? {} : { supersededByLifecycleId: entry.supersededByLifecycleId }),
  };
}

function normalizedRegistryPayload(registry: LifecycleRegistry): Omit<LifecycleRegistry, "binding"> {
  if (typeof registry !== "object" || registry === null || registry.version !== LIFECYCLE_REGISTRY_VERSION) {
    throw new Error("lifecycle_registry_invalid");
  }
  if (!Array.isArray(registry.entries)) throw new Error("lifecycle_registry_entries_invalid");

  const entries = registry.entries.map(normalizedEntry);
  const ids = entries.map((entry) => entry.lifecycleId);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate_lifecycle_id");

  const activeKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.status === "ACTIVE") {
      const key = `${entry.kind}:${entry.contextId}`;
      if (activeKeys.has(key)) throw new Error("multiple_active_lifecycles_for_context");
      activeKeys.add(key);
    }
  }

  for (const entry of entries) {
    if (entry.status !== "SUPERSEDED") continue;
    const successor = entries.find((candidate) => candidate.lifecycleId === entry.supersededByLifecycleId);
    if (!successor) throw new Error("superseded_successor_missing");
    if (successor.kind !== entry.kind || successor.contextId !== entry.contextId) {
      throw new Error("supersession_context_or_kind_mismatch");
    }
    if (successor.supersedesLifecycleId !== entry.lifecycleId) {
      throw new Error("supersession_backlink_mismatch");
    }
    if (new Date(successor.issuedAt).getTime() <= new Date(entry.issuedAt).getTime()) {
      throw new Error("supersession_does_not_advance_time");
    }
  }

  return { version: LIFECYCLE_REGISTRY_VERSION, entries };
}

export function emptyLifecycleRegistry(): LifecycleRegistry {
  const payload: Omit<LifecycleRegistry, "binding"> = {
    version: LIFECYCLE_REGISTRY_VERSION,
    entries: [],
  };
  return { ...payload, binding: registryBinding(payload) };
}

export function verifyLifecycleRegistry(registry: LifecycleRegistry): boolean {
  try {
    const payload = normalizedRegistryPayload(registry);
    return registry.binding === registryBinding(payload);
  } catch {
    return false;
  }
}

function register(
  registry: LifecycleRegistry,
  kind: LifecycleKind,
  lifecycle: PacketLifecycle,
  trustBinding: string,
): LifecycleRegistry {
  if (!verifyLifecycleRegistry(registry)) throw new Error("lifecycle_registry_binding_mismatch");
  const payload = normalizedRegistryPayload(registry);
  const normalized = normalizePacketLifecycle(lifecycle);

  if (payload.entries.some((entry) => entry.lifecycleId === normalized.lifecycleId)) {
    throw new Error("lifecycle_id_already_registered");
  }

  const current = payload.entries.find(
    (entry) => entry.kind === kind && entry.contextId === normalized.contextId && entry.status === "ACTIVE",
  );

  if (current) {
    if (normalized.supersedesLifecycleId !== current.lifecycleId) {
      throw new Error("lifecycle_requires_explicit_supersession");
    }
    if (new Date(normalized.issuedAt).getTime() <= new Date(current.issuedAt).getTime()) {
      throw new Error("supersession_does_not_advance_time");
    }
  } else if (normalized.supersedesLifecycleId !== undefined) {
    throw new Error("lifecycle_supersedes_unknown_active");
  }

  const nextEntries = payload.entries.map((entry) =>
    current && entry.lifecycleId === current.lifecycleId
      ? { ...entry, status: "SUPERSEDED" as const, supersededByLifecycleId: normalized.lifecycleId }
      : entry,
  );

  nextEntries.push({
    kind,
    contextId: normalized.contextId,
    lifecycleId: normalized.lifecycleId,
    trustBinding,
    policyVersion: normalized.policyVersion,
    issuedAt: normalized.issuedAt,
    expiresAt: normalized.expiresAt,
    status: "ACTIVE",
    ...(normalized.supersedesLifecycleId === undefined ? {} : { supersedesLifecycleId: normalized.supersedesLifecycleId }),
  });

  const nextPayload: Omit<LifecycleRegistry, "binding"> = {
    version: LIFECYCLE_REGISTRY_VERSION,
    entries: nextEntries,
  };
  const candidate = { ...nextPayload, binding: registryBinding(nextPayload) };
  if (!verifyLifecycleRegistry(candidate)) throw new Error("lifecycle_registry_postcondition_failed");
  return candidate;
}

export function registerArchitectureState(
  registry: LifecycleRegistry,
  state: BoundArchitectureState,
): LifecycleRegistry {
  if (!verifyBoundArchitectureState(state)) throw new Error("architecture_state_invalid");
  return register(registry, "ARCHITECTURE", state.lifecycle, state.trustBinding);
}

export function registerEngineeringState(
  registry: LifecycleRegistry,
  state: BoundEngineeringState,
): LifecycleRegistry {
  if (!verifyBoundEngineeringState(state)) throw new Error("engineering_state_invalid");
  return register(registry, "ENGINEERING", state.lifecycle, state.trustBinding);
}

export function assertLifecycleActive(
  registry: LifecycleRegistry,
  kind: LifecycleKind,
  lifecycle: PacketLifecycle,
  trustBinding: string,
): void {
  if (!verifyLifecycleRegistry(registry)) throw new Error("lifecycle_registry_binding_mismatch");
  const normalized = normalizePacketLifecycle(lifecycle);
  const active = registry.entries.find(
    (entry) => entry.kind === kind && entry.contextId === normalized.contextId && entry.status === "ACTIVE",
  );

  if (!active) throw new Error("active_lifecycle_missing");
  if (active.lifecycleId !== normalized.lifecycleId) throw new Error("lifecycle_not_active");
  if (active.trustBinding !== trustBinding) throw new Error("active_lifecycle_trust_binding_mismatch");
  if (active.policyVersion !== normalized.policyVersion) throw new Error("active_lifecycle_policy_mismatch");
  if (active.issuedAt !== normalized.issuedAt || active.expiresAt !== normalized.expiresAt) {
    throw new Error("active_lifecycle_window_mismatch");
  }
}
