# Independent Execution Verification v0.1

Status: **experimental post-execution verification contract**

An `ExecutionReceipt` records what an executor reports happened. It is not independent proof that the reported outcome is true.

This layer adds a separate verifier artifact over the exact receipt + permit.

## Flow

```text
ExecutionPermit
      |
      v
future executor / n8n
      |
      v
ExecutionReceipt
(executor-reported outcome)
      |
      v
separate verifier identity
      |
      v
ExecutionVerification
```

## Verification statuses

- `CONFIRMED` — a separately identified verifier observes the same **known** outcome as the executor report.
- `CONTRADICTED` — a separately identified verifier observes a different **known** outcome.
- `INCONCLUSIVE` — available evidence cannot independently establish agreement or contradiction.

`CONFIRMED` requires a non-null known `observedOutcome` equal to the receipt outcome.

`CONTRADICTED` requires two known outcomes that differ.

`UNKNOWN` is not promotable to `CONFIRMED` or `CONTRADICTED`; uncertainty stays `INCONCLUSIVE` until additional evidence resolves it.

## Structural independence

The verifier identifier must differ from the executor identifier recorded in the receipt.

This blocks the simplest form of executor self-verification in the contract:

```text
executorId == verifierId  -> reject
```

This is **identifier-level separation only**. It does not prove that two identifiers correspond to independent real-world principals or trusted services. A future trusted verifier boundary must authenticate that distinction.

## Integrity

The verification artifact binds:

- exact receipt binding
- exact permit binding
- execution ID
- proposal binding
- original executor-reported outcome
- verification status
- separately observed outcome
- verifier ID
- verification time
- optional evidence reference / reason

Verification cannot predate reported execution completion.

## Failure truth

The receipt is never rewritten.

If the executor reports:

```text
SUCCEEDED
```

and a separate verifier observes:

```text
FAILED
```

then the system retains both claims:

```text
reportedOutcome = SUCCEEDED
status = CONTRADICTED
observedOutcome = FAILED
```

No layer is allowed to silently rewrite the contradiction into success.

If either side only has `UNKNOWN`, the result remains `INCONCLUSIVE` rather than creating false certainty.

## Trust calibration

Trust label:

```text
EXECUTION_VERIFICATION_REPORTED_UNAUTHENTICATED_VERIFIER
```

The verifier identity is not independently authenticated in v0.1. This is a structural evidence contract, not cryptographic proof.

## Explicit non-claims

v0.1 does not claim:

- authenticated verifier identity;
- proof that executor and verifier are truly independent principals;
- objective proof of success;
- trusted external evidence acquisition;
- durable audit persistence;
- real execution;
- prompt-injection immunity;
- formal verification.

A future trusted verifier adapter must establish verifier identity and evidence authenticity outside the model context.

## ROEM calibration

### Refinement

Separate executor-reported outcome from independent verification instead of treating receipts as truth.

### Opportunity

Give future read-back checks, provider status APIs, database verification, or human confirmation a common result model.

### Enhancement

Add `CONFIRMED / CONTRADICTED / INCONCLUSIVE` with exact receipt/permit/execution linkage, structural executor/verifier separation, and explicit unknown-state preservation.

### Mitigation

Preserve the original receipt, reject structural self-verification, never promote `UNKNOWN` into confirmation, and keep verifier trust explicitly unauthenticated.

### Evidence / recalibration

Tests cover:

- matching known-outcome confirmation;
- contradiction without rewriting receipt;
- inconclusive evidence;
- executor self-verification rejection;
- false confirmation rejection;
- false contradiction rejection;
- unknown outcome not promoted into confirmation/contradiction;
- verification predating execution completion.

## Design law

> **The executor reports what it believes happened. A separately identified verifier checks what can actually be observed. Known agreement may confirm the report; known disagreement must remain visible; unknown or insufficient evidence stays inconclusive.**
