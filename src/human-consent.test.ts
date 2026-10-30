import {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createTestAuthVerifierRegistry,
  resolveVerifiedPrincipalContext,
  type AuthenticationAssurance,
  type VerifiedOperatorPrincipal,
} from "./external-auth.js";
import { compileNorthstarContext, type NorthstarContextPack } from "./northstar.js";
import { ARCHITECT_ENGINEER_STRAND_VERSION } from "./strand.js";
import { SAB_POLICY_VERSION, proposalBinding, type ActionProposal } from "./sab.js";
import { ASSURANCE_POLICY_VERSION } from "./assurance-policy.js";
import {
  MAX_CONSENT_CHALLENGES,
  MAX_HUMAN_CONSENT_TTL_MS,
  createProductionHumanConsentAuthority,
  createTestHumanConsentAuthority,
  getHumanConsentAuthorityMode,
  type HumanConsentAuthority,
  type HumanConsentChallenge,
  type HumanConsentEvidence,
  type HumanConsentReceipt,
  type HumanConsentTransaction,
  type HumanConsentVerification,
} from "./human-consent.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string): void {
  let matched = false;
  try { fn(); }
  catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `Expected ${expected}`);
}

async function rejectsWith(fn: () => Promise<unknown>, expected: string): Promise<void> {
  let matched = false;
  try { await fn(); }
  catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `Expected ${expected}`);
}

const now = new Date("2026-10-25T10:00:00.000Z");
const proposal: ActionProposal = {
  id: "consent-proposal-a", type: "WRITE", scope: "PRODUCTION", target: "internal://fixture-record",
  reversible: true, dataSensitivity: "INTERNAL", affectedRecords: 1, estimatedCost: 0, containsSecrets: false,
};
const transaction: HumanConsentTransaction = {
  proposal,
  operationBinding: "fixture-operation:adapter-a:resource-v1:architecture-a:engineering-a",
  policyVersion: SAB_POLICY_VERSION,
};

async function operator(
  principal: VerifiedOperatorPrincipal = "VERIFIED_SAL",
  sessionId = "consent-session-sal",
  assurance: AuthenticationAssurance = "MFA",
  expiresAt = "2026-10-25T10:30:00.000Z",
  roleId: "MT" | "PH" = "MT",
): Promise<NorthstarContextPack> {
  const registry = createTestAuthVerifierRegistry({
    providerId: "consent-auth-fixture",
    async verify() {
      return {
        verified: true, providerId: "consent-auth-fixture", principal, sessionId,
        subjectRef: `fixture-subject://${principal}`, assurance,
        authenticatedAt: "2026-10-25T09:55:00.000Z", expiresAt, revoked: false,
      };
    },
  });
  const resolved = await resolveVerifiedPrincipalContext({
    version: EXTERNAL_AUTH_BOUNDARY_VERSION, providerId: "consent-auth-fixture",
    sessionHandle: sessionId, verificationRef: "fixture-auth-reference",
  }, registry, now, "test");
  return compileNorthstarContext({
    roleId, principalContext: resolved.principalContext,
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC", "INTERNAL"], now,
  });
}

/** Simulated independent provider response storage, not a human-consent UI. */
function fixtureProvider() {
  const responses = new Map<string, HumanConsentVerification>();
  let allowed = true;
  let calls = 0;
  const authority = createTestHumanConsentAuthority({
    providerId: "independent-consent-fixture",
    async verify(evidence) {
      calls++;
      const result = responses.get(evidence.verificationRef);
      if (!result) throw new Error("No independently recorded fixture response");
      return result;
    },
  }, () => allowed);
  function humanResponse(
    challenge: HumanConsentChallenge,
    decision: "APPROVED" | "REJECTED" = "APPROVED",
    overrides: Partial<HumanConsentVerification> = {},
  ): HumanConsentEvidence {
    const reference = `fixture-response-${responses.size}`;
    responses.set(reference, {
      decision, challengeId: challenge.challengeId, principal: challenge.principal,
      sessionId: challenge.sessionId, ...overrides,
    });
    return { providerId: "independent-consent-fixture", challengeId: challenge.challengeId, verificationRef: reference };
  }
  return { authority, humanResponse, revoke: () => { allowed = false; }, calls: () => calls };
}

const sal = await operator();
let cases = 0;
async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); cases++; }
  catch (error) { throw new Error(`Human consent case failed: ${name}`, { cause: error }); }
}

async function issued() {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  const receipt = await fixture.authority.resolveConsent(challenge.challengeId, fixture.humanResponse(challenge), sal, now);
  return { ...fixture, challenge, receipt };
}

await test("server-issued challenge binds exact operation and bounded policy windows", () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  assert(challenge.challengeId.length > 0, "Challenge ID must be generated server-side");
  assert(challenge.proposalBinding === proposalBinding(proposal), "Proposal must bind exactly");
  assert(challenge.operationBinding === transaction.operationBinding, "Operation must bind exactly");
  assert(challenge.northstarContextBinding === sal.contextBinding, "Northstar context must bind exactly");
  assert(challenge.assurancePolicyVersion === ASSURANCE_POLICY_VERSION, "Assurance policy must bind");
  assert(new Date(challenge.expiresAt).getTime() - now.getTime() === MAX_HUMAN_CONSENT_TTL_MS, "Challenge TTL must be bounded");
  assert(Object.isFrozen(challenge) && Object.isFrozen(fixture.authority), "Server objects must be immutable");
  assert(getHumanConsentAuthorityMode(fixture.authority) === "test", "Fixture authority must be marked test-only");
});

await test("login plus caller-created approved object is not consent", () => {
  const fixture = fixtureProvider();
  const forged = { approved: true, approvedBy: "VERIFIED_SAL" } as unknown as HumanConsentReceipt;
  assert(!fixture.authority.verifyReceipt(forged, transaction, sal, now), "No caller-created approved object may satisfy consent");
  throwsWith(() => fixture.authority.consumeReceipt(forged, transaction, sal, now), "human_consent_receipt_invalid_or_consumed");
  assert(getHumanConsentAuthorityMode({ mode: "test" } as HumanConsentAuthority) === undefined, "Forged authority must not acquire private stamp");
});

await test("opaque evidence alone requires independent provider response", async () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  await rejectsWith(() => fixture.authority.resolveConsent(challenge.challengeId, {
    providerId: "independent-consent-fixture", challengeId: challenge.challengeId, verificationRef: "caller-only-reference",
  }, sal, now), "human_consent_verification_failed");
});

await test("approved exact receipt verifies without consuming and copied receipts fail", async () => {
  const { authority, receipt } = await issued();
  assert(Object.isFrozen(receipt), "Receipt must be immutable");
  assert(authority.verifyReceipt(receipt, transaction, sal, now), "Receipt must verify");
  assert(authority.verifyReceipt(receipt, transaction, sal, now), "Inspection must not consume consent");
  assert(!authority.verifyReceipt({ ...receipt }, transaction, sal, now), "Copy must lose server receipt stamp");
  assert(!authority.verifyReceipt(JSON.parse(JSON.stringify(receipt)), transaction, sal, now), "Deserialized receipt must lose server stamp");
});

await test("consent consumption is one-time", async () => {
  const { authority, receipt } = await issued();
  authority.consumeReceipt(receipt, transaction, sal, now);
  assert(!authority.verifyReceipt(receipt, transaction, sal, now), "Consumed consent must not verify");
  throwsWith(() => authority.consumeReceipt(receipt, transaction, sal, now), "human_consent_receipt_invalid_or_consumed");
});

await test("proposal A cannot approve proposal B", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, { ...transaction, proposal: { ...proposal, id: "consent-proposal-b" } }, sal, now), "Changed proposal must fail");
});

await test("adapter/resource/state operation binding cannot drift", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, { ...transaction, operationBinding: "different-adapter-resource-or-lifecycle" }, sal, now), "Changed operation must fail");
});

await test("session A cannot be reused by session B", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, transaction, await operator("VERIFIED_SAL", "consent-session-other"), now), "Different session must fail");
});

await test("Sal consent cannot be reused by Bjorn", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, transaction, await operator("VERIFIED_BJORN", "consent-session-bjorn"), now), "Different principal must fail");
});

await test("same principal and session require the exact Northstar context", async () => {
  const { authority, receipt } = await issued();
  const alternate = await operator("VERIFIED_SAL", "consent-session-sal", "MFA", "2026-10-25T10:30:00.000Z", "PH");
  assert(!authority.verifyReceipt(receipt, transaction, alternate, now), "Different scoped context must fail");
});

await test("expired consent and not-yet-issued timestamps fail", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, transaction, sal, new Date(receipt.expiresAt)), "Consent expires at its exact deadline");
  assert(!authority.verifyReceipt(receipt, transaction, sal, new Date(now.getTime() - 1)), "Future-issued consent must not verify");
});

await test("a later human response cannot be backdated into an earlier approval", async () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  const answeredAt = new Date(now.getTime() + 30_000);
  const receipt = await fixture.authority.resolveConsent(challenge.challengeId, fixture.humanResponse(challenge), sal, answeredAt);
  assert(!fixture.authority.verifyReceipt(receipt, transaction, sal, now), "Approval must not exist before human response issuance");
  assert(fixture.authority.verifyReceipt(receipt, transaction, sal, answeredAt), "Receipt may verify at its actual issuance time");
});

await test("session expiry bounds consent lifetime", async () => {
  const context = await operator("VERIFIED_SAL", "short-session", "MFA", "2026-10-25T10:01:00.000Z");
  const fixture = fixtureProvider();
  assert(fixture.authority.issueChallenge(transaction, context, now).expiresAt === context.expiresAt, "Consent cannot outlive authenticated session");
});

await test("policy drift requires fresh consent", async () => {
  const { authority, receipt } = await issued();
  assert(!authority.verifyReceipt(receipt, { ...transaction, policyVersion: "future-active-policy" }, sal, now), "Policy drift must invalidate prior consent");
});

await test("rejected response cannot be consumed or replaced on the same challenge", async () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  const receipt = await fixture.authority.resolveConsent(challenge.challengeId, fixture.humanResponse(challenge, "REJECTED"), sal, now);
  assert(receipt.consentDecision === "REJECTED", "Veto must remain explicit");
  assert(!fixture.authority.verifyReceipt(receipt, transaction, sal, now), "Rejected response must not authorize");
  throwsWith(() => fixture.authority.consumeReceipt(receipt, transaction, sal, now), "human_consent_receipt_invalid_or_consumed");
  await rejectsWith(() => fixture.authority.resolveConsent(challenge.challengeId, fixture.humanResponse(challenge), sal, now), "human_consent_challenge_already_resolved");
});

await test("MFA policy applies before challenge issuance", async () => {
  const low = await operator("VERIFIED_SAL", "single-factor-session", "SINGLE_FACTOR");
  throwsWith(() => fixtureProvider().authority.issueChallenge(transaction, low, now), "authentication_assurance_insufficient");
});

await test("SAB DENY cannot be overridden by phishing-resistant identity", async () => {
  const high = await operator("VERIFIED_SAL", "strong-session", "PHISHING_RESISTANT_MFA");
  throwsWith(() => fixtureProvider().authority.issueChallenge({
    ...transaction, proposal: { ...proposal, scope: "EXTERNAL", dataSensitivity: "SECRET", containsSecrets: true },
  }, high, now), "sab_denied");
});

await test("governance remains an explicit neutral capability policy", () => {
  const authority = createTestHumanConsentAuthority({ providerId: "capability-fixture", async verify() { throw new Error("unused"); } }, () => false);
  throwsWith(() => authority.issueChallenge(transaction, sal, now), "human_consent_capability_required");
});

await test("capability revocation invalidates already-issued consent", async () => {
  const fixture = await issued();
  fixture.revoke();
  assert(!fixture.authority.verifyReceipt(fixture.receipt, transaction, sal, now), "Revoked capability must fail");
});

for (const drift of ["principal", "sessionId", "challengeId"] as const) {
  await test(`provider ${drift} mismatch fails closed`, async () => {
    const fixture = fixtureProvider();
    const challenge = fixture.authority.issueChallenge(transaction, sal, now);
    const override = drift === "principal" ? { principal: "VERIFIED_BJORN" as const }
      : drift === "sessionId" ? { sessionId: "other-session" } : { challengeId: "other-challenge" };
    await rejectsWith(() => fixture.authority.resolveConsent(challenge.challengeId, fixture.humanResponse(challenge, "APPROVED", override), sal, now), "human_consent_verification_failed");
  });
}

await test("caller approval fields are rejected before provider verification", async () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  const evidence = { ...fixture.humanResponse(challenge), approved: true };
  await rejectsWith(() => fixture.authority.resolveConsent(challenge.challengeId, evidence, sal, now), "unexpected_human_consent_evidence_field");
  assert(fixture.calls() === 0, "Unexpected fields must not reach provider");
});

await test("accessor evidence does not execute caller getters", async () => {
  const fixture = fixtureProvider();
  const challenge = fixture.authority.issueChallenge(transaction, sal, now);
  const evidence = fixture.humanResponse(challenge);
  let reads = 0;
  Object.defineProperty(evidence, "verificationRef", { get() { reads++; throw new Error("secret getter"); } });
  await rejectsWith(() => fixture.authority.resolveConsent(challenge.challengeId, evidence, sal, now), "human_consent_data_fields_required");
  assert(reads === 0, "Evidence getters must never run");
});

await test("provider failure details never escape the consent boundary", async () => {
  const authority = createTestHumanConsentAuthority({
    providerId: "failing-consent-fixture",
    async verify() { throw new Error("service_role internal_sensitive_table database detail"); },
  }, () => true);
  const challenge = authority.issueChallenge(transaction, sal, now);
  try {
    await authority.resolveConsent(challenge.challengeId, {
      providerId: "failing-consent-fixture", challengeId: challenge.challengeId, verificationRef: "fixture-failure",
    }, sal, now);
    throw new Error("Expected provider failure");
  } catch (error) {
    assert(error instanceof Error && error.message === "human_consent_verification_failed", "Provider exception must be fixed");
    assert(error.cause === undefined, "Provider exception must not leak through cause");
    assert(!String(error.stack).includes("service_role"), "Provider detail must not enter stack");
  }
});

await test("concurrent resolutions cannot mint duplicate consent", async () => {
  let release!: (result: HumanConsentVerification) => void;
  const pending = new Promise<HumanConsentVerification>((resolve) => { release = resolve; });
  const authority = createTestHumanConsentAuthority({ providerId: "slow-fixture", verify: () => pending }, () => true);
  const challenge = authority.issueChallenge(transaction, sal, now);
  const evidence = { providerId: "slow-fixture", challengeId: challenge.challengeId, verificationRef: "independent-response" };
  const first = authority.resolveConsent(challenge.challengeId, evidence, sal, now);
  await rejectsWith(() => authority.resolveConsent(challenge.challengeId, evidence, sal, now), "human_consent_challenge_already_resolved");
  release({ decision: "APPROVED", challengeId: challenge.challengeId, principal: challenge.principal, sessionId: challenge.sessionId });
  assert(authority.verifyReceipt(await first, transaction, sal, now), "Only first resolution may mint a valid receipt");
});

await test("freshness is rechecked after asynchronous provider verification", async () => {
  let release!: (result: HumanConsentVerification) => void;
  const pending = new Promise<HumanConsentVerification>((resolve) => { release = resolve; });
  const authority = createTestHumanConsentAuthority({ providerId: "delayed-fixture", verify: () => pending }, () => true);
  const clock = new Date(now);
  const challenge = authority.issueChallenge(transaction, sal, clock);
  const answer = authority.resolveConsent(challenge.challengeId, {
    providerId: "delayed-fixture", challengeId: challenge.challengeId, verificationRef: "independent-response",
  }, sal, clock);
  clock.setTime(new Date(challenge.expiresAt).getTime());
  release({ decision: "APPROVED", challengeId: challenge.challengeId, principal: challenge.principal, sessionId: challenge.sessionId });
  await rejectsWith(() => answer, "human_consent_expired");
});

await test("registry capacity rejects growth without evicting replay tombstones", async () => {
  const fixture = await issued();
  fixture.authority.consumeReceipt(fixture.receipt, transaction, sal, now);
  const second = fixture.authority.issueChallenge(transaction, sal, now);
  const secondReceipt = await fixture.authority.resolveConsent(second.challengeId, fixture.humanResponse(second), sal, now);
  for (let i = 2; i < MAX_CONSENT_CHALLENGES; i++) fixture.authority.issueChallenge(transaction, sal, now);
  throwsWith(() => fixture.authority.issueChallenge(transaction, sal, now), "human_consent_registry_capacity_exceeded");
  assert(!fixture.authority.verifyReceipt(fixture.receipt, transaction, sal, now), "Consumed tombstone must remain");
  assert(fixture.authority.verifyReceipt(secondReceipt, transaction, sal, now), "Pending valid receipt must remain");
});

await test("receipts cannot cross independently configured authorities", async () => {
  const { receipt } = await issued();
  assert(!fixtureProvider().authority.verifyReceipt(receipt, transaction, sal, now), "Another authority must not accept the receipt");
});

await test("unconfigured production consent providers fail closed", () => {
  throwsWith(() => createProductionHumanConsentAuthority("independent-consent-fixture"), "unknown_human_consent_provider");
});

console.log(`human consent boundary tests passed (${cases} adversarial cases)`);
