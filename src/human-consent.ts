import {
  type AuthRuntimeMode,
  type TrustedPrincipalAuthentication,
  type VerifiedOperatorPrincipal,
} from "./external-auth.js";
import {
  assertNorthstarContextFresh,
  getTrustedNorthstarAuthentication,
  type NorthstarContextPack,
} from "./northstar.js";
import {
  ASSURANCE_POLICY_VERSION,
  assertAuthenticationAssurance,
} from "./assurance-policy.js";
import {
  SAB_POLICY_VERSION,
  evaluateProposal,
  proposalBinding,
  validateProposal,
  type ActionProposal,
} from "./sab.js";

export const HUMAN_CONSENT_VERSION = "2026-10-25.1" as const;
export const MAX_HUMAN_CONSENT_TTL_MS = 5 * 60_000;
export const MAX_CONSENT_CHALLENGES = 256;

const MAX_ID_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 4000;
const MAX_BINDING_LENGTH = 64_000;
const CONSENT_EVIDENCE_FIELDS = new Set(["providerId", "challengeId", "verificationRef"]);
const CONSENT_RESULT_FIELDS = new Set(["decision", "challengeId", "principal", "sessionId"]);

export interface HumanConsentTransaction {
  proposal: ActionProposal;
  operationBinding: string;
  policyVersion: string;
}

export interface HumanConsentChallenge {
  readonly version: typeof HUMAN_CONSENT_VERSION;
  readonly challengeId: string;
  readonly principal: VerifiedOperatorPrincipal;
  readonly sessionId: string;
  readonly northstarContextBinding: string;
  readonly proposalBinding: string;
  readonly operationBinding: string;
  readonly policyVersion: string;
  readonly assurancePolicyVersion: typeof ASSURANCE_POLICY_VERSION;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly mode: AuthRuntimeMode;
  readonly binding: string;
}

export interface HumanConsentReceipt extends HumanConsentChallenge {
  readonly consentId: string;
  readonly consentDecision: "APPROVED" | "REJECTED";
}

/** Opaque reference only: no caller-supplied approval, principal, or session. */
export interface HumanConsentEvidence {
  providerId: string;
  challengeId: string;
  verificationRef: string;
}

export interface HumanConsentVerification {
  decision: "APPROVED" | "REJECTED";
  challengeId: string;
  principal: VerifiedOperatorPrincipal;
  sessionId: string;
}

/**
 * A future server-owned provider must independently verify a deliberate human
 * response to the exact challenge. A login session alone cannot implement it.
 * No real production provider is configured by this prototype.
 */
export interface HumanConsentVerifier {
  providerId: string;
  verify(
    evidence: Readonly<HumanConsentEvidence>,
    challenge: Readonly<HumanConsentChallenge>,
  ): Promise<HumanConsentVerification>;
}

/** Trusted server configuration; this module assigns neither human governance power. */
export type PrincipalConsentCapability = (
  principal: VerifiedOperatorPrincipal,
  proposal: Readonly<ActionProposal>,
) => boolean;

export interface HumanConsentAuthority {
  readonly mode: AuthRuntimeMode;
  issueChallenge(
    transaction: HumanConsentTransaction,
    northstar: NorthstarContextPack,
    now?: Date,
  ): HumanConsentChallenge;
  resolveConsent(
    challengeId: string,
    evidence: HumanConsentEvidence,
    northstar: NorthstarContextPack,
    now?: Date,
  ): Promise<HumanConsentReceipt>;
  verifyReceipt(
    receipt: HumanConsentReceipt,
    transaction: HumanConsentTransaction,
    northstar: NorthstarContextPack,
    now?: Date,
  ): boolean;
  consumeReceipt(
    receipt: HumanConsentReceipt,
    transaction: HumanConsentTransaction,
    northstar: NorthstarContextPack,
    now?: Date,
  ): void;
}

interface StoredConsent {
  readonly challenge: HumanConsentChallenge;
  readonly transaction: HumanConsentTransaction;
  resolving: boolean;
  consumed: boolean;
  receipt?: HumanConsentReceipt;
}

const consentAuthorities = new WeakMap<object, AuthRuntimeMode>();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("human_consent_record_required");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError("human_consent_plain_record_required");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor)) {
      throw new TypeError("human_consent_data_fields_required");
    }
    result[key] = descriptor.value;
  }
  return result;
}

function text(value: unknown, maxLength: number, error: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(error);
  }
  return value;
}

function instant(now: Date): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("invalid_now");
  }
  return now.getTime();
}

function binding(value: object): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function transactionSnapshot(transaction: HumanConsentTransaction): HumanConsentTransaction {
  const data = record(transaction);
  for (const key of Object.keys(data)) {
    if (key !== "proposal" && key !== "operationBinding" && key !== "policyVersion") {
      throw new Error("unexpected_consent_transaction_field");
    }
  }
  const proposal = record(data.proposal);
  if (validateProposal(proposal).length) throw new Error("human_consent_proposal_invalid");
  const typed = Object.freeze({ ...proposal }) as unknown as ActionProposal;
  if (evaluateProposal(typed).route === "DENY") throw new Error("sab_denied");
  if (data.policyVersion !== SAB_POLICY_VERSION) throw new Error("human_consent_policy_mismatch");
  return Object.freeze({
    proposal: typed,
    operationBinding: text(data.operationBinding, MAX_BINDING_LENGTH, "human_consent_operation_binding_invalid"),
    policyVersion: SAB_POLICY_VERSION,
  });
}

function trustedAuthentication(
  northstar: NorthstarContextPack,
  mode: AuthRuntimeMode,
  now: Date,
): Readonly<TrustedPrincipalAuthentication> {
  instant(now);
  assertNorthstarContextFresh(northstar, now);
  const auth = getTrustedNorthstarAuthentication(northstar);
  if (!auth) throw new Error("human_consent_verified_session_required");
  if (auth.mode !== mode) throw new Error("human_consent_runtime_mode_mismatch");
  return auth;
}

function assertChallengeContext(
  challenge: HumanConsentChallenge,
  northstar: NorthstarContextPack,
  mode: AuthRuntimeMode,
  now: Date,
): Readonly<TrustedPrincipalAuthentication> {
  const auth = trustedAuthentication(northstar, mode, now);
  const nowMs = instant(now);
  if (challenge.version !== HUMAN_CONSENT_VERSION || challenge.mode !== mode) {
    throw new Error("human_consent_version_mismatch");
  }
  if (challenge.policyVersion !== SAB_POLICY_VERSION || challenge.assurancePolicyVersion !== ASSURANCE_POLICY_VERSION) {
    throw new Error("human_consent_policy_mismatch");
  }
  if (challenge.principal !== auth.principal || challenge.sessionId !== auth.sessionId ||
      challenge.northstarContextBinding !== northstar.contextBinding) {
    throw new Error("human_consent_context_mismatch");
  }
  const issuedAt = new Date(challenge.issuedAt).getTime();
  const expiresAt = new Date(challenge.expiresAt).getTime();
  if (nowMs < issuedAt || nowMs >= expiresAt) throw new Error("human_consent_expired");
  return auth;
}

function configuredAuthority(
  verifier: HumanConsentVerifier,
  canConsent: PrincipalConsentCapability,
  mode: AuthRuntimeMode,
): HumanConsentAuthority {
  const providerId = text(verifier.providerId, MAX_ID_LENGTH, "human_consent_provider_invalid");
  if (typeof verifier.verify !== "function" || typeof canConsent !== "function") {
    throw new TypeError("human_consent_configuration_invalid");
  }
  const verify = verifier.verify.bind(verifier);
  const states = new Map<string, StoredConsent>();
  const receipts = new WeakMap<object, StoredConsent>();

  function requireCapability(principal: VerifiedOperatorPrincipal, proposal: ActionProposal): void {
    let permitted = false;
    try { permitted = canConsent(principal, proposal) === true; }
    catch { throw new Error("human_consent_capability_unavailable"); }
    if (!permitted) throw new Error("human_consent_capability_required");
  }

  function reclaimExpiredChallenges(now: Date): void {
    const nowMs = instant(now);
    for (const [challengeId, state] of states) {
      const expiresAt = new Date(state.challenge.expiresAt).getTime();
      if (Number.isFinite(expiresAt) && nowMs >= expiresAt) states.delete(challengeId);
    }
  }

  function validReceipt(
    receipt: HumanConsentReceipt,
    transaction: HumanConsentTransaction,
    northstar: NorthstarContextPack,
    now: Date,
  ): boolean {
    try {
      if (typeof receipt !== "object" || receipt === null) return false;
      const state = receipts.get(receipt);
      if (!state || state.receipt !== receipt || state.consumed || !Object.isFrozen(receipt)) return false;
      if (receipt.consentDecision !== "APPROVED") return false;
      if (instant(now) < new Date(receipt.issuedAt).getTime()) return false;
      const expected = transactionSnapshot(transaction);
      const auth = assertChallengeContext(state.challenge, northstar, mode, now);
      assertAuthenticationAssurance(expected.proposal, auth.assurance);
      requireCapability(auth.principal, expected.proposal);
      if (receipt.proposalBinding !== proposalBinding(expected.proposal) ||
          receipt.operationBinding !== expected.operationBinding ||
          receipt.policyVersion !== expected.policyVersion) return false;
      if (receipt.challengeId !== state.challenge.challengeId || !receipt.consentId) return false;
      const { binding: claimed, ...payload } = receipt;
      return claimed === binding(payload);
    } catch { return false; }
  }

  const authority: HumanConsentAuthority = Object.freeze({
    mode,
    issueChallenge(transaction: HumanConsentTransaction, northstar: NorthstarContextPack, now = new Date()) {
      const expected = transactionSnapshot(transaction);
      const auth = trustedAuthentication(northstar, mode, now);
      assertAuthenticationAssurance(expected.proposal, auth.assurance);
      requireCapability(auth.principal, expected.proposal);
      // Preserve all active replay tombstones, but reclaim challenges only after
      // their authority window has expired so capacity cannot become a lifetime DoS.
      reclaimExpiredChallenges(now);
      if (states.size >= MAX_CONSENT_CHALLENGES) throw new Error("human_consent_registry_capacity_exceeded");
      const expiresAt = Math.min(instant(now) + MAX_HUMAN_CONSENT_TTL_MS, new Date(auth.expiresAt).getTime());
      const payload: Omit<HumanConsentChallenge, "binding"> = {
        version: HUMAN_CONSENT_VERSION,
        challengeId: globalThis.crypto.randomUUID(),
        principal: auth.principal,
        sessionId: auth.sessionId,
        northstarContextBinding: northstar.contextBinding,
        proposalBinding: proposalBinding(expected.proposal),
        operationBinding: expected.operationBinding,
        policyVersion: SAB_POLICY_VERSION,
        assurancePolicyVersion: ASSURANCE_POLICY_VERSION,
        issuedAt: now.toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        mode,
      };
      const challenge: HumanConsentChallenge = Object.freeze({ ...payload, binding: binding(payload) });
      states.set(challenge.challengeId, { challenge, transaction: expected, resolving: false, consumed: false });
      return challenge;
    },
    async resolveConsent(challengeId: string, evidence: HumanConsentEvidence, northstar: NorthstarContextPack, now?: Date) {
      text(challengeId, MAX_ID_LENGTH, "human_consent_challenge_invalid");
      const state = states.get(challengeId);
      if (!state) throw new Error("human_consent_challenge_unknown");
      const verificationNow = now ?? new Date();
      const auth = assertChallengeContext(state.challenge, northstar, mode, verificationNow);
      assertAuthenticationAssurance(state.transaction.proposal, auth.assurance);
      requireCapability(auth.principal, state.transaction.proposal);
      if (state.resolving || state.receipt || state.consumed) throw new Error("human_consent_challenge_already_resolved");

      const data = record(evidence);
      for (const key of Object.keys(data)) {
        if (!CONSENT_EVIDENCE_FIELDS.has(key)) throw new Error("unexpected_human_consent_evidence_field");
      }
      if (data.providerId !== providerId) throw new Error("human_consent_provider_mismatch");
      if (data.challengeId !== challengeId) throw new Error("human_consent_challenge_mismatch");
      const normalized = Object.freeze({
        providerId,
        challengeId,
        verificationRef: text(data.verificationRef, MAX_REFERENCE_LENGTH, "human_consent_reference_invalid"),
      });

      // The reservation precedes the await, so concurrent answers cannot mint two
      // receipts. Failed verification retains the bounded server challenge.
      state.resolving = true;
      try {
        let result: Record<string, unknown>;
        try { result = record(await verify(normalized, state.challenge)); }
        catch { throw new Error("human_consent_verification_failed"); }
        for (const key of Object.keys(result)) {
          if (!CONSENT_RESULT_FIELDS.has(key)) throw new Error("human_consent_verification_failed");
        }
        if ((result.decision !== "APPROVED" && result.decision !== "REJECTED") ||
            result.challengeId !== challengeId || result.principal !== state.challenge.principal ||
            result.sessionId !== state.challenge.sessionId) {
          throw new Error("human_consent_verification_failed");
        }
        const resolvedNow = now ?? new Date();
        const currentAuth = assertChallengeContext(state.challenge, northstar, mode, resolvedNow);
        assertAuthenticationAssurance(state.transaction.proposal, currentAuth.assurance);
        requireCapability(currentAuth.principal, state.transaction.proposal);
        const { binding: _challengeBinding, ...challengePayload } = state.challenge;
        const payload: Omit<HumanConsentReceipt, "binding"> = {
          ...challengePayload,
          consentId: globalThis.crypto.randomUUID(),
          consentDecision: result.decision,
          issuedAt: resolvedNow.toISOString(),
        };
        const receipt: HumanConsentReceipt = Object.freeze({ ...payload, binding: binding(payload) });
        state.receipt = receipt;
        receipts.set(receipt, state);
        return receipt;
      } finally { state.resolving = false; }
    },
    verifyReceipt(receipt: HumanConsentReceipt, transaction: HumanConsentTransaction, northstar: NorthstarContextPack, now = new Date()) {
      return validReceipt(receipt, transaction, northstar, now);
    },
    consumeReceipt(receipt: HumanConsentReceipt, transaction: HumanConsentTransaction, northstar: NorthstarContextPack, now = new Date()) {
      if (!validReceipt(receipt, transaction, northstar, now)) throw new Error("human_consent_receipt_invalid_or_consumed");
      // Synchronous check-and-mark is process-local only. No durable CAS or
      // cross-process replay guarantee is claimed by this prototype store.
      receipts.get(receipt)!.consumed = true;
    },
  });
  consentAuthorities.set(authority, mode);
  return authority;
}

export function getHumanConsentAuthorityMode(authority: HumanConsentAuthority): AuthRuntimeMode | undefined {
  if (typeof authority !== "object" || authority === null) return undefined;
  return consentAuthorities.get(authority);
}

/** Explicit fixture composition; production entry points must reject test mode. */
export function createTestHumanConsentAuthority(
  verifier: HumanConsentVerifier,
  canConsent: PrincipalConsentCapability,
): HumanConsentAuthority {
  return configuredAuthority(verifier, canConsent, "test");
}

/**
 * Static production provider allowlist is intentionally empty. No arbitrary
 * verifier implementation or provider selected by a model can be registered.
 */
export function createProductionHumanConsentAuthority(providerId: string): HumanConsentAuthority {
  text(providerId, MAX_ID_LENGTH, "human_consent_provider_invalid");
  throw new Error("unknown_human_consent_provider");
}
