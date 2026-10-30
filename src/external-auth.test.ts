import {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createPublicPrincipalContext,
  createProductionAuthVerifierRegistry,
  createTestAuthVerifierRegistry,
  getTrustedPrincipalAuthentication,
  isExternallyVerifiedPrincipalContext,
  resolveVerifiedPrincipalContext,
  type ExternalAuthEvidence,
  type ExternalPrincipalVerifier,
  type AuthVerifierRegistry,
  type ExternalSessionVerification,
} from "./external-auth.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejectsWith(
  fn: () => Promise<unknown>,
  expected: string,
  message: string,
): Promise<void> {
  let matched = false;
  try {
    await fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const now = new Date("2026-10-25T09:00:00.000Z");
const evidence: ExternalAuthEvidence = {
  version: EXTERNAL_AUTH_BOUNDARY_VERSION,
  providerId: "fixture-auth-provider",
  sessionHandle: "session-sal-1",
  verificationRef: "opaque://auth/session-sal-1",
};

function verifierReturning(result: ExternalSessionVerification): AuthVerifierRegistry {
  return createTestAuthVerifierRegistry({
    providerId: "fixture-auth-provider",
    async verify(received): Promise<ExternalSessionVerification> {
      assert(Object.keys(received).sort().join(",") === "providerId,sessionHandle,verificationRef,version", "verifier must receive only normalized allowlisted evidence");
      return result;
    },
  });
}

const verifiedSal = {
  verified: true as const,
  providerId: "fixture-auth-provider",
  principal: "VERIFIED_SAL" as const,
  sessionId: "session-sal-1",
  subjectRef: "provider-subject://sal",
  assurance: "PHISHING_RESISTANT_MFA" as const,
  authenticatedAt: "2026-10-25T08:55:00.000Z",
  expiresAt: "2026-10-25T09:30:00.000Z",
  revoked: false,
};

{
  const resolved = await resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning(verifiedSal),
    now,
    "test",
  );
  assert(resolved.principalContext.principal === "VERIFIED_SAL", "verified principal must come from verifier result");
  assert(resolved.principalContext.verification === "EXTERNAL_AUTH", "verified operator must enter Northstar only as external auth");
  assert(resolved.principalContext.sessionId === evidence.sessionHandle, "verified session must bind exact presented session handle");
  assert(resolved.assurance === "PHISHING_RESISTANT_MFA", "assurance level must survive verification boundary");
}

{
  const publicContext = createPublicPrincipalContext(
    "public-session-1",
    "2026-10-25T08:55:00.000Z",
    "2026-10-25T09:30:00.000Z",
  );
  assert(publicContext.principal === "UNVERIFIED_PUBLIC", "public context must never self-upgrade to operator identity");
  assert(publicContext.verification === "PUBLIC_SESSION", "public context must retain public verification mode");
}

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    { ...evidence, providerId: "attacker-provider" },
    verifierReturning(verifiedSal),
    now,
    "test",
  ),
  "auth_provider_mismatch",
  "provider mismatch must fail before verifier output can grant identity",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({
      verified: false,
      providerId: "fixture-auth-provider",
      reason: "do-not-leak-provider-detail",
    }),
    now,
    "test",
  ),
  "external_auth_rejected",
  "rejected external session must fail with generic rejection reason",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({ ...verifiedSal, revoked: true }),
    now,
    "test",
  ),
  "external_session_revoked",
  "revoked session must fail closed",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({ ...verifiedSal, sessionId: "different-session" }),
    now,
    "test",
  ),
  "verified_session_handle_mismatch",
  "verified session must match the presented session handle",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({
      ...verifiedSal,
      expiresAt: "2026-10-25T09:00:00.000Z",
    }),
    now,
    "test",
  ),
  "external_session_expired",
  "session must fail exactly at expiry",
);

{
  const maliciousEvidence = {
    ...evidence,
    otp: "123456",
  } as ExternalAuthEvidence;
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(
      maliciousEvidence,
      verifierReturning(verifiedSal),
      now,
      "test",
    ),
    "unexpected_auth_evidence_field",
    "unexpected credential-like fields must never be forwarded to verifier",
  );
}

{
  const bjornEvidence: ExternalAuthEvidence = {
    ...evidence,
    sessionHandle: "session-bjorn-1",
    verificationRef: "opaque://auth/session-bjorn-1",
  };
  const resolved = await resolveVerifiedPrincipalContext(
    bjornEvidence,
    verifierReturning({
      ...verifiedSal,
      principal: "VERIFIED_BJORN",
      sessionId: "session-bjorn-1",
      subjectRef: "provider-subject://bjorn",
    }),
    now,
    "test",
  );
  assert(resolved.principalContext.principal === "VERIFIED_BJORN", "verifier may resolve Bjorn independently from evidence shape");
}

{
  let calls = 0;
  const registry = createTestAuthVerifierRegistry({
    providerId: evidence.providerId,
    async verify() { calls++; return verifiedSal; },
  });
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, registry, now),
    "test_auth_verifier_not_allowed_in_production",
    "production mode is the default and must reject a test-only registry",
  );
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, registry, now, "production"),
    "test_auth_verifier_not_allowed_in_production",
    "explicit production mode must reject a test-only verifier",
  );
  assert(calls === 0, "production admission must reject the test registry before invoking its implementation");
  await rejectsWith(
    async () => createProductionAuthVerifierRegistry("unknown-provider"),
    "unknown_auth_provider",
    "an unknown production provider must fail closed",
  );
  await rejectsWith(
    async () => createProductionAuthVerifierRegistry("fixture-auth-provider"),
    "unknown_auth_provider",
    "a fixture provider must not be accidentally configured in production",
  );
  for (const inheritedName of ["constructor", "__proto__", "toString"]) {
    await rejectsWith(
      async () => createProductionAuthVerifierRegistry(inheritedName),
      "unknown_auth_provider",
      "inherited object properties must not become production provider factories",
    );
  }
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, { ...registry }, now, "test"),
    "auth_verifier_registry_required",
    "copied/deserialized registry metadata must lose its private configured verifier",
  );
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, { ...registry, mode: "production" }, now),
    "auth_verifier_registry_required",
    "relabeling copied registry metadata cannot manufacture a production verifier",
  );
  const arbitraryVerifier: ExternalPrincipalVerifier = {
    providerId: evidence.providerId,
    async verify() { return verifiedSal; },
  };
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(
      evidence,
      arbitraryVerifier as unknown as AuthVerifierRegistry,
      now,
      "test",
    ),
    "auth_verifier_registry_required",
    "the original resolver must reject direct arbitrary verifier injection",
  );
}

{
  const resolved = await resolveVerifiedPrincipalContext(evidence, verifierReturning(verifiedSal), now, "test");
  const trusted = getTrustedPrincipalAuthentication(resolved.principalContext);
  assert(trusted?.assurance === "PHISHING_RESISTANT_MFA", "trusted assurance must be available only for the exact verified principal context");
  assert(trusted.mode === "test", "fixture identity must retain its test-only mode");
  assert(Object.isFrozen(trusted), "trusted auth metadata must be immutable");
  assert(Object.isFrozen(resolved.principalContext) && Object.isFrozen(resolved), "context and returned wrapper must be immutable");
  assert(!Reflect.set(resolved.principalContext, "principal", "VERIFIED_BJORN"), "stamped principal cannot be changed after verification");
  assert(!Reflect.set(resolved.principalContext, "sessionId", "session-bjorn-1"), "stamped session cannot be changed after verification");
  assert(!Reflect.set(trusted, "assurance", "SINGLE_FACTOR"), "trusted assurance cannot be replaced by a caller");
  assert(!Reflect.set(resolved, "assurance", "SINGLE_FACTOR"), "wrapper assurance cannot be mutated independently");
  assert(isExternallyVerifiedPrincipalContext(resolved.principalContext), "unchanged immutable stamped context must remain verified");
  assert(!isExternallyVerifiedPrincipalContext({ ...resolved.principalContext }), "a copied principal context must never retain the auth stamp");
  assert(getTrustedPrincipalAuthentication({ ...resolved.principalContext }) === undefined, "copied principal context cannot retrieve trusted assurance");
  const publicContext = createPublicPrincipalContext("public-1", verifiedSal.authenticatedAt, verifiedSal.expiresAt);
  assert(getTrustedPrincipalAuthentication(publicContext) === undefined, "public contexts cannot acquire authenticated assurance metadata");
}

{
  for (const assurance of ["SINGLE_FACTOR", "MFA", "PHISHING_RESISTANT_MFA"] as const) {
    const resolved = await resolveVerifiedPrincipalContext(evidence, verifierReturning({ ...verifiedSal, assurance }), now, "test");
    assert(getTrustedPrincipalAuthentication(resolved.principalContext)?.assurance === assurance, "each supported assurance level must survive in the immutable trusted channel");
  }
  const providerDetail = "service_role internal_table private database error";
  const throwing = createTestAuthVerifierRegistry({
    providerId: evidence.providerId,
    async verify() { throw new Error(providerDetail); },
  });
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, throwing, now, "test"),
    "external_auth_verifier_error",
    "provider exception details must not propagate through the runtime error",
  );
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(
      evidence,
      verifierReturning({ ...verifiedSal, revoked: undefined } as unknown as ExternalSessionVerification),
      now,
      "test",
    ),
    "external_session_revoked",
    "unknown revocation state must not inherit a safe false value",
  );
}

{
  let calls = 0;
  const registry = createTestAuthVerifierRegistry({
    providerId: evidence.providerId,
    async verify() { calls++; return verifiedSal; },
  });
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, registry, new Date("invalid"), "test"),
    "invalid_now",
    "an invalid explicit clock must fail before invoking a verifier",
  );
  assert(calls === 0, "invalid clocks must not reach the external provider");
  await rejectsWith(
    () => resolveVerifiedPrincipalContext(evidence, verifierReturning({
      ...verifiedSal, authenticatedAt: "2026-10-25T09:01:00.000Z",
    }), now, "test"),
    "external_session_not_yet_valid",
    "future authentication cannot be accepted before its validity window",
  );
}

{
  // Deterministic clock advances without sleeps or live provider/network calls.
  const RealDate = globalThis.Date;
  let clockMs = RealDate.parse("2026-10-25T09:00:00.000Z");
  class FixtureDate extends RealDate {
    constructor(value?: string | number) {
      if (value === undefined) super(clockMs);
      else super(value);
    }
    static now(): number { return clockMs; }
  }
  globalThis.Date = FixtureDate as DateConstructor;
  try {
    const clocks: Array<[number, string]> = [
      [RealDate.parse(verifiedSal.expiresAt), "external_session_expired"],
      [RealDate.parse(verifiedSal.authenticatedAt) - 1, "external_session_not_yet_valid"],
      [Number.NaN, "invalid_now"],
    ];
    for (const [afterAwait, expected] of clocks) {
      clockMs = RealDate.parse("2026-10-25T09:00:00.000Z");
      let release!: (result: ExternalSessionVerification) => void;
      const response = new Promise<ExternalSessionVerification>((resolve) => { release = resolve; });
      const registry = createTestAuthVerifierRegistry({
        providerId: evidence.providerId,
        verify: () => response,
      });
      const pending = resolveVerifiedPrincipalContext(evidence, registry, undefined, "test");
      clockMs = afterAwait;
      release(verifiedSal);
      await rejectsWith(() => pending, expected,
        "default clock must be freshly validated after a delayed provider response");
    }
  } finally {
    globalThis.Date = RealDate;
  }
}

console.log("external auth boundary, verifier registry, and async clock hardening tests passed");
