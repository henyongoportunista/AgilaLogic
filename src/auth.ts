export const OPERATOR_AUTH_VERSION = "2026-10-25.1" as const;

export type OperatorIdentity = "SAL" | "BJORN";
export type AuthFactorClass = "KNOWLEDGE" | "POSSESSION" | "INHERENCE";
export type AuthFactorChannel =
  | "NORTHSTAR_SECRET"
  | "EMAIL_OTP"
  | "SMS_OTP"
  | "TOTP"
  | "PASSKEY"
  | "HARDWARE_KEY"
  | "BIOMETRIC"
  | "OTHER";

export interface AuthFactorReceipt {
  factorId: string;
  factorClass: AuthFactorClass;
  channel: AuthFactorChannel;
  verifierId: string;
  verifiedAt: string;
  evidenceRef?: string;
}

export interface OperatorAuthAssertion {
  version: typeof OPERATOR_AUTH_VERSION;
  assertionId: string;
  principal: OperatorIdentity;
  sessionId: string;
  issuerId: string;
  nonceId: string;
  issuedAt: string;
  expiresAt: string;
  factors: AuthFactorReceipt[];
  binding: string;
}

export interface BindOperatorAuthAssertionInput {
  assertionId: string;
  principal: OperatorIdentity;
  sessionId: string;
  issuerId: string;
  nonceId: string;
  issuedAt: string;
  expiresAt: string;
  factors: AuthFactorReceipt[];
}

export interface OperatorAuthReplayState {
  version: typeof OPERATOR_AUTH_VERSION;
  consumedAssertionIds: string[];
  consumedNonceIds: string[];
}

export interface VerifiedOperatorSession {
  version: typeof OPERATOR_AUTH_VERSION;
  trust: "EXTERNAL_AUTH_CONTRACT_MATCHED_UNAUTHENTICATED_ISSUER";
  principal: OperatorIdentity;
  sessionId: string;
  assertionId: string;
  issuerId: string;
  authAssertionBinding: string;
  factorClasses: AuthFactorClass[];
  issuedAt: string;
  expiresAt: string;
  sessionBinding: string;
}

export interface ConsumeOperatorAuthResult {
  session: VerifiedOperatorSession;
  replayState: OperatorAuthReplayState;
}

const MAX_ID_LENGTH = 200;
const MAX_REF_LENGTH = 1000;

const IDENTITIES = new Set<OperatorIdentity>(["SAL", "BJORN"]);
const FACTOR_CLASSES = new Set<AuthFactorClass>(["KNOWLEDGE", "POSSESSION", "INHERENCE"]);
const CHANNELS = new Set<AuthFactorChannel>([
  "NORTHSTAR_SECRET",
  "EMAIL_OTP",
  "SMS_OTP",
  "TOTP",
  "PASSKEY",
  "HARDWARE_KEY",
  "BIOMETRIC",
  "OTHER",
]);

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

function expectedFactorClass(channel: AuthFactorChannel): AuthFactorClass | null {
  if (channel === "NORTHSTAR_SECRET") return "KNOWLEDGE";
  if (["EMAIL_OTP", "SMS_OTP", "TOTP", "PASSKEY", "HARDWARE_KEY"].includes(channel)) {
    return "POSSESSION";
  }
  if (channel === "BIOMETRIC") return "INHERENCE";
  return null;
}

function normalizeFactorReceipt(receipt: AuthFactorReceipt, issuedAt: Date): AuthFactorReceipt {
  if (typeof receipt !== "object" || receipt === null) throw new TypeError("auth_factor_required");
  if (!FACTOR_CLASSES.has(receipt.factorClass)) throw new TypeError("invalid_auth_factor_class");
  if (!CHANNELS.has(receipt.channel)) throw new TypeError("invalid_auth_factor_channel");

  const expected = expectedFactorClass(receipt.channel);
  if (expected !== null && expected !== receipt.factorClass) {
    throw new Error("auth_factor_channel_class_mismatch");
  }

  const verifiedAt = parseIsoInstant(receipt.verifiedAt, "auth_factor_verified_at");
  if (verifiedAt.getTime() > issuedAt.getTime()) {
    throw new Error("auth_factor_verified_after_assertion_issue");
  }

  return {
    factorId: boundedText(receipt.factorId, MAX_ID_LENGTH, "auth_factor_id"),
    factorClass: receipt.factorClass,
    channel: receipt.channel,
    verifierId: boundedText(receipt.verifierId, MAX_ID_LENGTH, "auth_factor_verifier_id"),
    verifiedAt: verifiedAt.toISOString(),
    ...(receipt.evidenceRef === undefined
      ? {}
      : { evidenceRef: boundedText(receipt.evidenceRef, MAX_REF_LENGTH, "auth_factor_evidence_ref") }),
  };
}

function validateFactorSet(factors: AuthFactorReceipt[]): void {
  if (!Array.isArray(factors) || factors.length < 2) throw new Error("operator_auth_requires_multiple_factors");

  const factorIds = new Set<string>();
  const distinctClasses = new Set<AuthFactorClass>();
  for (const factor of factors) {
    if (factorIds.has(factor.factorId)) throw new Error("duplicate_auth_factor_id");
    factorIds.add(factor.factorId);
    distinctClasses.add(factor.factorClass);
  }

  if (distinctClasses.size < 2) {
    throw new Error("operator_auth_requires_distinct_factor_classes");
  }
}

function assertionBinding(assertion: Omit<OperatorAuthAssertion, "binding">): string {
  return canonicalString(assertion);
}

function verifiedSessionBinding(session: Omit<VerifiedOperatorSession, "sessionBinding">): string {
  return canonicalString(session);
}

/**
 * Structurally binds an assertion that must originate from a server-side auth boundary.
 * It intentionally accepts no raw password, secret phrase, OTP value, recovery code, or credential.
 * This does not authenticate the issuer; issuer trust is a future integration responsibility.
 */
export function bindOperatorAuthAssertion(input: BindOperatorAuthAssertionInput): OperatorAuthAssertion {
  if (!IDENTITIES.has(input.principal)) throw new TypeError("invalid_operator_identity");

  const issuedAt = parseIsoInstant(input.issuedAt, "operator_auth_issued_at");
  const expiresAt = parseIsoInstant(input.expiresAt, "operator_auth_expires_at");
  if (expiresAt.getTime() <= issuedAt.getTime()) throw new Error("operator_auth_nonpositive_window");

  const normalizedFactors = input.factors.map((factor) => normalizeFactorReceipt(factor, issuedAt));
  validateFactorSet(normalizedFactors);

  const payload: Omit<OperatorAuthAssertion, "binding"> = {
    version: OPERATOR_AUTH_VERSION,
    assertionId: boundedText(input.assertionId, MAX_ID_LENGTH, "operator_auth_assertion_id"),
    principal: input.principal,
    sessionId: boundedText(input.sessionId, MAX_ID_LENGTH, "operator_auth_session_id"),
    issuerId: boundedText(input.issuerId, MAX_ID_LENGTH, "operator_auth_issuer_id"),
    nonceId: boundedText(input.nonceId, MAX_ID_LENGTH, "operator_auth_nonce_id"),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    factors: normalizedFactors,
  };

  return { ...payload, binding: assertionBinding(payload) };
}

export function verifyOperatorAuthAssertion(assertion: OperatorAuthAssertion): boolean {
  if (typeof assertion !== "object" || assertion === null) return false;
  if (assertion.version !== OPERATOR_AUTH_VERSION) return false;
  if (!IDENTITIES.has(assertion.principal)) return false;

  try {
    const issuedAt = parseIsoInstant(assertion.issuedAt, "operator_auth_issued_at");
    const expiresAt = parseIsoInstant(assertion.expiresAt, "operator_auth_expires_at");
    if (expiresAt.getTime() <= issuedAt.getTime()) return false;

    boundedText(assertion.assertionId, MAX_ID_LENGTH, "operator_auth_assertion_id");
    boundedText(assertion.sessionId, MAX_ID_LENGTH, "operator_auth_session_id");
    boundedText(assertion.issuerId, MAX_ID_LENGTH, "operator_auth_issuer_id");
    boundedText(assertion.nonceId, MAX_ID_LENGTH, "operator_auth_nonce_id");

    if (!Array.isArray(assertion.factors)) return false;
    const factors = assertion.factors.map((factor) => normalizeFactorReceipt(factor, issuedAt));
    validateFactorSet(factors);

    if (canonicalString(factors) !== canonicalString(assertion.factors)) return false;
  } catch {
    return false;
  }

  const { binding, ...payload } = assertion;
  return binding === assertionBinding(payload);
}

export function assertOperatorAuthAssertionFresh(assertion: OperatorAuthAssertion, now = new Date()): void {
  if (!verifyOperatorAuthAssertion(assertion)) throw new Error("operator_auth_assertion_invalid");
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");

  const issuedAt = parseIsoInstant(assertion.issuedAt, "operator_auth_issued_at");
  const expiresAt = parseIsoInstant(assertion.expiresAt, "operator_auth_expires_at");
  if (now.getTime() < issuedAt.getTime()) throw new Error("operator_auth_assertion_not_yet_valid");
  if (now.getTime() >= expiresAt.getTime()) throw new Error("operator_auth_assertion_expired");
}

export function emptyOperatorAuthReplayState(): OperatorAuthReplayState {
  return {
    version: OPERATOR_AUTH_VERSION,
    consumedAssertionIds: [],
    consumedNonceIds: [],
  };
}

function normalizeReplayState(state: OperatorAuthReplayState): OperatorAuthReplayState {
  if (typeof state !== "object" || state === null || state.version !== OPERATOR_AUTH_VERSION) {
    throw new Error("operator_auth_replay_state_invalid");
  }
  if (!Array.isArray(state.consumedAssertionIds) || !Array.isArray(state.consumedNonceIds)) {
    throw new Error("operator_auth_replay_state_invalid");
  }

  const assertionIds = state.consumedAssertionIds.map((value) =>
    boundedText(value, MAX_ID_LENGTH, "consumed_assertion_id"),
  );
  const nonceIds = state.consumedNonceIds.map((value) => boundedText(value, MAX_ID_LENGTH, "consumed_nonce_id"));
  if (new Set(assertionIds).size !== assertionIds.length || new Set(nonceIds).size !== nonceIds.length) {
    throw new Error("operator_auth_replay_state_duplicate_entry");
  }

  return {
    version: OPERATOR_AUTH_VERSION,
    consumedAssertionIds: [...assertionIds],
    consumedNonceIds: [...nonceIds],
  };
}

/**
 * Consumes a fresh assertion exactly once relative to caller-supplied replay state.
 * The replay state is deliberately explicit because v0.1 has no durable persistence layer yet.
 */
export function consumeOperatorAuthAssertion(
  assertion: OperatorAuthAssertion,
  replayState: OperatorAuthReplayState,
  now = new Date(),
): ConsumeOperatorAuthResult {
  assertOperatorAuthAssertionFresh(assertion, now);
  const state = normalizeReplayState(replayState);

  if (state.consumedAssertionIds.includes(assertion.assertionId)) {
    throw new Error("operator_auth_assertion_replay");
  }
  if (state.consumedNonceIds.includes(assertion.nonceId)) {
    throw new Error("operator_auth_nonce_replay");
  }

  const factorClasses = [...new Set(assertion.factors.map((factor) => factor.factorClass))].sort();
  const payload: Omit<VerifiedOperatorSession, "sessionBinding"> = {
    version: OPERATOR_AUTH_VERSION,
    trust: "EXTERNAL_AUTH_CONTRACT_MATCHED_UNAUTHENTICATED_ISSUER",
    principal: assertion.principal,
    sessionId: assertion.sessionId,
    assertionId: assertion.assertionId,
    issuerId: assertion.issuerId,
    authAssertionBinding: assertion.binding,
    factorClasses,
    issuedAt: assertion.issuedAt,
    expiresAt: assertion.expiresAt,
  };

  const session: VerifiedOperatorSession = {
    ...payload,
    sessionBinding: verifiedSessionBinding(payload),
  };

  return {
    session,
    replayState: {
      version: OPERATOR_AUTH_VERSION,
      consumedAssertionIds: [...state.consumedAssertionIds, assertion.assertionId],
      consumedNonceIds: [...state.consumedNonceIds, assertion.nonceId],
    },
  };
}

export function verifyVerifiedOperatorSession(session: VerifiedOperatorSession): boolean {
  if (typeof session !== "object" || session === null) return false;
  if (session.version !== OPERATOR_AUTH_VERSION) return false;
  if (session.trust !== "EXTERNAL_AUTH_CONTRACT_MATCHED_UNAUTHENTICATED_ISSUER") return false;
  if (!IDENTITIES.has(session.principal)) return false;

  try {
    boundedText(session.sessionId, MAX_ID_LENGTH, "verified_operator_session_id");
    boundedText(session.assertionId, MAX_ID_LENGTH, "verified_operator_assertion_id");
    boundedText(session.issuerId, MAX_ID_LENGTH, "verified_operator_issuer_id");
    boundedText(session.authAssertionBinding, 100_000, "verified_operator_auth_binding");
    const issuedAt = parseIsoInstant(session.issuedAt, "verified_operator_issued_at");
    const expiresAt = parseIsoInstant(session.expiresAt, "verified_operator_expires_at");
    if (expiresAt.getTime() <= issuedAt.getTime()) return false;
    if (!Array.isArray(session.factorClasses) || session.factorClasses.length < 2) return false;
    if (session.factorClasses.some((value) => !FACTOR_CLASSES.has(value))) return false;
    if (new Set(session.factorClasses).size !== session.factorClasses.length) return false;
  } catch {
    return false;
  }

  const { sessionBinding, ...payload } = session;
  return sessionBinding === verifiedSessionBinding(payload);
}

export function assertVerifiedOperatorSessionFresh(
  session: VerifiedOperatorSession,
  now = new Date(),
): void {
  if (!verifyVerifiedOperatorSession(session)) throw new Error("verified_operator_session_invalid");
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");

  const issuedAt = parseIsoInstant(session.issuedAt, "verified_operator_issued_at");
  const expiresAt = parseIsoInstant(session.expiresAt, "verified_operator_expires_at");
  if (now.getTime() < issuedAt.getTime()) throw new Error("verified_operator_session_not_yet_valid");
  if (now.getTime() >= expiresAt.getTime()) throw new Error("verified_operator_session_expired");
}
