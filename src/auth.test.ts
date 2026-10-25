import {
  OPERATOR_AUTH_VERSION,
  assertOperatorAuthAssertionFresh,
  assertVerifiedOperatorSessionFresh,
  bindOperatorAuthAssertion,
  consumeOperatorAuthAssertion,
  emptyOperatorAuthReplayState,
  verifyOperatorAuthAssertion,
  verifyVerifiedOperatorSession,
  type AuthFactorReceipt,
} from "./auth.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try {
    fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const now = new Date("2026-10-25T05:00:00.000Z");

const factors: AuthFactorReceipt[] = [
  {
    factorId: "knowledge-1",
    factorClass: "KNOWLEDGE",
    channel: "NORTHSTAR_SECRET",
    verifierId: "server-secret-verifier",
    verifiedAt: "2026-10-25T04:59:00.000Z",
    evidenceRef: "opaque:knowledge-proof-1",
  },
  {
    factorId: "possession-1",
    factorClass: "POSSESSION",
    channel: "TOTP",
    verifierId: "server-totp-verifier",
    verifiedAt: "2026-10-25T04:59:30.000Z",
    evidenceRef: "opaque:possession-proof-1",
  },
];

const assertion = bindOperatorAuthAssertion({
  assertionId: "auth-assertion-1",
  principal: "SAL",
  sessionId: "sal-session-1",
  issuerId: "future-auth-service",
  nonceId: "nonce-1",
  issuedAt: "2026-10-25T05:00:00.000Z",
  expiresAt: "2026-10-25T06:00:00.000Z",
  factors,
});

{
  assert(assertion.version === OPERATOR_AUTH_VERSION, "auth version must be bound");
  assert(verifyOperatorAuthAssertion(assertion), "fresh multi-factor assertion must verify structurally");
  assertOperatorAuthAssertionFresh(assertion, now);
  const { session, replayState } = consumeOperatorAuthAssertion(assertion, emptyOperatorAuthReplayState(), now);
  assert(session.principal === "SAL", "operator identity must survive into verified session artifact");
  assert(session.factorClasses.includes("KNOWLEDGE"), "knowledge factor class must be preserved");
  assert(session.factorClasses.includes("POSSESSION"), "possession factor class must be preserved");
  assert(verifyVerifiedOperatorSession(session), "verified operator session artifact must verify structurally");
  assertVerifiedOperatorSessionFresh(session, now);
  assert(replayState.consumedAssertionIds.includes(assertion.assertionId), "assertion must be consumed");
  assert(replayState.consumedNonceIds.includes(assertion.nonceId), "nonce must be consumed");
}

{
  throwsWith(
    () => bindOperatorAuthAssertion({
      assertionId: "same-class-only",
      principal: "SAL",
      sessionId: "same-class-session",
      issuerId: "future-auth-service",
      nonceId: "same-class-nonce",
      issuedAt: "2026-10-25T05:00:00.000Z",
      expiresAt: "2026-10-25T06:00:00.000Z",
      factors: [
        {
          factorId: "email-otp",
          factorClass: "POSSESSION",
          channel: "EMAIL_OTP",
          verifierId: "email-verifier",
          verifiedAt: "2026-10-25T04:58:00.000Z",
        },
        {
          factorId: "sms-otp",
          factorClass: "POSSESSION",
          channel: "SMS_OTP",
          verifierId: "sms-verifier",
          verifiedAt: "2026-10-25T04:59:00.000Z",
        },
      ],
    }),
    "operator_auth_requires_distinct_factor_classes",
    "two possession channels must not be misrepresented as two independent factor classes",
  );
}

{
  throwsWith(
    () => bindOperatorAuthAssertion({
      assertionId: "channel-class-mismatch",
      principal: "SAL",
      sessionId: "mismatch-session",
      issuerId: "future-auth-service",
      nonceId: "mismatch-nonce",
      issuedAt: "2026-10-25T05:00:00.000Z",
      expiresAt: "2026-10-25T06:00:00.000Z",
      factors: [
        {
          factorId: "bad-secret",
          factorClass: "POSSESSION",
          channel: "NORTHSTAR_SECRET",
          verifierId: "bad-verifier",
          verifiedAt: "2026-10-25T04:59:00.000Z",
        },
        factors[1],
      ],
    }),
    "auth_factor_channel_class_mismatch",
    "channel taxonomy must not be relabeled to manufacture factor diversity",
  );
}

{
  const { replayState } = consumeOperatorAuthAssertion(assertion, emptyOperatorAuthReplayState(), now);
  throwsWith(
    () => consumeOperatorAuthAssertion(assertion, replayState, now),
    "operator_auth_assertion_replay",
    "consumed auth assertions must not be accepted twice relative to replay state",
  );
}

{
  const secondAssertion = bindOperatorAuthAssertion({
    assertionId: "auth-assertion-2",
    principal: "SAL",
    sessionId: "sal-session-2",
    issuerId: "future-auth-service",
    nonceId: assertion.nonceId,
    issuedAt: "2026-10-25T05:00:00.000Z",
    expiresAt: "2026-10-25T06:00:00.000Z",
    factors,
  });
  const { replayState } = consumeOperatorAuthAssertion(assertion, emptyOperatorAuthReplayState(), now);
  throwsWith(
    () => consumeOperatorAuthAssertion(secondAssertion, replayState, now),
    "operator_auth_nonce_replay",
    "reused auth nonce must be rejected even under a new assertion ID",
  );
}

{
  const tampered = {
    ...assertion,
    principal: "BJORN" as const,
  };
  assert(!verifyOperatorAuthAssertion(tampered), "identity mutation must invalidate assertion binding");
}

{
  throwsWith(
    () => assertOperatorAuthAssertionFresh(assertion, new Date("2026-10-25T06:00:00.000Z")),
    "operator_auth_assertion_expired",
    "auth assertion must fail exactly at expiry",
  );
}

console.log("operator auth boundary tests passed");
