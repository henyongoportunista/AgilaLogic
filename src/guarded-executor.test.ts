import { weaveSignals } from "./gagamba.js";
import {
  createInMemoryExecutionAttemptStore,
} from "./execution-attempt.js";
import {
  PRE_EXECUTION_VERSION,
  createResourceStateSnapshot,
  type PreExecutionRequest,
} from "./execution.js";
import { runGuardedExecution } from "./guarded-executor.js";
import {
  createInMemoryLifecycleRegistryStore,
  persistArchitectureState,
  persistEngineeringState,
} from "./replay-store.js";
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
import { htArchitect, mtEngineer } from "./strand.js";
import {
  bindArchitectureLifecycle,
  bindEngineeringLifecycle,
} from "./trust.js";

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

const weave = weaveSignals({
  signals: [
    {
      id: "guarded-fact",
      kind: "FACT",
      text: "Guarded executor fixture is available.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "guarded-fixture",
        observedAt: "2026-10-25T11:00:00.000Z",
      },
    },
  ],
  candidates: [
    {
      id: "guarded-candidate",
      value: 1,
      timing: 1,
      confidence: 1,
      cost: 0,
      risk: 0,
      reversibility: 1,
    },
  ],
});

const architecture = htArchitect({
  packetId: "guarded-architecture",
  objective: "Exercise guarded execution composition.",
  weave,
  successCriteria: ["One pre-execution token invokes at most one guarded attempt."],
  nonGoals: ["No real external side effect."],
  intentEnvelope: {
    allowedActionTypes: ["WRITE"],
    allowedScopes: ["SANDBOX"],
    allowedDataSensitivities: ["INTERNAL"],
    requireReversible: true,
    allowSecrets: false,
  },
});

const boundArchitecture = bindArchitectureLifecycle(
  architecture,
  {
    lifecycleId: "guarded-architecture-life",
    contextId: "guarded-context",
    issuedAt: "2026-10-25T11:00:00.000Z",
    expiresAt: "2026-10-25T12:00:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  },
  new Date("2026-10-25T11:05:00.000Z"),
);

const { engineering } = mtEngineer(
  architecture,
  { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 },
  "guarded-engineering",
);

const boundEngineering = bindEngineeringLifecycle(
  engineering,
  {
    lifecycleId: "guarded-engineering-life",
    contextId: "guarded-context",
    issuedAt: "2026-10-25T11:06:00.000Z",
    expiresAt: "2026-10-25T11:55:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  },
  boundArchitecture,
  new Date("2026-10-25T11:07:00.000Z"),
);

const lifecycleStore = createInMemoryLifecycleRegistryStore();
await persistArchitectureState(lifecycleStore, boundArchitecture);
await persistEngineeringState(lifecycleStore, boundEngineering);

const proposal: ActionProposal = {
  id: "guarded-proposal",
  type: "WRITE",
  scope: "SANDBOX",
  target: "sandbox.guarded",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};

const resourceState = createResourceStateSnapshot({
  adapterId: "adapter-guarded",
  target: proposal.target,
  stateToken: "etag-guarded-v1",
  observedAt: "2026-10-25T11:08:00.000Z",
  expiresAt: "2026-10-25T11:40:00.000Z",
});

function preExecutionRequest(id: string, preparedAt: string): PreExecutionRequest {
  const payload: Omit<PreExecutionRequest, "binding"> = {
    version: PRE_EXECUTION_VERSION,
    trust: "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED",
    proposal: { ...proposal, id },
    proposalBinding: proposalBinding({ ...proposal, id }),
    architectureTrustBinding: boundArchitecture.trustBinding,
    engineeringTrustBinding: boundEngineering.trustBinding,
    sabRoute: "ALLOW_WITH_LOG",
    policyVersion: SAB_POLICY_VERSION,
    principal: "UNVERIFIED_PUBLIC",
    sessionId: `session-${id}`,
    northstarContextBinding: `northstar-${id}`,
    adapterId: resourceState.adapterId,
    expectedResourceStateBinding: resourceState.binding,
    expectedResourceStateToken: resourceState.stateToken,
    preparedAt,
    expiresAt: "2026-10-25T11:35:00.000Z",
  };
  return { ...payload, binding: canonicalString(payload) };
}

const executorVerifier: RuntimeIdentityVerifier = {
  providerId: "guarded-runtime-provider",
  async verify(evidence) {
    return {
      verified: true,
      providerId: "guarded-runtime-provider",
      actorKind: "EXECUTOR",
      actorId: "executor-guarded",
      sessionId: evidence.sessionHandle,
      subjectRef: "fixture-runtime://executor/guarded",
      assurance: "SIGNED_ASSERTION",
      authenticatedAt: "2026-10-25T11:00:00.000Z",
      expiresAt: "2026-10-25T11:50:00.000Z",
      revoked: false,
    };
  },
};

const executorIdentity = await resolveRuntimeIdentity(
  {
    version: RUNTIME_IDENTITY_VERSION,
    providerId: "guarded-runtime-provider",
    actorKind: "EXECUTOR",
    sessionHandle: "guarded-executor-session",
    verificationRef: "opaque://guarded/executor-session",
  },
  executorVerifier,
  new Date("2026-10-25T11:09:00.000Z"),
);

const request = preExecutionRequest("guarded-proposal-1", "2026-10-25T11:09:00.000Z");
const attemptStore = createInMemoryExecutionAttemptStore();
let calls = 0;

const first = await runGuardedExecution({
  request,
  lifecycleStore,
  architectureState: boundArchitecture,
  engineeringState: boundEngineering,
  currentResourceState: resourceState,
  executorIdentity,
  attemptStore,
  attemptId: "guarded-attempt-1",
  startedAt: "2026-10-25T11:10:00.000Z",
  executor: {
    async execute(invocation) {
      calls += 1;
      assert(invocation.attemptId === "guarded-attempt-1", "executor must receive reserved attempt ID");
      assert(invocation.executorId === "executor-guarded", "executor ID must come from resolved identity");
      assert(invocation.expectedResourceStateToken === "etag-guarded-v1", "executor must receive exact state token");
      return {
        outcome: "SUCCEEDED",
        completedAt: "2026-10-25T11:10:01.000Z",
        resultRef: "fixture://guarded/result/1",
      };
    },
  },
});

assert(calls === 1, "first guarded attempt must call executor exactly once");
assert(first.receipt.receipt.executorId === "executor-guarded", "receipt must preserve verifier-resolved executor ID");
assert(first.receipt.receipt.outcome === "SUCCEEDED", "successful callback must preserve success outcome");

await rejectsWith(
  () => runGuardedExecution({
    request,
    lifecycleStore,
    architectureState: boundArchitecture,
    engineeringState: boundEngineering,
    currentResourceState: resourceState,
    executorIdentity,
    attemptStore,
    attemptId: "guarded-attempt-2",
    startedAt: "2026-10-25T11:11:00.000Z",
    executor: {
      async execute() {
        calls += 1;
        return { outcome: "SUCCEEDED", completedAt: "2026-10-25T11:11:01.000Z" };
      },
    },
  }),
  "execution_attempt_already_reserved",
  "same pre-execution token must be blocked before a second side effect",
);
assert(calls === 1, "duplicate guarded attempt must not call executor again");

const unknownRequest = preExecutionRequest("guarded-proposal-2", "2026-10-25T11:12:00.000Z");
const unknown = await runGuardedExecution({
  request: unknownRequest,
  lifecycleStore,
  architectureState: boundArchitecture,
  engineeringState: boundEngineering,
  currentResourceState: resourceState,
  executorIdentity,
  attemptStore,
  attemptId: "guarded-attempt-unknown",
  startedAt: "2026-10-25T11:13:00.000Z",
  executor: {
    async execute() {
      throw new Error("ambiguous provider disconnect");
    },
  },
});
assert(unknown.receipt.receipt.outcome === "UNKNOWN", "thrown executor ambiguity must not be rewritten as FAILED");
assert(unknown.receipt.receipt.errorCode === "EXECUTOR_CALLBACK_THROWN", "unknown callback outcome must carry bounded error code");

console.log("guarded executor composition tests passed");
