# Execution Replay Ledger v0.1

Status: **experimental replay/idempotency state contract**

ExecutionPermit already binds one execution ID, but that alone does not prevent a caller from submitting the same permit again after a worker restart or across concurrent workers.

This layer introduces an explicit execution-state ledger that must reserve an execution before work starts and preserve the state transition through completion and verification.

## Flow

```text
ExecutionPermit
      |
      v
RESERVE executionId + permitBinding
      |
      v
STARTED
      |
      v
ExecutionReceipt
      |
      v
COMPLETED
      |
      +--> independent verification refs
```

## States

- `RESERVED` — the exact execution ID / permit pair has been claimed but execution has not started.
- `STARTED` — execution began before permit expiry.
- `COMPLETED` — a structurally valid receipt for the exact permit has been recorded.

A completed execution can preserve multiple verification artifacts from distinct verifier IDs without overwriting earlier evidence.

## Replay controls

The contract rejects:

- reserving the same `executionId` twice;
- reserving the same permit binding twice;
- starting an execution that was not reserved;
- starting the same reservation twice;
- starting at or after permit expiry;
- completing an execution that never entered `STARTED`;
- a receipt whose start timestamp differs from the ledger start timestamp;
- replaying completion after the execution is already `COMPLETED`;
- duplicate verification IDs or bindings;
- multiple apparent verifier entries from the same verifier ID.

## Exact linkage

Each ledger entry preserves:

- execution ID
- permit binding
- admission binding
- proposal binding
- resource-precondition binding when present
- reservation/start/completion timestamps
- receipt binding
- executor-reported outcome
- post-execution verification references

The ledger and every entry use deterministic structural mutation bindings.

## Critical production boundary

This is **not durable replay prevention yet**.

The current ledger is a caller-supplied value object. Two processes can still each hold separate copies unless a trusted backend persists the reservation and transition atomically.

Production must eventually implement an atomic storage rule equivalent to:

```text
INSERT execution_id / permit_binding IF NOT EXISTS
```

or a transactional compare-and-set / unique constraint before any executor begins work.

The intended future storage layer may be Supabase/Postgres, but v0.1 introduces no credentials, schema migration, live database, or network dependency.

## Multi-verifier evidence

A completed entry may store verification references from several different verifier IDs.

This preserves disagreement instead of collapsing it into a synthetic vote. The ledger does not calculate consensus and does not turn the number of verifiers into authority.

Each verifier ID may appear at most once per execution entry in v0.1 so one verifier cannot create multiple apparent independent confirmations.

## Trust calibration

The ledger is structural state, not authenticated persistence.

It does not claim:

- database durability;
- distributed locking;
- authenticated storage identity;
- cryptographic tamper evidence;
- exactly-once execution across processes;
- trusted executor/verifier identity;
- real n8n/tool execution.

## ROEM calibration

### Refinement

One execution ID inside a permit is not sufficient unless consumption is remembered.

### Opportunity

Create the exact state machine that a future transactional Supabase/Postgres implementation can persist without redesigning execution semantics.

### Enhancement

Add reserve → start → complete transitions, exact permit/receipt linkage, and append-only multi-verifier references.

### Mitigation

Keep the contract explicitly non-durable until atomic persistence is wired by a trusted backend.

### Evidence / recalibration

Regression coverage includes:

- empty ledger integrity;
- duplicate reservation rejection;
- mutation detection;
- late start rejection;
- double-start rejection;
- receipt/start mismatch rejection;
- completion replay rejection;
- exact outcome/receipt preservation;
- duplicate verification rejection;
- same-verifier inflation rejection;
- multiple distinct verifier artifacts preserved without overwrite.

## Design law

> **A permit authorizes at most one intended execution, but only an atomic persisted reservation can make that non-replayable across workers. Reserve first, execute second, record exactly what happened, and preserve verification evidence without rewriting history.**
