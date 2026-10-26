import type {
  NorthstarPrincipal,
  PrincipalContext,
} from "./northstar.js";

export const EXTERNAL_AUTH_BOUNDARY_VERSION = "2026-10-25.2" as const;

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 4000;
const MAX_AUTH_WINDOW_MS = 24 * 60 * 60_000;
const AUTH_EVIDENCE_FIELDS = new Set(["version", "providerId", "sessionHandle", "verificationRef"]);
const externallyVerifiedPrincipalContexts = new WeakMap<object, {
  snapshot: string;
  authentication: Readonly<TrustedPrincipalAuthentication>;
}>();

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

function verificationTime(now?: Date): number {
  try {
    const value = Date.prototype.getTime.call(now === undefined ? new Date() : now);
    if (Number.isFinite(value)) return value;
  } catch { /* Invalid explicit clocks fail with a fixed boundary error. */ }
  throw new TypeError("invalid_now");
}

export type VerifiedOperatorPrincipal = Exclude<NorthstarPrincipal, "UNVERIFIED_PUBLIC">;
export type AuthenticationAssurance = "SINGLE_FACTOR" | "MFA" | "PHISHING_RESISTANT_MFA";
export type AuthRuntimeMode = "test" | "production";

export interface TrustedPrincipalAuthentication {
  readonly principal: VerifiedOperatorPrincipal;
  readonly sessionId: string;
  readonly providerId: string;
  readonly assurance: AuthenticationAssurance;
  readonly mode: AuthRuntimeMode;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
}

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

export interface AuthVerifierRegistry {
  readonly version: typeof EXTERNAL_AUTH_BOUNDARY_VERSION;
  readonly providerId: string;
  readonly mode: AuthRuntimeMode;
}

interface PinnedVerifier {
  providerId: string;
  mode: AuthRuntimeMode;
  verify: ExternalPrincipalVerifier["verify"];
}

const verifierRegistries = new WeakMap<object, Readonly<PinnedVerifier>>();

// Production providers must be implemented and pinned here by trusted server
// composition. There is intentionally no configured provider or registration API.
const productionVerifierFactories: Readonly<Record<string, () => ExternalPrincipalVerifier>> = Object.freeze({});

function registryFor(verifier: ExternalPrincipalVerifier, mode: AuthRuntimeMode): AuthVerifierRegistry {
  const providerId = boundedText(verifier.providerId, MAX_ID_LENGTH, "verifier_provider_id");
  if (typeof verifier.verify !== "function") throw new TypeError("auth_verifier_function_required");
  const registry: AuthVerifierRegistry = Object.freeze({
    version: EXTERNAL_AUTH_BOUNDARY_VERSION,
    providerId,
    mode,
  });
  verifierRegistries.set(registry, Object.freeze({
    providerId,
    mode,
    verify: verifier.verify.bind(verifier),
  }));
  return registry;
}

/** Fixture-only composition; this registry never satisfies production mode. */
export function createTestAuthVerifierRegistry(verifier: ExternalPrincipalVerifier): AuthVerifierRegistry {
  return registryFor(verifier, "test");
}

/** No arbitrary implementation can be supplied to this production factory. */
export function createProductionAuthVerifierRegistry(providerId: string): AuthVerifierRegistry {
  const selected = boundedText(providerId, MAX_ID_LENGTH, "configured_auth_provider_id");
  const factory = Object.hasOwn(productionVerifierFactories, selected)
    ? productionVerifierFactories[selected]
    : undefined;
  if (!factory) throw new Error("unknown_auth_provider");
  return registryFor(factory(), "production");
}

function configuredVerifier(
  registry: AuthVerifierRegistry,
  providerId: string,
  mode: AuthRuntimeMode,
): Readonly<PinnedVerifier> {
  if (mode !== "test" && mode !== "production") throw new Error("auth_runtime_mode_invalid");
  const configured = isRecord(registry) ? verifierRegistries.get(registry) : undefined;
  if (!configured) throw new Error("auth_verifier_registry_required");
  if (configured.mode === "test" && mode === "production") {
    throw new Error("test_auth_verifier_not_allowed_in_production");
  }
  if (configured.mode !== mode) throw new Error("auth_runtime_mode_mismatch");
  if (configured.providerId !== providerId) throw new Error("auth_provider_mismatch");
  return configured;
}

export interface VerifiedPrincipalContext {
  version: typeof EXTERNAL_AUTH_BOUNDARY_VERSION;
  assurance: AuthenticationAssurance;
  providerId: string;
  subjectRef: string;
  principalContext: PrincipalContext;
}

/**
 * Process-local runtime stamp. Northstar uses this to reject caller-fabricated
 * VERIFIED_* PrincipalContext objects that merely copy the right strings.
 * The stamp is intentionally non-serializable: a deserialized session must be
 * reverified by the external auth boundary before private operator context is compiled.
 */
export function isExternallyVerifiedPrincipalContext(context: PrincipalContext): boolean {
  return getTrustedPrincipalAuthentication(context) !== undefined;
}

export function getTrustedPrincipalAuthentication(
  context: PrincipalContext,
): Readonly<TrustedPrincipalAuthentication> | undefined {
  if (!isRecord(context)) return undefined;
  const stamped = externallyVerifiedPrincipalContexts.get(context);
  if (!stamped || !Object.isFrozen(context)) return undefined;
  try {
    if (JSON.stringify(context) !== stamped.snapshot) return undefined;
  } catch {
    return undefined;
  }
  return stamped.authentication;
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
 * Resolves an externally verified session into the only PrincipalContext object
 * that may carry VERIFIED_SAL or VERIFIED_BJORN into Northstar in this process.
 *
 * This function does not authenticate credentials itself. It requires a trusted
 * server-selected pinned verifier registry and fails closed on provider mismatch, rejection,
 * revocation, stale sessions, impossible windows, or inconsistent session IDs.
 * The mode and registry are trusted server composition, never auth-evidence fields.
 * Production is the default; fixture registries require explicit test mode.
 */
export async function resolveVerifiedPrincipalContext(
  evidence: ExternalAuthEvidence,
  registry: AuthVerifierRegistry,
  now?: Date,
  mode: AuthRuntimeMode = "production",
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
  const verifier = configuredVerifier(registry, providerId, mode);

  verificationTime(now);

  const normalizedEvidence: ExternalAuthEvidence = {
    version: EXTERNAL_AUTH_BOUNDARY_VERSION,
    providerId,
    sessionHandle,
    verificationRef,
  };
  let result: ExternalSessionVerification;
  try {
    result = await verifier.verify(Object.freeze(normalizedEvidence));
  } catch {
    throw new Error("external_auth_verifier_error");
  }
  // A provider can take time to answer. Default production clocks are reread
  // after the await; explicit clocks remain deterministic trusted test inputs.
  const nowMs = verificationTime(now);
  if (!isRecord(result) || result.verified !== true) throw new Error("external_auth_rejected");
  if (result.providerId !== providerId) throw new Error("verified_provider_mismatch");
  if (result.revoked !== false) throw new Error("external_session_revoked");
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

  const principalContext: PrincipalContext = Object.freeze({
    principal: result.principal,
    verification: "EXTERNAL_AUTH",
    sessionId,
    issuedAt: authenticatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const authentication: Readonly<TrustedPrincipalAuthentication> = Object.freeze({
    principal: result.principal,
    sessionId,
    providerId,
    assurance: result.assurance,
    mode,
    authenticatedAt: authenticatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  externallyVerifiedPrincipalContexts.set(principalContext, {
    snapshot: JSON.stringify(principalContext),
    authentication,
  });

  return Object.freeze({
    version: EXTERNAL_AUTH_BOUNDARY_VERSION,
    assurance: result.assurance,
    providerId,
    subjectRef,
    principalContext,
  });
}
