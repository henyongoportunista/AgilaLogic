import type { ProvenanceEnvelope } from "./gagamba.js";
import type { ProvenanceLedgerEntry } from "./trust.js";

export const PROVENANCE_ATTESTATION_VERSION = "2026-10-25.1" as const;

export interface ProvenanceAttestation {
  version: typeof PROVENANCE_ATTESTATION_VERSION;
  trust: "SOURCE_PROVENANCE_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_VERIFIER";
  attestationId: string;
  signalId: string;
  kind: string;
  text: string;
  provenance: ProvenanceEnvelope;
  verifierId: string;
  verifiedAt: string;
  expiresAt: string;
  evidenceRef?: string;
  binding: string;
}

export interface BindProvenanceAttestationInput {
  attestationId: string;
  verifierId: string;
  verifiedAt: string;
  expiresAt: string;
  evidenceRef?: string;
}

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_REF_LENGTH = 1000;

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

function attestationBinding(attestation: Omit<ProvenanceAttestation, "binding">): string {
  return canonicalString(attestation);
}

function normalizeProvenance(provenance: ProvenanceEnvelope): ProvenanceEnvelope {
  if (typeof provenance !== "object" || provenance === null) throw new Error("provenance_required");
  return {
    sourceClass: provenance.sourceClass,
    producer: boundedText(provenance.producer, MAX_ID_LENGTH, "provenance_producer"),
    observedAt: parseIsoInstant(provenance.observedAt, "provenance_observed_at").toISOString(),
    ...(provenance.sourceRef === undefined
      ? {}
      : { sourceRef: boundedText(provenance.sourceRef, MAX_REF_LENGTH, "provenance_source_ref") }),
    ...(provenance.evidenceRef === undefined
      ? {}
      : { evidenceRef: boundedText(provenance.evidenceRef, MAX_REF_LENGTH, "provenance_evidence_ref") }),
  };
}

/**
 * Binds a separate verification receipt to one provenance-bearing ledger entry.
 * The verifier identity is deliberately unauthenticated in v0.1.
 */
export function bindProvenanceAttestation(
  entry: ProvenanceLedgerEntry,
  input: BindProvenanceAttestationInput,
): ProvenanceAttestation {
  if (typeof entry !== "object" || entry === null) throw new Error("provenance_entry_required");
  if (entry.provenance === null) throw new Error("provenance_entry_has_no_provenance");
  if (entry.provenance.sourceClass === "UNKNOWN_SOURCE") throw new Error("unknown_source_cannot_be_attested");
  if (entry.kind === "FACT" && entry.provenance.sourceClass === "MODEL_DERIVED") {
    throw new Error("model_derived_fact_cannot_be_attested");
  }

  const verifiedAt = parseIsoInstant(input.verifiedAt, "provenance_attestation_verified_at");
  const expiresAt = parseIsoInstant(input.expiresAt, "provenance_attestation_expires_at");
  if (expiresAt.getTime() <= verifiedAt.getTime()) throw new Error("provenance_attestation_nonpositive_window");
  const provenance = normalizeProvenance(entry.provenance);
  if (verifiedAt.getTime() < new Date(provenance.observedAt).getTime()) {
    throw new Error("provenance_attestation_predates_observation");
  }

  const payload: Omit<ProvenanceAttestation, "binding"> = {
    version: PROVENANCE_ATTESTATION_VERSION,
    trust: "SOURCE_PROVENANCE_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_VERIFIER",
    attestationId: boundedText(input.attestationId, MAX_ID_LENGTH, "provenance_attestation_id"),
    signalId: boundedText(entry.signalId, MAX_ID_LENGTH, "provenance_signal_id"),
    kind: boundedText(entry.kind, MAX_ID_LENGTH, "provenance_kind"),
    text: boundedText(entry.text, MAX_TEXT_LENGTH, "provenance_text"),
    provenance,
    verifierId: boundedText(input.verifierId, MAX_ID_LENGTH, "provenance_verifier_id"),
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(input.evidenceRef === undefined
      ? {}
      : { evidenceRef: boundedText(input.evidenceRef, MAX_REF_LENGTH, "provenance_attestation_evidence_ref") }),
  };

  return { ...payload, binding: attestationBinding(payload) };
}

export function verifyProvenanceAttestation(attestation: ProvenanceAttestation): boolean {
  if (typeof attestation !== "object" || attestation === null) return false;
  if (attestation.version !== PROVENANCE_ATTESTATION_VERSION) return false;
  if (attestation.trust !== "SOURCE_PROVENANCE_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_VERIFIER") return false;

  try {
    boundedText(attestation.attestationId, MAX_ID_LENGTH, "provenance_attestation_id");
    boundedText(attestation.signalId, MAX_ID_LENGTH, "provenance_signal_id");
    boundedText(attestation.kind, MAX_ID_LENGTH, "provenance_kind");
    boundedText(attestation.text, MAX_TEXT_LENGTH, "provenance_text");
    boundedText(attestation.verifierId, MAX_ID_LENGTH, "provenance_verifier_id");
    const verifiedAt = parseIsoInstant(attestation.verifiedAt, "provenance_attestation_verified_at");
    const expiresAt = parseIsoInstant(attestation.expiresAt, "provenance_attestation_expires_at");
    if (expiresAt.getTime() <= verifiedAt.getTime()) return false;
    const provenance = normalizeProvenance(attestation.provenance);
    if (canonicalString(provenance) !== canonicalString(attestation.provenance)) return false;
    if (verifiedAt.getTime() < new Date(provenance.observedAt).getTime()) return false;
    if (attestation.evidenceRef !== undefined) {
      boundedText(attestation.evidenceRef, MAX_REF_LENGTH, "provenance_attestation_evidence_ref");
    }
  } catch {
    return false;
  }

  const { binding, ...payload } = attestation;
  return binding === attestationBinding(payload);
}

export function assertProvenanceAttestationFresh(
  attestation: ProvenanceAttestation,
  now = new Date(),
): void {
  if (!verifyProvenanceAttestation(attestation)) throw new Error("provenance_attestation_invalid");
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");
  const verifiedAt = new Date(attestation.verifiedAt).getTime();
  const expiresAt = new Date(attestation.expiresAt).getTime();
  if (now.getTime() < verifiedAt) throw new Error("provenance_attestation_not_yet_valid");
  if (now.getTime() >= expiresAt) throw new Error("provenance_attestation_expired");
}

export function provenanceAttestationMatchesEntry(
  attestation: ProvenanceAttestation,
  entry: ProvenanceLedgerEntry,
): boolean {
  if (!verifyProvenanceAttestation(attestation)) return false;
  if (entry.provenance === null) return false;
  return (
    attestation.signalId === entry.signalId &&
    attestation.kind === entry.kind &&
    attestation.text === entry.text &&
    canonicalString(attestation.provenance) === canonicalString(entry.provenance)
  );
}
