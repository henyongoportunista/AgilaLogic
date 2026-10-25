import {
  recordExecutionReceipt,
  verifyExecutionReceipt,
  type ExecutionReceipt,
  type PreExecutionRequest,
  type RecordExecutionReceiptInput,
  type ResourceStateSnapshot,
} from "./execution.js";
import {
  assertResolvedRuntimeIdentityFresh,
  isResolvedRuntimeIdentity,
  type ResolvedRuntimeIdentity,
  type RuntimeIdentityAssurance,
} from "./runtime-identity.js";

export const EXECUTION_EVIDENCE_VERSION = "2026-10-25.1" as const;

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

export interface IdentityBoundExecutionReceipt {
  version: typeof EXECUTION_EVIDENCE_VERSION;
  trust: "EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT";
  receipt: ExecutionReceipt;
  executorIdentityBinding: string;
  executorIdentityProviderId: string;
  executorIdentityAssurance: RuntimeIdentityAssurance;
  executorIdentitySubjectRef: string;
  binding: string;
}

export type IdentityBoundReceiptInput = Omit<RecordExecutionReceiptInput, "executorId">;

function identityBoundReceiptBinding(
  value: Omit<IdentityBoundExecutionReceipt, "binding">,
): string {
  return canonicalString(value);
}

/**
 * Safe high-level receipt constructor. The executor ID is not caller supplied;
 * it comes from a fresh process-resolved EXECUTOR identity.
 *
 * The resulting artifact remains explicitly unauthenticated after serialization:
 * its deterministic binding detects mutation but does not preserve proof that the
 * external verifier actually ran unless production persistence/signing provides it.
 */
export function recordIdentityBoundExecutionReceipt(
  request: PreExecutionRequest,
  currentState: ResourceStateSnapshot,
  executorIdentity: ResolvedRuntimeIdentity,
  input: IdentityBoundReceiptInput,
): IdentityBoundExecutionReceipt {
  const startedAt = new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime()) || startedAt.toISOString() !== input.startedAt) {
    throw new TypeError("execution_started_at_invalid_iso_instant");
  }
  assertResolvedRuntimeIdentityFresh(executorIdentity, "EXECUTOR", startedAt);

  const receipt = recordExecutionReceipt(request, currentState, {
    ...input,
    executorId: executorIdentity.actorId,
  });

  const payload: Omit<IdentityBoundExecutionReceipt, "binding"> = {
    version: EXECUTION_EVIDENCE_VERSION,
    trust: "EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT",
    receipt,
    executorIdentityBinding: executorIdentity.binding,
    executorIdentityProviderId: executorIdentity.providerId,
    executorIdentityAssurance: executorIdentity.assurance,
    executorIdentitySubjectRef: executorIdentity.subjectRef,
  };

  return { ...payload, binding: identityBoundReceiptBinding(payload) };
}

export function verifyIdentityBoundExecutionReceipt(
  value: IdentityBoundExecutionReceipt,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (value.version !== EXECUTION_EVIDENCE_VERSION) return false;
  if (value.trust !== "EXECUTOR_IDENTITY_BOUND_UNAUTHENTICATED_RECEIPT") return false;
  if (!verifyExecutionReceipt(value.receipt)) return false;
  if (typeof value.executorIdentityBinding !== "string" || value.executorIdentityBinding.length === 0) return false;
  if (typeof value.executorIdentityProviderId !== "string" || value.executorIdentityProviderId.length === 0) return false;
  if (typeof value.executorIdentitySubjectRef !== "string" || value.executorIdentitySubjectRef.length === 0) return false;
  if (
    value.executorIdentityAssurance !== "AUTHENTICATED_CHANNEL" &&
    value.executorIdentityAssurance !== "SIGNED_ASSERTION" &&
    value.executorIdentityAssurance !== "HARDWARE_ATTESTED"
  ) return false;

  const { binding, ...payload } = value;
  return binding === identityBoundReceiptBinding(payload);
}

/**
 * Runtime-only check for callers that still hold the exact resolved identity
 * object used to create the receipt. This cannot be reconstructed from serialized
 * receipt data alone and therefore must not be confused with durable identity proof.
 */
export function verifyIdentityBoundReceiptAgainstLiveExecutor(
  value: IdentityBoundExecutionReceipt,
  identity: ResolvedRuntimeIdentity,
): boolean {
  if (!verifyIdentityBoundExecutionReceipt(value)) return false;
  if (!isResolvedRuntimeIdentity(identity)) return false;
  return (
    identity.actorKind === "EXECUTOR" &&
    identity.actorId === value.receipt.executorId &&
    identity.binding === value.executorIdentityBinding &&
    identity.providerId === value.executorIdentityProviderId &&
    identity.assurance === value.executorIdentityAssurance &&
    identity.subjectRef === value.executorIdentitySubjectRef
  );
}
