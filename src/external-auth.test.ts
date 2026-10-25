import {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createPublicPrincipalContext,
  resolveVerifiedPrincipalContext,
  type ExternalAuthEvidence,
  type ExternalPrincipalVerifier,
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

function verifierReturning(result: ExternalSessionVerification): ExternalPrincipalVerifier {
  return {
    providerId: "fixture-auth-provider",
    async verify(received): Promise<ExternalSessionVerification> {
      assert(Object.keys(received).sort().join(",") === "providerId,sessionHandle,verificationRef,version", "verifier must receive only normalized allowlisted evidence");
      return result;
    },
  };
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
  ),
  "external_auth_rejected",
  "rejected external session must fail with generic rejection reason",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({ ...verifiedSal, revoked: true }),
    now,
  ),
  "external_session_revoked",
  "revoked session must fail closed",
);

await rejectsWith(
  () => resolveVerifiedPrincipalContext(
    evidence,
    verifierReturning({ ...verifiedSal, sessionId: "different-session" }),
    now,
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
  );
  assert(resolved.principalContext.principal === "VERIFIED_BJORN", "verifier may resolve Bjorn independently from evidence shape");
}

console.log("external auth boundary tests passed");
