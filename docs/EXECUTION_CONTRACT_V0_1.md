# Execution Permit + Receipt v0.1

Status: **experimental handoff contract between SAB admission and a future executor/n8n adapter**

This layer does not execute tools. It defines what must be carried across the boundary when execution is eventually connected.

## Why this exists

A structurally admitted proposal should not remain executable forever, and an executor should not be allowed to return a bare `success: true` detached from the exact operation that was admitted.

v0.1 adds:

```text
Trust Admission
    |
    v
bound + time-limited SAB-admissible candidate
    |
    v
current SAB policy authorization
    |
    v
short-lived ExecutionPermit
    |
    v
future executor / n8n
    |
    v
ExecutionReceipt
```

## Admission handoff hardening

`SabAdmissibleCandidate` now carries:

- `admittedAt`
- `validUntil`
- deterministic `admissionBinding`

`validUntil` is the earliest expiry among the currently composed dependencies:

- Architecture lifecycle
- Engineering lifecycle
- Northstar context
- operation AdapterAttestation
- accepted FACT provenance attestations

A candidate cannot be converted to an execution permit after that window closes.

This reduces stale handoff risk but does not eliminate resource-level TOCTOU. A target can still change after attestation unless the real adapter later supplies a resource version / ETag / reservation token.

## Execution permit

`issueExecutionPermit()`:

1. verifies the SAB-admissible candidate binding;
2. checks candidate freshness;
3. recomputes current SAB policy;
4. calls the existing execution-authorization rule;
5. issues a maximum two-minute permit, further bounded by the admission expiry.

The permit binds:

- admission binding
- exact proposal + proposal binding
- current SAB route
- current policy version
- approval snapshot binding when approval is required
- issue / expiry window

Trust label:

```text
SAB_POLICY_PERMIT_STRUCTURAL_UNAUTHENTICATED_APPROVER_IF_REQUIRED
```

The label is calibrated because the current `ApprovalRecord.approvedBy` identity is not yet cryptographically authenticated.

## Execution receipt

`bindExecutionReceipt()` records what a future executor reports happened.

The receipt binds:

- permit binding
- admission binding
- exact proposal binding
- execution ID
- executor ID
- start / completion timestamps
- outcome: `SUCCEEDED | FAILED | PARTIAL | UNKNOWN`
- optional opaque evidence reference
- optional error code

An executor cannot report a different proposal under the same permit. Execution must start before permit expiry.

Trust label:

```text
EXECUTION_REPORTED_UNAUTHENTICATED_EXECUTOR
```

That wording is intentional: a receipt is a report from the executor, not independent proof that the reported outcome is true.

## Failure truth

The architecture does not convert `FAILED`, `PARTIAL`, or `UNKNOWN` into success. Later verification/recalibration layers must preserve the executor-reported outcome and compare it against independent evidence when available.

## Explicit non-claims

v0.1 does not claim:

- a real executor is connected;
- n8n is connected;
- authenticated executor identity;
- authenticated human approval identity;
- resource reservation / ETag locking;
- independent verification of receipt outcome;
- durable replay prevention for permits/receipts;
- atomic execution;
- TOCTOU elimination;
- production readiness.

## ROEM calibration

### Refinement

Do not hand an unbound, indefinitely reusable admitted proposal to a future executor.

### Opportunity

Create a narrow contract that n8n or another adapter can implement later without moving authorization logic into the workflow engine.

### Enhancement

Add admission binding + minimum validity, short-lived policy permit, exact-operation receipt, and explicit outcome semantics.

### Mitigation

Keep executor/approver trust explicitly unauthenticated and retain resource-level TOCTOU as a separate future hardening target.

### Evidence / recalibration

Tests cover:

- earliest-dependency admission expiry;
- bounded sandbox permit;
- receipt/permit exact match;
- receipt tampering;
- executor operation mismatch;
- execution start after permit expiry;
- production write requiring approval;
- candidate mutation after admission;
- expired admission candidate.

## Design law

> **Admission is not execution. Authorization is not proof of execution. A receipt is not proof of success. Each transition must remain bound to the exact operation, current policy, time window, and reported outcome.**
