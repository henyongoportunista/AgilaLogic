import {
  createExecutionAttemptClaim,
  finalizeExecutionAttempt,
  reserveExecutionAttempt,
  type ExecutionAttemptClaim,
  type ExecutionAttemptStore,
} from "./execution-attempt.js";
import {
  recordIdentityBoundExecutionReceipt,
  type IdentityBoundExecutionReceipt,
} from "./execution-evidence.js";
import {
  assertExecutionPreconditionsUnchanged,
  type PreExecutionRequest,
  type ResourceStateSnapshot,
} from "./execution.js";
import type { LifecycleRegistryStore } from "./replay-store.js";
import {
  assertResolvedRuntimeIdentityFresh,
  type ResolvedRuntimeIdentity,
} from "./runtime-identity.js";
import type { BoundArchitectureState, BoundEngineeringState } from "./trust.js";

export const GUARDED_EXECUTOR_VERSION = "2026-10-25.1" as const;

export interface GuardedExecutorInvocation {
  attemptId: string;
  proposalId: string;
  target: string;
  executorId: string;
  expectedResourceStateToken: string;
}

export interface GuardedExecutorResult {
  outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN";
  completedAt: string;
  resultRef?: string;
  errorCode?: string;
}

/**
 * Future adapters implement this callback. The trust architecture does not infer
 * whether the callback is safe merely because it satisfies this TypeScript shape.
 */
export interface GuardedExecutorAdapter {
  execute(invocation: GuardedExecutorInvocation): Promise<GuardedExecutorResult>;
}

export interface RunGuardedExecutionInput {
  request: PreExecutionRequest;
  lifecycleStore: LifecycleRegistryStore;
  architectureState: BoundArchitectureState;
  engineeringState: BoundEngineeringState;
  currentResourceState: ResourceStateSnapshot;
  executorIdentity: ResolvedRuntimeIdentity;
  attemptStore: ExecutionAttemptStore;
  attemptId: string;
  startedAt: string;
  executor: GuardedExecutorAdapter;
}

export interface GuardedExecutionResult {
  version: typeof GUARDED_EXECUTOR_VERSION;
  claim: ExecutionAttemptClaim;
  receipt: IdentityBoundExecutionReceipt;
}

function parseIsoInstant(value: string, label: string): Date {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label}_invalid_iso_instant`);
  }
  return parsed;
}

/**
 * Safe-default composition for a future side-effect adapter.
 *
 * Sequence:
 * 1) validate fresh resolved executor identity
 * 2) verify persisted lifecycle + resource preconditions
 * 3) atomically reserve the exact pre-execution token
 * 4) recheck lifecycle + resource preconditions after reservation
 * 5) invoke exactly one executor callback
 * 6) convert thrown/ambiguous callback failure to UNKNOWN evidence
 * 7) create identity-bound receipt
 * 8) finalize the exact reserved attempt
 *
 * If the process dies after reservation but before finalization, the reservation
 * remains and blocks blind duplicate execution. Recovery must reconcile it.
 * This still cannot manufacture exact-once semantics in an external provider that
 * lacks its own idempotency/precondition support.
 */
export async function runGuardedExecution(
  input: RunGuardedExecutionInput,
): Promise<GuardedExecutionResult> {
  const startedAt = parseIsoInstant(input.startedAt, "guarded_execution_started_at");
  assertResolvedRuntimeIdentityFresh(input.executorIdentity, "EXECUTOR", startedAt);

  await assertExecutionPreconditionsUnchanged({
    request: input.request,
    lifecycleStore: input.lifecycleStore,
    architectureState: input.architectureState,
    engineeringState: input.engineeringState,
    currentResourceState: input.currentResourceState,
    now: startedAt,
  });

  const claim = createExecutionAttemptClaim(
    input.request,
    input.executorIdentity,
    input.attemptId,
    startedAt.toISOString(),
  );
  await reserveExecutionAttempt(input.attemptStore, claim);

  // Recheck after the atomic claim, immediately before the future side effect.
  await assertExecutionPreconditionsUnchanged({
    request: input.request,
    lifecycleStore: input.lifecycleStore,
    architectureState: input.architectureState,
    engineeringState: input.engineeringState,
    currentResourceState: input.currentResourceState,
    now: startedAt,
  });

  let result: GuardedExecutorResult;
  try {
    result = await input.executor.execute({
      attemptId: claim.attemptId,
      proposalId: input.request.proposal.id,
      target: input.request.proposal.target,
      executorId: input.executorIdentity.actorId,
      expectedResourceStateToken: input.request.expectedResourceStateToken,
    });
  } catch {
    result = {
      outcome: "UNKNOWN",
      completedAt: new Date(Math.max(Date.now(), startedAt.getTime())).toISOString(),
      errorCode: "EXECUTOR_CALLBACK_THROWN",
    };
  }

  const completedAt = parseIsoInstant(result.completedAt, "guarded_execution_completed_at");
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new Error("guarded_execution_negative_duration");
  }

  const receipt = recordIdentityBoundExecutionReceipt(
    input.request,
    input.currentResourceState,
    input.executorIdentity,
    {
      receiptId: `${claim.attemptId}:receipt`,
      outcome: result.outcome,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      ...(result.resultRef === undefined ? {} : { resultRef: result.resultRef }),
      ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    },
  );

  await finalizeExecutionAttempt(input.attemptStore, claim, receipt);

  return {
    version: GUARDED_EXECUTOR_VERSION,
    claim,
    receipt,
  };
}
