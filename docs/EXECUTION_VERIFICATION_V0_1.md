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
independent verifier
      |
      v
ExecutionVerification
```

## Verification statuses

- `CONFIRMED` — independent observation matches the executor-reported outcome.
- `CONTRADICTED` — independent observation differs from the executor-reported outcome.
- `INCONCLUSIVE` — available evidence cannot independently establish agreement or contradiction.

`CONFIRMED` requires a non-null `observedOutcome` equal to the receipt outcome.

`CONTRADICTED` requires a non-null `observedOutcome` different from the receipt outcome.

`INCONCLUSIVE` may carry no observed outcome.

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

and an independent verifier observes:

```text
FAILED
```

then the system retains both facts as separate claims:

```text
reportedOutcome = SUCCEEDED
status = CONTRADICTED
observedOutcome = FAILED
```

No layer is allowed to silently rewrite the contradiction into success.

## Trust calibration

Trust label:

```text
EXECUTION_VERIFICATION_REPORTED_UNAUTHENTICATED_VERIFIER
```

The verifier identity is not independently authenticated in v0.1. This is a structural evidence contract, not cryptographic proof.

## Explicit non-claims

v0.1 does not claim:

- authenticated verifier identity;
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

Add `CONFIRMED / CONTRADICTED / INCONCLUSIVE` with exact receipt/permit/execution linkage.

### Mitigation

Preserve the original receipt and keep verifier trust explicitly unauthenticated.

### Evidence / recalibration

Tests cover:

- matching success confirmation;
- contradiction without rewriting receipt;
- inconclusive evidence;
- false confirmation rejection;
- false contradiction rejection;
- verification predating execution completion.

## Design law

> **The executor reports what it believes happened. A separate verifier checks what can actually be observed. Agreement may confirm the report; disagreement must remain visible; insufficient evidence stays inconclusive.**
