import {
  appendAuditEvent,
  currentAuditHead,
  emptyAuditLedger,
  verifyAuditLedgerSnapshot,
  type AuditEvent,
} from "./audit.js";

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

const sourceEvent: AuditEvent = {
  eventId: "audit-source-1",
  eventType: "SOURCE_ATTESTATION_RECORDED",
  occurredAt: "2026-10-25T11:00:00.000Z",
  actorKind: "ADAPTER",
  actorId: "source-verifier-adapter",
  artifactKind: "PROVENANCE_ATTESTATION",
  artifactId: "source-attestation-1",
  artifactBinding: "binding:source-attestation-1",
  outcome: "NONE",
  contextId: "audit-context-1",
  requestId: "request-1",
};

let ledger = emptyAuditLedger();

{
  assert(verifyAuditLedgerSnapshot(ledger), "empty audit ledger must verify");
  assert(currentAuditHead(ledger) === null, "empty audit ledger must have no head");
}

ledger = appendAuditEvent(ledger, {
  event: sourceEvent,
  expectedHeadBinding: null,
});

const sourceHead = currentAuditHead(ledger);
assert(sourceHead !== null, "first audit append must produce a head binding");

{
  assert(ledger.entries.length === 1, "first append must create one entry");
  assert(ledger.entries[0]?.sequence === 1, "first entry sequence must be one");
  assert(verifyAuditLedgerSnapshot(ledger), "single-entry audit ledger must verify");
}

const failedReceiptEvent: AuditEvent = {
  eventId: "audit-receipt-failed",
  eventType: "EXECUTION_RECEIPT_RECORDED",
  occurredAt: "2026-10-25T11:01:00.000Z",
  actorKind: "ADAPTER",
  actorId: "executor-adapter",
  artifactKind: "EXECUTION_RECEIPT",
  artifactId: "receipt-1",
  artifactBinding: "binding:receipt-1",
  outcome: "FAILED",
  contextId: "audit-context-1",
  requestId: "request-1",
  executionId: "execution-1",
};

ledger = appendAuditEvent(ledger, {
  event: failedReceiptEvent,
  expectedHeadBinding: sourceHead,
});

const receiptHead = currentAuditHead(ledger);
assert(receiptHead !== null && receiptHead !== sourceHead, "second append must advance the audit head");

const inconclusiveVerificationEvent: AuditEvent = {
  eventId: "audit-verification-inconclusive",
  eventType: "EXECUTION_VERIFICATION_RECORDED",
  occurredAt: "2026-10-25T11:02:00.000Z",
  actorKind: "SYSTEM",
  actorId: "independent-verifier",
  artifactKind: "EXECUTION_VERIFICATION",
  artifactId: "verification-1",
  artifactBinding: "binding:verification-1",
  outcome: "INCONCLUSIVE",
  contextId: "audit-context-1",
  requestId: "request-1",
  executionId: "execution-1",
};

ledger = appendAuditEvent(ledger, {
  event: inconclusiveVerificationEvent,
  expectedHeadBinding: receiptHead,
});

{
  assert(ledger.entries[1]?.event.outcome === "FAILED", "audit ledger must preserve failed execution outcome");
  assert(
    ledger.entries[2]?.event.outcome === "INCONCLUSIVE",
    "audit ledger must preserve inconclusive verification without rewriting failure truth",
  );
  assert(verifyAuditLedgerSnapshot(ledger), "multi-entry audit ledger must verify");
}

{
  throwsWith(
    () => appendAuditEvent(ledger, {
      event: {
        ...sourceEvent,
        eventId: "audit-stale-head",
        occurredAt: "2026-10-25T11:03:00.000Z",
      },
      expectedHeadBinding: sourceHead,
    }),
    "audit_head_conflict",
    "append must reject stale expected head to model optimistic concurrency",
  );
}

{
  throwsWith(
    () => appendAuditEvent(ledger, {
      event: {
        ...sourceEvent,
        occurredAt: "2026-10-25T11:03:00.000Z",
      },
      expectedHeadBinding: currentAuditHead(ledger),
    }),
    "audit_event_id_already_recorded",
    "audit event IDs must be unique",
  );
}

{
  throwsWith(
    () => appendAuditEvent(ledger, {
      event: {
        ...sourceEvent,
        eventId: "audit-backdated",
        occurredAt: "2026-10-25T10:59:59.000Z",
      },
      expectedHeadBinding: currentAuditHead(ledger),
    }),
    "audit_event_backdated",
    "audit event time must not move backwards",
  );
}

{
  throwsWith(
    () => appendAuditEvent(ledger, {
      event: {
        ...sourceEvent,
        eventId: "audit-kind-mismatch",
        eventType: "EXECUTION_PERMIT_ISSUED",
        artifactKind: "PROVENANCE_ATTESTATION",
        occurredAt: "2026-10-25T11:03:00.000Z",
      },
      expectedHeadBinding: currentAuditHead(ledger),
    }),
    "audit_event_artifact_kind_mismatch",
    "event/artifact taxonomy mismatch must fail closed",
  );
}

{
  const tampered = {
    ...ledger,
    entries: ledger.entries.map((entry, index) =>
      index === 1
        ? {
            ...entry,
            event: { ...entry.event, outcome: "SUCCEEDED" as const },
          }
        : entry,
    ),
  };
  assert(!verifyAuditLedgerSnapshot(tampered), "changing a prior failure into success must invalidate the ledger chain");
}

{
  const tamperedHead = { ...ledger, headBinding: "forged-head" };
  assert(!verifyAuditLedgerSnapshot(tamperedHead), "forged ledger head must fail verification");
}

console.log("audit ledger tests passed");
