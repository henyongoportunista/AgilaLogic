import {
  weaveSignals,
  type GagambaSignal,
  type GagambaSignalKind,
  type ProvenanceEnvelope,
} from "./gagamba.js";
import { verifyRfiLifecycle, type RfiLifecycle } from "./trust.js";

export const RFI_RESOLUTION_VERSION = "2026-10-25.1" as const;

export interface BindRfiResolutionInput {
  resolutionId: string;
  kind: GagambaSignalKind;
  provenance: ProvenanceEnvelope;
  resolvedAt: string;
}

export interface RfiResolutionArtifact {
  version: typeof RFI_RESOLUTION_VERSION;
  trust: "RESOLUTION_REQUIRES_GAGAMBA_REWEAVE";
  resolutionId: string;
  rfiId: string;
  rfiBinding: string;
  architectureBinding: string;
  engineeringBinding: string;
  contextId: string;
  kind: GagambaSignalKind;
  text: string;
  provenance: ProvenanceEnvelope;
  resolvedAt: string;
  binding: string;
}

const MAX_ID_LENGTH = 200;
const MAX_BINDING_LENGTH = 100_000;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function boundedText(value: string, maxLength: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const normalized = normalize(value);
  if (normalized.length === 0) throw new TypeError(`${label}_empty`);
  if (normalized.length > maxLength) throw new TypeError(`${label}_too_long`);
  return normalized;
}

function parseIsoInstant(value: string, label: string): Date {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label}_invalid_iso_instant`);
  }
  return parsed;
}

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

function artifactBinding(artifact: Omit<RfiResolutionArtifact, "binding">): string {
  return canonicalString(artifact);
}

function signalFromArtifact(artifact: Omit<RfiResolutionArtifact, "binding">): GagambaSignal {
  return {
    id: artifact.resolutionId,
    kind: artifact.kind,
    text: artifact.text,
    provenance: { ...artifact.provenance },
  };
}

function assertSignalAccepted(signal: GagambaSignal): void {
  const weave = weaveSignals({ signals: [signal], candidates: [] });
  if (weave.trace.acceptedSignalIds.length !== 1 || weave.trace.acceptedSignalIds[0] !== signal.id) {
    throw new Error(`rfi_resolution_signal_rejected:${weave.trace.reasons[0] ?? "unknown"}`);
  }
}

/**
 * Converts a RESOLVED RFI into a typed, provenance-bearing artifact.
 * The artifact is not a packet mutation and is not executable state.
 * It must return through Gagamba weave before a new ArchitecturePacket can exist.
 */
export function bindRfiResolution(
  rfi: RfiLifecycle,
  input: BindRfiResolutionInput,
): RfiResolutionArtifact {
  if (!verifyRfiLifecycle(rfi)) throw new Error("rfi_binding_mismatch");
  if (rfi.status !== "RESOLVED") throw new Error("rfi_not_resolved");
  if (typeof rfi.resolution !== "string" || normalize(rfi.resolution).length === 0) {
    throw new Error("rfi_resolution_missing");
  }

  const resolvedAt = parseIsoInstant(input.resolvedAt, "rfi_resolution_resolved_at");
  const openedAt = parseIsoInstant(rfi.openedAt, "rfi_opened_at");
  const expiresAt = parseIsoInstant(rfi.expiresAt, "rfi_expires_at");
  if (resolvedAt.getTime() < openedAt.getTime()) throw new Error("rfi_resolution_predates_rfi");
  if (resolvedAt.getTime() >= expiresAt.getTime()) throw new Error("rfi_resolution_at_or_after_expiry");

  const payload: Omit<RfiResolutionArtifact, "binding"> = {
    version: RFI_RESOLUTION_VERSION,
    trust: "RESOLUTION_REQUIRES_GAGAMBA_REWEAVE",
    resolutionId: boundedText(input.resolutionId, MAX_ID_LENGTH, "rfi_resolution_id"),
    rfiId: boundedText(rfi.rfiId, MAX_ID_LENGTH, "rfi_id"),
    rfiBinding: boundedText(rfi.binding, MAX_BINDING_LENGTH, "rfi_binding"),
    architectureBinding: boundedText(rfi.architectureBinding, MAX_BINDING_LENGTH, "architecture_binding"),
    engineeringBinding: boundedText(rfi.engineeringBinding, MAX_BINDING_LENGTH, "engineering_binding"),
    contextId: boundedText(rfi.contextId, MAX_ID_LENGTH, "rfi_context_id"),
    kind: input.kind,
    text: normalize(rfi.resolution),
    provenance: { ...input.provenance },
    resolvedAt: resolvedAt.toISOString(),
  };

  assertSignalAccepted(signalFromArtifact(payload));
  return { ...payload, binding: artifactBinding(payload) };
}

export function verifyRfiResolutionArtifact(artifact: RfiResolutionArtifact): boolean {
  if (typeof artifact !== "object" || artifact === null) return false;
  if (artifact.version !== RFI_RESOLUTION_VERSION) return false;
  if (artifact.trust !== "RESOLUTION_REQUIRES_GAGAMBA_REWEAVE") return false;

  try {
    boundedText(artifact.resolutionId, MAX_ID_LENGTH, "rfi_resolution_id");
    boundedText(artifact.rfiId, MAX_ID_LENGTH, "rfi_id");
    boundedText(artifact.rfiBinding, MAX_BINDING_LENGTH, "rfi_binding");
    boundedText(artifact.architectureBinding, MAX_BINDING_LENGTH, "architecture_binding");
    boundedText(artifact.engineeringBinding, MAX_BINDING_LENGTH, "engineering_binding");
    boundedText(artifact.contextId, MAX_ID_LENGTH, "rfi_context_id");
    parseIsoInstant(artifact.resolvedAt, "rfi_resolution_resolved_at");
    assertSignalAccepted(signalFromArtifact(artifact));
  } catch {
    return false;
  }

  const { binding, ...payload } = artifact;
  return binding === artifactBinding(payload);
}

export function rfiResolutionToGagambaSignal(artifact: RfiResolutionArtifact): GagambaSignal {
  if (!verifyRfiResolutionArtifact(artifact)) throw new Error("rfi_resolution_artifact_invalid");
  return signalFromArtifact(artifact);
}
