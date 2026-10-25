import {
  createExecutionAttemptClaim,
  createInMemoryExecutionAttemptStore,
  finalizeExecutionAttempt,
  reserveExecutionAttempt,
} from "./execution-attempt.js";
import {
  recordIdentityBoundExecutionReceipt,
  verifyIdentityBoundReceiptAgainstLiveExecutor,
} from "./execution-evidence.js";
import {
  PRE_EXECUTION_VERSION,
  createResourceStateSnapshot,
  verifyPreExecutionRequest,
  type PreExecutionRequest,
} from "./execution.js";
import {
  RUNTIME_IDENTITY_VERSION,
  resolveRuntimeIdentity,
  type RuntimeIdentityVerifier,
} from "./runtime-identity.js";
import {
  SAB_POLICY_VERSION,
  proposalBinding,
  type ActionProposal,
} from "./sab.js";

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

const proposal: ActionProposal = {
  id: "attempt-proposal-1",
  type: "WRITE",
  scope: "SANDBOX",
  target: "sandbox.execution-attempt",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};

const state = createResourceStateSnapshot({
  adapterId: "adapter-a",
  target: proposal.target,
  stateToken: "etag-attempt-v1",
  observedAt: "2026-10-25T10:00:00.000Z",
  expiresAt: "2026-10-25T10:20:00.000Z",
});

const preExecutionPayload: Omit<PreExecutionRequest, "binding"> = {
  version: PRE_EXECUTION_VERSION,
  trust: "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED",
  proposal,
  proposalBinding: proposalBinding(proposal),
  architectureTrustBinding: "architecture-trust-binding-1",
  engineeringTrustBinding: "engineering-trust-binding-1",
  sabRoute: "ALLOW_WITH_LOG",
  policyVersion: SAB_POLICY_VERSION,
  principal: "UNVERIFIED_PUBLIC",
  sessionId: "public-session-attempt-1",
  northstarContextBinding: "northstar-context-binding-1",
  adapterId: "adapter-a",
  expectedResourceStateBinding: state.binding,
  expectedResourceStateToken: state.stateToken,
  preparedAt: "2026-10-25T10:01:00.000Z",
  expiresAt: "2026-10-25T10:15:00.000Z",
};
const request: PreExecutionRequest = {
  ...preExecutionPayload,
  binding: canonicalString(preExecutionPayload),
};
assert(verifyPreExecutionRequest(request), "independent pre-execution fixture must verify");

const executorVerifier: RuntimeIdentityVerifier = {
  providerId: "attempt-runtime-provider",
  async verify(evidence) {
    return {
      verified: true,
      providerId: "attempt-runtime-provider",
      actorKind: "EXECUTOR",
      actorId: "executor-a",
      sessionId: evidence.sessionHandle,
      subjectRef: "fixture-runtime://executor/executor-a",
      assurance: "SIGNED_ASSERTION",
      authenticatedAt: "2026-10-25T09:55:00.000Z",
      expiresAt: "2026-10-25T10:30:00.000Z",
      revoked: false,
    };
  },
};

const executorIdentity = await resolveRuntimeIdentity(
  {
    version: RUNTIME_IDENTITY_VERSION,
    providerId: "attempt-runtime-provider",
    actorKind: "EXECUTOR",
    sessionHandle: "executor-attempt-session-1",
    verificationRef: "opaque://attempt/executor-session-1",
  },
  executorVerifier,
  new Date("2026-10-25T10:02:00.000Z"),
);

const claim = createExecutionAttemptClaim(
  request,
  executorIdentity,
  "attempt-1",
  "2026-10-25T10:02:00.000Z",
);
const store = createInMemoryExecutionAttemptStore();
await reserveExecutionAttempt(store, claim);

await rejectsWith(
  () => reserveExecutionAttempt(store, claim),
  "execution_attempt_already_reserved",
  "second worker must fail before a duplicate side effect",
);

const reserved = await store.loadByPreExecutionBinding(request.binding);
assert(reserved?.status === "RESERVED", "crash-before-receipt must leave explicit RESERVED state");
assert(reserved?.receipt === undefined, "reserved attempt must not fabricate a receipt");

const receipt = recordIdentityBoundExecutionReceipt(
  request,
  state,
  executorIdentity,
  {
    receiptId: "attempt-receipt-1",
    outcome: "SUCCEEDED",
    startedAt: "2026-10-25T10:03:00.000Z",
    completedAt: "2026-10-25T10:03:01.000Z",
    resultRef: "fixture://attempt/result/1",
  },
);
assert(
  verifyIdentityBoundReceiptAgainstLiveExecutor(receipt, executorIdentity),
  "receipt must bind the exact live resolved executor identity",
);

await finalizeExecutionAttempt(store, claim, receipt);
const finalized = await store.loadByPreExecutionBinding(request.binding);
assert(finalized?.status === "FINALIZED", "exact reserved attempt must finalize once");
assert(finalized?.receipt?.receipt.receiptId === "attempt-receipt-1", "finalized state must retain exact receipt");

await rejectsWith(
  () => finalizeExecutionAttempt(store, claim, receipt),
  "execution_attempt_finalize_conflict",
  "finalized attempt must not finalize twice",
);

console.log("execution attempt reservation and recovery tests passed");
