# Resource Precondition v0.1

Status: **experimental resource-version / reservation contract before execution permit issuance**

This layer addresses one part of the attestation-to-execution TOCTOU gap by requiring a fresh adapter-reported resource version or reservation token for selected mutating resource operations.

## Goal

A proposal can be valid at Trust Admission time and still become stale before a real write happens because the target resource changed.

The new structural flow is:

```text
SAB-ADMISSIBLE CANDIDATE
        |
        v
ADAPTER OBSERVES / RESERVES TARGET STATE
        |
        v
RESOURCE PRECONDITION
        |
        v
EXECUTION PERMIT
        |
        v
FUTURE EXECUTOR / n8n ADAPTER
```

## Required operations

v0.1 requires a ResourcePrecondition before issuing a permit for:

- `WRITE`
- `DELETE`
- `PRODUCTION_DEPLOY`
- `PERMISSION_CHANGE`

Other operation classes may use different anti-replay/idempotency mechanisms later and are not automatically forced into a resource-version model by this prototype.

In particular, `PAYMENT` and `EXTERNAL_MESSAGE` often need transaction/idempotency keys, provider-side request deduplication, or delivery-state contracts rather than a mutable-resource ETag. v0.1 deliberately leaves those as separate future mechanisms instead of pretending one precondition model fits every consequence type.

## Contract

The precondition binds:

- precondition ID
- exact admission binding
- exact proposal binding
- adapter ID
- target
- opaque version/reservation token
- observation time
- expiry

Trust label:

```text
RESOURCE_PRECONDITION_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_ADAPTER
```

The same adapter ID represented by Operation Truth must report the precondition.

## Time rules

The resource observation must:

- occur at or after Trust Admission;
- expire after observation;
- never outlive the SAB-admissible candidate.

ExecutionPermit expiry is further reduced to the resource-precondition expiry when that is the earliest remaining boundary.

## What the token means

`versionToken` is intentionally opaque. A future adapter can map it to an implementation-specific mechanism such as:

- ETag
- row version
- revision ID
- object generation
- reservation token
- compare-and-swap version

The core architecture does not infer semantics from the string itself.

## Critical limitation

v0.1 **does not eliminate TOCTOU**.

It only ensures that a permit is structurally linked to a recently observed/reserved target state.

Actual protection requires the real executor to perform an atomic write-time check equivalent to:

```text
execute only if current_resource_version == permit.precondition.versionToken
```

or use a provider-native reservation/conditional-write mechanism.

Until then, an unauthenticated or non-enforcing adapter can still report a token without honoring it during execution.

## Execution receipt linkage

When a permit carries a resource precondition, the ExecutionReceipt preserves its binding. This makes later audit/verification able to determine which precondition was supposed to govern that execution.

The receipt still does not prove the executor actually enforced the token.

## ROEM calibration

### Refinement

Do not treat short permit TTL alone as sufficient protection against resource changes.

### Opportunity

Create a provider-neutral seam for ETags, row versions, object generations, and reservations before connecting n8n or real tool adapters.

### Enhancement

Require fresh exact resource preconditions for selected mutations and bind them through permit → receipt.

### Mitigation

Keep adapter identity and write-time enforcement explicitly unauthenticated/unimplemented.

### Evidence / recalibration

Regression coverage includes:

- mutating permit rejected without precondition;
- adapter mismatch;
- target/precondition mutation;
- precondition expiry;
- permit expiry collapsing to precondition expiry;
- receipt preserving the precondition binding.

## Design law

> **A fresh proposal is not proof that the target is still unchanged. Bind execution to a fresh target-state precondition, then require the real adapter to enforce that precondition atomically at the moment of mutation.**
