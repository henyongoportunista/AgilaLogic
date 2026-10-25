import type {
  NorthstarPrincipal,
  PrincipalContext,
} from "./northstar.js";

export const EXTERNAL_AUTH_BOUNDARY_VERSION = "2026-10-25.1" as const;

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 4000;
const MAX_AUTH_WINDOW_MS = 24 * 60 * 60_000;
const AUTH_EVIDENCE_FIELDS = new Set(["version", "providerId", "sessionHandle", "verificationRef"]);

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

export type VerifiedOperatorPrincipal = Exclude<NorthstarPrincipal, "UNVERIFIED_PUBLIC">;
export type AuthenticationAssurance = "SINGLE_FACTOR" | "MFA" | "PHISHING_RESISTANT_MFA";

/**
 * Opaque evidence reference presented to the server-side auth boundary.
 * No password, OTP, passkey private material, recovery code, or secret phrase
 * belongs in this object or in model context.
 */
export interface ExternalAuthEvidence {
  version: typeof EXTERNAL_AUTH_BOUNDARY_VERSION;
  providerId: string;
  sessionHandle: string;
  verificationRef: string;
}

/**
 * Result returned by a trusted server-side authentication adapter after it has
 * independently checked provider state. The caller does not choose the verified
 * principal; the adapter resolves it from its own authenticated account mapping.
 */
export interface VerifiedExternalSession {
  verified: true;
  providerId: string;
  principal: VerifiedOperatorPrincipal;
  sessionId: string;
  subjectRef: string;
  assurance: AuthenticationAssurance;
  authenticatedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface RejectedExternalSession {
  verified: false;
  providerId: string;
  reason: string;
}

export type ExternalSessionVerification = VerifiedExternalSession | RejectedExternalSession;

/**
 * Production implementations must verify against an actual identity/session
 * authority (for example a passkey/MFA capable auth provider or server session
 * store). Merely implementing this TypeScript interface does not create trust.
 */
export interface ExternalPrincipalVerifier {
  providerId: string;
  verify(evidence: ExternalAuthEvidence): Promise<ExternalSessionVerification>;
}

export interface VerifiedPrincipalContext {
  version: typeof EXTERNAL_AUTH_BOUNDARY_VERSION;
  assurance: AuthenticationAssurance;
  providerId: string;
  subjectRef: string;
  principalContext: PrincipalContext;
}

export function createPublicPrincipalContext(
  sessionId: string,
  issuedAt: string,
  expiresAt: string,
): PrincipalContext {
  const issued = parseIsoInstant(issuedAt, "public_session_issued_at");
  const expires = parseIsoInstant(expiresAt, "public_session_expires_at");
  if (expires.getTime() <= issued.getTime()) throw new TypeError("public_session_nonpositive_window");

  return {
    principal: "UNVERIFIED_PUBLIC",
    verification: "PUBLIC_SESSION",
    sessionId: boundedText(sessionId, MAX_ID_LENGTH, "public_session_id"),
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

/**
 * Resolves an externally verified session into the only PrincipalContext shape
 * that may carry VERIFIED_SAL or VERIFIED_BJORN into Northstar.
 *
 * This function does not authenticate credentials itself. It requires a trusted
 * verifier implementation and fails closed on provider mismatch, rejection,
 * revocation, stale sessions, impossible windows, or inconsistent session IDs.
 */
export async function resolveVerifiedPrincipalContext(
  evidence: ExternalAuthEvidence,
  verifier: ExternalPrincipalVerifier,
  now = new Date(),
): Promise<VerifiedPrincipalContext> {
  if (!isRecord(evidence)) throw new TypeError("external_auth_evidence_required");
  for (const key of Object.keys(evidence)) {
    if (!AUTH_EVIDENCE_FIELDS.has(key)) throw new Error("unexpected_auth_evidence_field");
  }
  if (evidence.version !== EXTERNAL_AUTH_BOUNDARY_VERSION) {
    throw new Error("external_auth_version_mismatch");
  }

  const providerId = boundedText(evidence.providerId as string, MAX_ID_LENGTH, "auth_provider_id");
  const sessionHandle = boundedText(evidence.sessionHandle as string, MAX_ID_LENGTH, "auth_session_handle");
  const verificationRef = boundedText(evidence.verificationRef as string, MAX_REF_LENGTH, "auth_verification_ref");
  if (boundedText(verifier.providerId, MAX_ID_LENGTH, "verifier_provider_id") !== providerId) {
    throw new Error("auth_provider_mismatch");
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");

  const normalizedEvidence: ExternalAuthEvidence = {
    version: EXTERNAL_AUTH_BOUNDARY_VERSION,
    providerId,
    sessionHandle,
    verificationRef,
  };
  const result = await verifier.verify(normalizedEvidence);
  if (!result.verified) throw new Error("external_auth_rejected");
  if (result.providerId !== providerId) throw new Error("verified_provider_mismatch");
  if (result.revoked) throw new Error("external_session_revoked");
  if (result.principal !== "VERIFIED_SAL" && result.principal !== "VERIFIED_BJORN") {
    throw new Error("verified_principal_invalid");
  }

  const sessionId = boundedText(result.sessionId, MAX_ID_LENGTH, "verified_session_id");
  if (sessionId !== sessionHandle) throw new Error("verified_session_handle_mismatch");
  const subjectRef = boundedText(result.subjectRef, MAX_REF_LENGTH, "verified_subject_ref");
  const authenticatedAt = parseIsoInstant(result.authenticatedAt, "authenticated_at");
  const expiresAt = parseIsoInstant(result.expiresAt, "auth_expires_at");

  if (expiresAt.getTime() <= authenticatedAt.getTime()) {
    throw new Error("external_session_nonpositive_window");
  }
  if (expiresAt.getTime() - authenticatedAt.getTime() > MAX_AUTH_WINDOW_MS) {
    throw new Error("external_session_window_too_long");
  }
  if (nowMs < authenticatedAt.getTime()) throw new Error("external_session_not_yet_valid");
  if (nowMs >= expiresAt.getTime()) throw new Error("external_session_expired");

  if (
    result.assurance !== "SINGLE_FACTOR" &&
    result.assurance !== "MFA" &&
    result.assurance !== "PHISHING_RESISTANT_MFA"
  ) {
    throw new Error("auth_assurance_invalid");
  }

  return {
    version: EXTERNAL_AUTH_BOUNDARY_VERSION,
    assurance: result.assurance,
    providerId,
    subjectRef,
    principalContext: {
      principal: result.principal,
      verification: "EXTERNAL_AUTH",
      sessionId,
      issuedAt: authenticatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
}
