import {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createTestAuthVerifierRegistry,
  resolveVerifiedPrincipalContext,
} from "./external-auth.js";
import {
  MAX_CONSENT_CHALLENGES,
  MAX_HUMAN_CONSENT_TTL_MS,
  createTestHumanConsentAuthority,
  type HumanConsentEvidence,
  type HumanConsentTransaction,
} from "./human-consent.js";
import { compileNorthstarContext } from "./northstar.js";
import { SAB_POLICY_VERSION, type ActionProposal } from "./sab.js";
import { ARCHITECT_ENGINEER_STRAND_VERSION } from "./strand.js";
import { createSupabaseLifecycleRegistryStore } from "./supabase-replay-store.js";

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
const sessionId = "pr10-closeout-session";
const authRegistry = createTestAuthVerifierRegistry({
  providerId: "pr10-closeout-auth",
  async verify() {
    return {
      verified: true as const,
      providerId: "pr10-closeout-auth",
      principal: "VERIFIED_SAL" as const,
      sessionId,
      subjectRef: "fixture://pr10-closeout-sal",
      assurance: "MFA" as const,
      authenticatedAt: "2026-10-25T09:55:00.000Z",
      expiresAt: "2026-10-25T10:30:00.000Z",
      revoked: false,
    };
  },
});
const resolved = await resolveVerifiedPrincipalContext({
  version: EXTERNAL_AUTH_BOUNDARY_VERSION,
  providerId: "pr10-closeout-auth",
  sessionHandle: sessionId,
  verificationRef: "fixture-auth-ref",
}, authRegistry, now, "test");
const northstar = compileNorthstarContext({
  roleId: "MT",
  principalContext: resolved.principalContext,
  architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
  requestedKnowledgeClasses: ["PUBLIC", "INTERNAL"],
  now,
});

const proposal: ActionProposal = {
  id: "pr10-closeout-proposal",
  type: "WRITE",
  scope: "PRODUCTION",
  target: "internal://pr10-closeout",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};
const transaction: HumanConsentTransaction = {
  proposal,
  operationBinding: "pr10-closeout-operation-binding",
  policyVersion: SAB_POLICY_VERSION,
};

// RT-1: active replay evidence is bounded, but expiry must recover capacity.
const authority = createTestHumanConsentAuthority({
  providerId: "pr10-closeout-consent",
  async verify(evidence, challenge) {
    return {
      decision: "APPROVED" as const,
      challengeId: evidence.challengeId,
      principal: challenge.principal,
      sessionId: challenge.sessionId,
    };
  },
}, () => true);
const challenges = Array.from({ length: MAX_CONSENT_CHALLENGES }, () =>
  authority.issueChallenge(transaction, northstar, now));
throwsWith(
  () => authority.issueChallenge(transaction, northstar, now),
  "human_consent_registry_capacity_exceeded",
);
const afterExpiry = new Date(now.getTime() + MAX_HUMAN_CONSENT_TTL_MS);
const replacement = authority.issueChallenge(transaction, northstar, afterExpiry);
assert(replacement.issuedAt === afterExpiry.toISOString(), "Expired challenge capacity must be reclaimable");
const staleEvidence: HumanConsentEvidence = {
  providerId: "pr10-closeout-consent",
  challengeId: challenges[0].challengeId,
  verificationRef: "stale-fixture-response",
};
await rejectsWith(
  () => authority.resolveConsent(challenges[0].challengeId, staleEvidence, northstar, afterExpiry),
  "human_consent_challenge_unknown",
);

// RT-2: real/native transport must be HTTPS and independently origin-pinned.
throwsWith(
  () => createSupabaseLifecycleRegistryStore({
    url: "http://project.supabase.co",
    expectedOrigin: "https://project.supabase.co",
    serviceRoleKey: "fixture-service-role-key",
  }),
  "supabase_https_required",
);
throwsWith(
  () => createSupabaseLifecycleRegistryStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "fixture-service-role-key",
  }),
  "supabase_expected_origin_required",
);
throwsWith(
  () => createSupabaseLifecycleRegistryStore({
    url: "https://attacker.example",
    expectedOrigin: "https://project.supabase.co",
    serviceRoleKey: "fixture-service-role-key",
  }),
  "supabase_origin_mismatch",
);
throwsWith(
  () => createSupabaseLifecycleRegistryStore({
    url: "https://project.supabase.co/rest/v1",
    expectedOrigin: "https://project.supabase.co",
    serviceRoleKey: "fixture-service-role-key",
  }),
  "supabase_url_must_be_origin",
);
const pinned = createSupabaseLifecycleRegistryStore({
  url: "https://project.supabase.co/",
  expectedOrigin: "https://project.supabase.co",
  serviceRoleKey: "fixture-service-role-key",
});
assert(pinned.storageClass === "EXTERNAL_STORE", "Exact pinned HTTPS origin must initialize");

console.log("PR #10 RT-1 consent reclamation and RT-2 Supabase origin pinning tests passed");
