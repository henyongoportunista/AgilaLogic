# Audit Ledger v0.1

Status: **experimental append-only reference ledger + persistence port contract**

This layer creates a narrow audit trail contract for backend state transitions without storing raw prompts, secret phrases, OTP values, arbitrary request bodies, or tool payloads.

## Goal

Record **which bounded artifact/state transition happened, when, under which actor class, and with which exact binding** so later persistence adapters can preserve an inspectable chain of evidence.

The core flow is:

```text
ARCHITECTURE / AUTH / TRUST / SAB / EXECUTION ARTIFACT
                |
                v
          AUDIT EVENT
     (references + bindings only)
                |
                v
       APPEND-ONLY LEDGER
                |
                v
       FUTURE DURABLE STORE
```

## Event taxonomy

v0.1 supports:

- `SOURCE_ATTESTATION_RECORDED`
- `AUTH_ASSERTION_CONSUMED`
- `NORTHSTAR_CONTEXT_COMPILED`
- `LIFECYCLE_REGISTERED`
- `LIFECYCLE_SUPERSEDED`
- `RFI_RESOLUTION_REINJECTED`
- `TRUST_ADMITTED`
- `SAB_DECISION_RECORDED`
- `EXECUTION_PERMIT_ISSUED`
- `EXECUTION_RECEIPT_RECORDED`
- `EXECUTION_VERIFICATION_RECORDED`

Each event type is paired with one expected artifact kind. Event/artifact mismatches fail closed.

## Reference-only schema

An `AuditEvent` contains bounded metadata only:

- event ID
- event type
- occurred-at timestamp
- actor kind + opaque actor ID
- artifact kind + opaque artifact ID
- exact artifact binding
- bounded outcome enum
- optional context/request/execution IDs

It intentionally has no arbitrary `message`, `payload`, `prompt`, `response`, `secret`, or free-form metadata object.

This reduces accidental secret/content replication into the audit layer. It is **not a secret scanner**: callers must still use opaque non-secret identifiers rather than placing credentials inside IDs.

## Failure truth

Audit outcomes explicitly include:

- `FAILED`
- `PARTIAL`
- `UNKNOWN`
- `CONTRADICTED`
- `INCONCLUSIVE`

The ledger does not reinterpret these states. Changing a prior failure to success changes the bound entry and invalidates the chain.

## Append semantics

`appendAuditEvent()` requires:

```text
expectedHeadBinding == current ledger head
```

This models optimistic concurrency. A stale writer cannot silently append as though no concurrent event occurred.

Other invariants:

- unique event IDs
- monotonic event timestamps
- contiguous sequence numbers
- exact previous-entry linkage
- event/artifact taxonomy consistency
- deterministic entry and snapshot bindings

## Persistence interface

`AuditStorePort` exposes only:

```text
load()
append(event + expected head)
```

A future Supabase/Postgres adapter can implement this using a transaction or compare-and-swap style database rule.

The architecture layer does not currently open a database connection and contains no Supabase credentials.

## Critical calibration

The linked deterministic bindings are **not cryptographic durable tamper evidence**.

They detect mutation relative to the supplied snapshot, but a malicious party that controls the entire stored snapshot can recompute the deterministic chain.

Production hardening may later use:

- authenticated database access
- append-only permissions
- transaction constraints
- server-generated timestamps where appropriate
- signed checkpoints / external anchoring if the threat model justifies it

None of those are claimed in v0.1.

## ROEM calibration

### Refinement

Do not let state transitions disappear into logs or arbitrary strings; record exact artifact bindings and bounded outcomes.

### Opportunity

Create a persistence-neutral seam that the future private canonical backend can map to Supabase/Postgres without coupling trust logic to a database vendor.

### Enhancement

Add append-only sequencing, optimistic head checks, reference-only event schema, failure-truth outcomes, and an `AuditStorePort`.

### Mitigation

Avoid raw payload storage, blockchain/tamper-proof language, database credentials, and fake durability claims.

### Evidence / recalibration

Tests cover:

- empty ledger verification
- ordered append
- head advancement
- stale-head conflict
- duplicate event IDs
- backdated events
- event/artifact mismatch
- preservation of `FAILED` and `INCONCLUSIVE`
- mutation of a prior failure into success invalidating the chain
- forged head detection

## Design law

> **Audit the transition, not the secret. Preserve exact artifact references, bindings, order, and failure truth. A deterministic chain gives inspectable continuity; only a trusted durable store can give operational persistence.**
