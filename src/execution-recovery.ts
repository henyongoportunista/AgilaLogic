import type {
  ExecutionAttemptRecord,
  ExecutionAttemptStore,
} from "./execution-attempt.js";
import { verifyIdentityBoundExecutionReceipt } from "./execution-evidence.js";

export const EXECUTION_RECOVERY_VERSION = "2026-10-25.1" as const;

export type ExecutionRecoveryState =
  | "NOT_STARTED"
  | "REQUIRE_RECONCILIATION"
  | "FINALIZED";

export interface ExecutionRecoveryAssessment {
  version: typeof EXECUTION_RECOVERY_VERSION;
  state: ExecutionRecoveryState;
  autoRetryAllowed: false;
  record: ExecutionAttemptRecord | null;
  reason:
    | "no_attempt_record"
    | "reserved_outcome_ambiguous"
    | "finalized_receipt_present";
}

/**
 * Conservative recovery classifier.
 *
 * It intentionally never returns autoRetryAllowed=true. Even NOT_STARTED must
 * re-enter the normal fresh pre-execution path; RESERVED requires reconciliation
 * because a side effect may already have happened; FINALIZED is terminal evidence.
 */
export async function assessExecutionRecovery(
  store: ExecutionAttemptStore,
  preExecutionBinding: string,
): Promise<ExecutionRecoveryAssessment> {
  const record = await store.loadByPreExecutionBinding(preExecutionBinding);

  if (!record) {
    return {
      version: EXECUTION_RECOVERY_VERSION,
      state: "NOT_STARTED",
      autoRetryAllowed: false,
      record: null,
      reason: "no_attempt_record",
    };
  }

  if (record.status === "RESERVED") {
    return {
      version: EXECUTION_RECOVERY_VERSION,
      state: "REQUIRE_RECONCILIATION",
      autoRetryAllowed: false,
      record,
      reason: "reserved_outcome_ambiguous",
    };
  }

  if (!record.receipt || !verifyIdentityBoundExecutionReceipt(record.receipt)) {
    throw new Error("finalized_execution_attempt_missing_valid_receipt");
  }

  return {
    version: EXECUTION_RECOVERY_VERSION,
    state: "FINALIZED",
    autoRetryAllowed: false,
    record,
    reason: "finalized_receipt_present",
  };
}
