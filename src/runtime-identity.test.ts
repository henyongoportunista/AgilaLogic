import {
  RUNTIME_IDENTITY_VERSION,
  assertResolvedRuntimeIdentityFresh,
  bindAdapterAttestationToIdentity,
  isResolvedRuntimeIdentity,
  isVerifiedAdapterAttestation,
  resolveRuntimeIdentity,
  type RuntimeIdentityVerifier,
} from "./runtime-identity.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { TRUST_SPINE_VERSION, type AdapterAttestation } from "./trust.js";

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

const now = new Date("2026-10-25T10:00:00.000Z");

function verifier(kind: "ADAPTER" | "EXECUTOR", actorId: string): RuntimeIdentityVerifier {
  return {
    providerId: "fixture-runtime-provider",
    async verify(evidence) {
      assert(!(evidence as unknown as Record<string, unknown>).actorId, "caller must not send actorId in evidence");
      return {
        verified: true,
        providerId: "fixture-runtime-provider",
        actorKind: kind,
        actorId,
        sessionId: evidence.sessionHandle,
        subjectRef: `fixture-runtime://${kind.toLowerCase()}/${actorId}`,
        assurance: "SIGNED_ASSERTION",
        authenticatedAt: "2026-10-25T09:45:00.000Z",
        expiresAt: "2026-10-25T10:30:00.000Z",
        revoked: false,
      };
    },
  };
}

const adapterIdentity = await resolveRuntimeIdentity(
  {
    version: RUNTIME_IDENTITY_VERSION,
    providerId: "fixture-runtime-provider",
    actorKind: "ADAPTER",
    sessionHandle: "adapter-runtime-session",
    verificationRef: "opaque://adapter/runtime/session",
  },
  verifier("ADAPTER", "adapter-a"),
  now,
);
assert(adapterIdentity.actorId === "adapter-a", "adapter ID must come from verifier result");
assert(isResolvedRuntimeIdentity(adapterIdentity), "resolved adapter identity must carry runtime stamp and binding");
assertResolvedRuntimeIdentityFresh(adapterIdentity, "ADAPTER", now);

const copiedIdentity = { ...adapterIdentity };
assert(!isResolvedRuntimeIdentity(copiedIdentity), "copied runtime identity must lose process-local verification stamp");

const rawAttestation: AdapterAttestation = {
  version: TRUST_SPINE_VERSION,
  attestationId: "runtime-attestation-1",
  requestId: "request-1",
  proposalId: "proposal-1",
  engineeringBinding: "engineering-binding-1",
  policyVersion: SAB_POLICY_VERSION,
  adapterId: "adapter-a",
  observedAt: "2026-10-25T09:55:00.000Z",
  expiresAt: "2026-10-25T10:20:00.000Z",
  operation: {
    type: "WRITE",
    scope: "SANDBOX",
    target: "sandbox.runtime",
    reversible: true,
    dataSensitivity: "INTERNAL",
    affectedRecords: 1,
    estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" },
    containsSecrets: false,
  },
};

const verifiedAttestation = bindAdapterAttestationToIdentity(rawAttestation, adapterIdentity, now);
assert(verifiedAttestation.adapterId === "adapter-a", "verified wrapper must expose resolved adapter ID");
assert(isVerifiedAdapterAttestation(verifiedAttestation), "verified wrapper must carry process-local stamp and deterministic binding");
assert(!isVerifiedAdapterAttestation({ ...verifiedAttestation }), "copied wrapper must lose verification stamp");

{
  let mismatch = false;
  try {
    bindAdapterAttestationToIdentity(
      { ...rawAttestation, adapterId: "attacker-adapter" },
      adapterIdentity,
      now,
    );
  } catch (error) {
    mismatch = error instanceof Error && error.message === "adapter_identity_attestation_mismatch";
  }
  assert(mismatch, "attestation adapter ID must equal verifier-resolved actor ID");
}

const executorIdentity = await resolveRuntimeIdentity(
  {
    version: RUNTIME_IDENTITY_VERSION,
    providerId: "fixture-runtime-provider",
    actorKind: "EXECUTOR",
    sessionHandle: "executor-runtime-session",
    verificationRef: "opaque://executor/runtime/session",
  },
  verifier("EXECUTOR", "executor-a"),
  now,
);
assert(executorIdentity.actorId === "executor-a", "executor ID must come from verifier result");
assertResolvedRuntimeIdentityFresh(executorIdentity, "EXECUTOR", now);

await rejectsWith(
  () => resolveRuntimeIdentity(
    {
      version: RUNTIME_IDENTITY_VERSION,
      providerId: "attacker-provider",
      actorKind: "EXECUTOR",
      sessionHandle: "executor-runtime-session",
      verificationRef: "opaque://executor/runtime/session",
    },
    verifier("EXECUTOR", "executor-a"),
    now,
  ),
  "runtime_identity_provider_mismatch",
  "provider mismatch must fail before verifier result can create identity",
);

await rejectsWith(
  () => resolveRuntimeIdentity(
    {
      version: RUNTIME_IDENTITY_VERSION,
      providerId: "fixture-runtime-provider",
      actorKind: "ADAPTER",
      sessionHandle: "adapter-runtime-session",
      verificationRef: "opaque://adapter/runtime/session",
      secret: "do-not-forward",
    } as never,
    verifier("ADAPTER", "adapter-a"),
    now,
  ),
  "unexpected_runtime_identity_evidence_field",
  "extra credential-like evidence fields must fail closed",
);

console.log("runtime identity boundary tests passed");
