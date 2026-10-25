import type { AdapterAttestation } from "./trust.js";

export const RUNTIME_IDENTITY_VERSION = "2026-10-25.2" as const;

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 4000;
const MAX_IDENTITY_WINDOW_MS = 60 * 60_000;
const EVIDENCE_FIELDS = new Set([
  "version",
  "providerId",
  "actorKind",
  "sessionHandle",
  "verificationRef",
]);
const verifiedRuntimeIdentities = new WeakSet<object>();
const verifiedAdapterAttestations = new WeakSet<object>();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export type RuntimeActorKind = "ADAPTER" | "EXECUTOR";
export type RuntimeIdentityAssurance = "AUTHENTICATED_CHANNEL" | "SIGNED_ASSERTION" | "HARDWARE_ATTESTED";

export interface RuntimeIdentityEvidence {
  version: typeof RUNTIME_IDENTITY_VERSION;
  providerId: string;
  actorKind: RuntimeActorKind;
  sessionHandle: string;
  verificationRef: string;
}

export interface VerifiedRuntimeIdentityResult {
  verified: true;
  providerId: string;
  actorKind: RuntimeActorKind;
  actorId: string;
  sessionId: string;
  subjectRef: string;
  assurance: RuntimeIdentityAssurance;
  authenticatedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface RejectedRuntimeIdentityResult {
  verified: false;
  providerId: string;
  reason: string;
}

export type RuntimeIdentityVerification = VerifiedRuntimeIdentityResult | RejectedRuntimeIdentityResult;

export interface RuntimeIdentityVerifier {
  providerId: string;
  verify(evidence: RuntimeIdentityEvidence): Promise<RuntimeIdentityVerification>;
}

export interface ResolvedRuntimeIdentity {
  version: typeof RUNTIME_IDENTITY_VERSION;
  providerId: string;
  actorKind: RuntimeActorKind;
  actorId: string;
  sessionId: string;
  subjectRef: string;
  assurance: RuntimeIdentityAssurance;
  authenticatedAt: string;
  expiresAt: string;
  binding: string;
}

/**
 * Verified wrapper around the exact adapter attestation admitted to the trust chain.
 * `adapterId` is duplicated only as a compatibility/readability field and must
 * equal both identity.actorId and attestation.adapterId.
 */
export interface VerifiedAdapterAttestation {
  version: typeof RUNTIME_IDENTITY_VERSION;
  adapterId: string;
  identity: ResolvedRuntimeIdentity;
  attestation: AdapterAttestation;
  binding: string;
}

function runtimeIdentityBinding(identity: Omit<ResolvedRuntimeIdentity, "binding">): string {
  return canonicalString(identity);
}

function adapterAttestationIdentityBinding(
  value: Omit<VerifiedAdapterAttestation, "binding">,
): string {
  return canonicalString({
    runtimeIdentityVersion: RUNTIME_IDENTITY_VERSION,
    adapterId: value.adapterId,
    identityBinding: value.identity.binding,
    attestation: value.attestation,
  });
}

export function isResolvedRuntimeIdentity(identity: ResolvedRuntimeIdentity): boolean {
  if (typeof identity !== "object" || identity === null || !verifiedRuntimeIdentities.has(identity)) {
    return false;
  }
  const { binding, ...payload } = identity;
  return binding === runtimeIdentityBinding(payload);
}

export function isVerifiedAdapterAttestation(value: VerifiedAdapterAttestation): boolean {
  if (typeof value !== "object" || value === null || !verifiedAdapterAttestations.has(value)) {
    return false;
  }
  if (!isResolvedRuntimeIdentity(value.identity)) return false;
  if (value.adapterId !== value.identity.actorId || value.adapterId !== value.attestation.adapterId) {
    return false;
  }
  const { binding, ...payload } = value;
  return binding === adapterAttestationIdentityBinding(payload);
}

export async function resolveRuntimeIdentity(
  evidence: RuntimeIdentityEvidence,
  verifier: RuntimeIdentityVerifier,
  now = new Date(),
): Promise<ResolvedRuntimeIdentity> {
  if (!isRecord(evidence)) throw new TypeError("runtime_identity_evidence_required");
  for (const key of Object.keys(evidence)) {
    if (!EVIDENCE_FIELDS.has(key)) throw new Error("unexpected_runtime_identity_evidence_field");
  }
  if (evidence.version !== RUNTIME_IDENTITY_VERSION) throw new Error("runtime_identity_version_mismatch");

  const providerId = boundedText(evidence.providerId as string, MAX_ID_LENGTH, "runtime_provider_id");
  const actorKind = evidence.actorKind;
  if (actorKind !== "ADAPTER" && actorKind !== "EXECUTOR") throw new TypeError("runtime_actor_kind_invalid");
  const sessionHandle = boundedText(evidence.sessionHandle as string, MAX_ID_LENGTH, "runtime_session_handle");
  const verificationRef = boundedText(evidence.verificationRef as string, MAX_REF_LENGTH, "runtime_verification_ref");
  if (boundedText(verifier.providerId, MAX_ID_LENGTH, "runtime_verifier_provider_id") !== providerId) {
    throw new Error("runtime_identity_provider_mismatch");
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");

  const result = await verifier.verify({
    version: RUNTIME_IDENTITY_VERSION,
    providerId,
    actorKind,
    sessionHandle,
    verificationRef,
  });
  if (!result.verified) throw new Error("runtime_identity_rejected");
  if (result.providerId !== providerId) throw new Error("runtime_identity_verified_provider_mismatch");
  if (result.actorKind !== actorKind) throw new Error("runtime_identity_actor_kind_mismatch");
  if (result.revoked) throw new Error("runtime_identity_revoked");

  const actorId = boundedText(result.actorId, MAX_ID_LENGTH, "runtime_actor_id");
  const sessionId = boundedText(result.sessionId, MAX_ID_LENGTH, "runtime_verified_session_id");
  if (sessionId !== sessionHandle) throw new Error("runtime_identity_session_mismatch");
  const subjectRef = boundedText(result.subjectRef, MAX_REF_LENGTH, "runtime_subject_ref");
  const authenticatedAt = parseIsoInstant(result.authenticatedAt, "runtime_authenticated_at");
  const expiresAt = parseIsoInstant(result.expiresAt, "runtime_expires_at");
  if (expiresAt.getTime() <= authenticatedAt.getTime()) throw new Error("runtime_identity_nonpositive_window");
  if (expiresAt.getTime() - authenticatedAt.getTime() > MAX_IDENTITY_WINDOW_MS) {
    throw new Error("runtime_identity_window_too_long");
  }
  if (nowMs < authenticatedAt.getTime()) throw new Error("runtime_identity_not_yet_valid");
  if (nowMs >= expiresAt.getTime()) throw new Error("runtime_identity_expired");
  if (
    result.assurance !== "AUTHENTICATED_CHANNEL" &&
    result.assurance !== "SIGNED_ASSERTION" &&
    result.assurance !== "HARDWARE_ATTESTED"
  ) {
    throw new Error("runtime_identity_assurance_invalid");
  }

  const payload: Omit<ResolvedRuntimeIdentity, "binding"> = {
    version: RUNTIME_IDENTITY_VERSION,
    providerId,
    actorKind,
    actorId,
    sessionId,
    subjectRef,
    assurance: result.assurance,
    authenticatedAt: authenticatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const identity: ResolvedRuntimeIdentity = { ...payload, binding: runtimeIdentityBinding(payload) };
  verifiedRuntimeIdentities.add(identity);
  return identity;
}

export function assertResolvedRuntimeIdentityFresh(
  identity: ResolvedRuntimeIdentity,
  expectedKind: RuntimeActorKind,
  now = new Date(),
): void {
  if (!isResolvedRuntimeIdentity(identity)) throw new Error("runtime_identity_not_resolved");
  if (identity.actorKind !== expectedKind) throw new Error("runtime_identity_actor_kind_mismatch");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs < new Date(identity.authenticatedAt).getTime()) throw new Error("runtime_identity_not_yet_valid");
  if (nowMs >= new Date(identity.expiresAt).getTime()) throw new Error("runtime_identity_expired");
}

export function bindAdapterAttestationToIdentity(
  attestation: AdapterAttestation,
  identity: ResolvedRuntimeIdentity,
  now = new Date(),
): VerifiedAdapterAttestation {
  assertResolvedRuntimeIdentityFresh(identity, "ADAPTER", now);
  if (identity.actorId !== attestation.adapterId) throw new Error("adapter_identity_attestation_mismatch");
  if (now.getTime() < new Date(attestation.observedAt).getTime()) throw new Error("adapter_attestation_not_yet_valid");
  if (now.getTime() >= new Date(attestation.expiresAt).getTime()) throw new Error("adapter_attestation_expired");
  if (new Date(attestation.expiresAt).getTime() > new Date(identity.expiresAt).getTime()) {
    throw new Error("adapter_attestation_outlives_identity");
  }

  const payload: Omit<VerifiedAdapterAttestation, "binding"> = {
    version: RUNTIME_IDENTITY_VERSION,
    adapterId: attestation.adapterId,
    identity,
    attestation: { ...attestation, operation: { ...attestation.operation } },
  };
  const verified: VerifiedAdapterAttestation = {
    ...payload,
    binding: adapterAttestationIdentityBinding(payload),
  };
  verifiedAdapterAttestations.add(verified);
  return verified;
}

export function assertVerifiedAdapterAttestationFresh(
  value: VerifiedAdapterAttestation,
  now = new Date(),
): void {
  if (!isVerifiedAdapterAttestation(value)) throw new Error("adapter_attestation_identity_not_verified");
  assertResolvedRuntimeIdentityFresh(value.identity, "ADAPTER", now);
  if (value.adapterId !== value.identity.actorId || value.adapterId !== value.attestation.adapterId) {
    throw new Error("adapter_identity_attestation_mismatch");
  }
  if (now.getTime() < new Date(value.attestation.observedAt).getTime()) throw new Error("adapter_attestation_not_yet_valid");
  if (now.getTime() >= new Date(value.attestation.expiresAt).getTime()) throw new Error("adapter_attestation_expired");
}
