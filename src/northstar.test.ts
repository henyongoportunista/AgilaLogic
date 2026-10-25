import {
  bindOperatorAuthAssertion,
  consumeOperatorAuthAssertion,
  emptyOperatorAuthReplayState,
} from "./auth.js";
import {
  NORTHSTAR_VERSION,
  assertNorthstarContextFresh,
  compileNorthstarContext,
  verifyNorthstarContextPack,
  type PrincipalContext,
} from "./northstar.js";
import { ARCHITECT_ENGINEER_STRAND_VERSION } from "./strand.js";

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

const now = new Date("2026-10-25T03:30:00.000Z");

const publicPrincipal: PrincipalContext = {
  principal: "UNVERIFIED_PUBLIC",
  verification: "PUBLIC_SESSION",
  sessionId: "public-session-1",
  issuedAt: "2026-10-25T03:00:00.000Z",
  expiresAt: "2026-10-25T04:00:00.000Z",
};

const salAssertion = bindOperatorAuthAssertion({
  assertionId: "sal-auth-1",
  principal: "SAL",
  sessionId: "sal-session-1",
  issuerId: "future-auth-service",
  nonceId: "sal-nonce-1",
  issuedAt: "2026-10-25T03:00:00.000Z",
  expiresAt: "2026-10-25T04:00:00.000Z",
  factors: [
    {
      factorId: "sal-knowledge",
      factorClass: "KNOWLEDGE",
      channel: "NORTHSTAR_SECRET",
      verifierId: "secret-verifier",
      verifiedAt: "2026-10-25T02:59:00.000Z",
    },
    {
      factorId: "sal-possession",
      factorClass: "POSSESSION",
      channel: "TOTP",
      verifierId: "totp-verifier",
      verifiedAt: "2026-10-25T02:59:30.000Z",
    },
  ],
});

const salSession = consumeOperatorAuthAssertion(
  salAssertion,
  emptyOperatorAuthReplayState(),
  now,
).session;

const salPrincipal: PrincipalContext = {
  principal: "VERIFIED_SAL",
  verification: "EXTERNAL_AUTH",
  operatorSession: salSession,
};

{
  const pack = compileNorthstarContext({
    roleId: "HT",
    principalContext: publicPrincipal,
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR", "SECRET"],
    now,
  });

  assert(pack.version === NORTHSTAR_VERSION, "Northstar version must be bound");
  assert(pack.authorityCeiling === "ARCHITECTURE_ONLY", "architect authority ceiling must remain architectural");
  assert(pack.allowedKnowledgeClasses.length === 1 && pack.allowedKnowledgeClasses[0] === "PUBLIC", "public principal must receive only public context");
  assert(pack.deniedKnowledgeClasses.includes("INTERNAL"), "internal context must be denied to public principal");
  assert(pack.deniedKnowledgeClasses.includes("PRIVATE_OPERATOR"), "operator context must be denied to public principal");
  assert(pack.deniedKnowledgeClasses.includes("SECRET"), "secret context must always be denied");
  assert(pack.operatorAuthBinding === null, "public context must not claim an operator auth binding");
  assert(verifyNorthstarContextPack(pack), "compiled Northstar context must verify");
}

{
  const pack = compileNorthstarContext({
    roleId: "MT",
    principalContext: salPrincipal,
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR", "SECRET"],
    now,
  });

  assert(pack.authorityCeiling === "PROPOSAL_ONLY", "engineer authority ceiling must remain proposal-only");
  assert(pack.allowedKnowledgeClasses.includes("PRIVATE_OPERATOR"), "verified operator session may receive private operator context");
  assert(!pack.allowedKnowledgeClasses.includes("SECRET"), "secret material must never enter model context");
  assert(pack.deniedKnowledgeClasses.includes("SECRET"), "secret request must remain explicitly denied");
  assert(pack.principal === "VERIFIED_SAL", "verified principal identity must survive into scoped context");
  assert(pack.principalVerification === "EXTERNAL_AUTH", "verified principal must retain external-auth provenance");
  assert(pack.operatorAuthBinding === salSession.sessionBinding, "Northstar must bind the verified operator session");
  assert(pack.operatorAuthTrust === salSession.trust, "Northstar must preserve auth trust calibration");
  assertNorthstarContextFresh(pack, now);

  const tampered = {
    ...pack,
    authorityCeiling: "ARCHITECTURE_ONLY" as const,
  };
  assert(!verifyNorthstarContextPack(tampered), "context mutation must invalidate deterministic binding");
}

{
  const mismatchedPrincipal: PrincipalContext = {
    principal: "VERIFIED_BJORN",
    verification: "EXTERNAL_AUTH",
    operatorSession: salSession,
  };
  throwsWith(
    () => compileNorthstarContext({
      roleId: "HT",
      principalContext: mismatchedPrincipal,
      architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
      requestedKnowledgeClasses: ["PUBLIC"],
      now,
    }),
    "verified_principal_operator_session_mismatch",
    "operator identity claim must match the bound operator session",
  );
}

{
  const forged = {
    ...salSession,
    sessionBinding: "forged-session-binding",
  };
  const forgedPrincipal: PrincipalContext = {
    principal: "VERIFIED_SAL",
    verification: "EXTERNAL_AUTH",
    operatorSession: forged,
  };
  throwsWith(
    () => compileNorthstarContext({
      roleId: "HT",
      principalContext: forgedPrincipal,
      architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
      requestedKnowledgeClasses: ["PUBLIC"],
      now,
    }),
    "verified_principal_operator_session_invalid",
    "Northstar must reject a structurally forged operator session",
  );
}

{
  throwsWith(
    () => compileNorthstarContext({
      roleId: "HT",
      principalContext: publicPrincipal,
      architectureVersion: "stale-architecture-version",
      requestedKnowledgeClasses: ["PUBLIC"],
      now,
    }),
    "northstar_architecture_version_mismatch",
    "Northstar context must fail on architecture-version drift",
  );
}

{
  throwsWith(
    () => compileNorthstarContext({
      roleId: "HT",
      principalContext: publicPrincipal,
      architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
      requestedKnowledgeClasses: ["SECRET"],
      now,
    }),
    "northstar_context_empty",
    "secret-only requests must not produce a model context pack",
  );
}

{
  const pack = compileNorthstarContext({
    roleId: "EI",
    principalContext: salPrincipal,
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC", "INTERNAL"],
    now,
  });

  throwsWith(
    () => assertNorthstarContextFresh(pack, new Date("2026-10-25T04:00:00.000Z")),
    "northstar_context_expired",
    "Northstar context must fail exactly at session expiry",
  );
}

console.log("northstar integrity tests passed");
