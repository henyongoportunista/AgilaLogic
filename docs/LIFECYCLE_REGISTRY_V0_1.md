# Lifecycle Registry v0.1

Status: **experimental active-state / supersession contract**

This layer makes packet supersession consequential instead of merely descriptive.

## Goal

A packet may remain inside its timestamp validity window while still being obsolete because a newer packet has replaced it.

Freshness alone therefore is insufficient.

The registry adds the question:

```text
Is this lifecycle still the active lifecycle for this context and lane?
```

## Registry model

Each registry entry records:

- lifecycle kind: `ARCHITECTURE` or `ENGINEERING`
- context ID
- lifecycle ID
- trust binding
- policy version
- issue / expiry window
- status: `ACTIVE` or `SUPERSEDED`
- optional predecessor
- optional successor

For a given `(kind, contextId)` there may be at most one `ACTIVE` lifecycle.

## Explicit supersession

When an active lifecycle already exists, a replacement must declare:

```text
supersedesLifecycleId = currentActiveLifecycleId
```

A parallel lifecycle that omits the predecessor is rejected.

A lifecycle cannot supersede a missing active predecessor, and the successor must advance issuance time.

This prevents silent forks from being treated as equivalent current state.

## Trust Admission integration

Trust Admission v0.4 now requires both:

```text
fresh timestamp
+
ACTIVE lifecycle registry membership
```

for Architecture and Engineering states.

Therefore a superseded packet is rejected even when:

```text
now < expiresAt
```

The admission candidate also carries the registry binding used during admission so later audit evidence can identify which active-state view was consulted.

## Replay semantics

The registry blocks **semantic replay of superseded packet lifecycles** relative to the supplied registry state.

It does not yet provide durable replay prevention because the registry itself is an explicit caller-supplied artifact. A production backend must persist and transactionally update the authoritative registry.

## Current transition example

```text
ARCHITECTURE life-1  ACTIVE
        |
        | explicit supersession
        v
ARCHITECTURE life-1  SUPERSEDED
ARCHITECTURE life-2  ACTIVE
```

An admission request still carrying `life-1` then fails with:

```text
architecture_lifecycle_not_active
```

even if `life-1` has not reached its expiry time.

## Integrity checks

The deterministic registry binding protects against accidental mutation in the prototype and verifies invariants such as:

- unique lifecycle IDs;
- one active lifecycle per kind/context;
- superseded entries have a successor;
- successor points back to the predecessor;
- context and lane remain consistent across supersession;
- successor issuance advances time.

The binding is **not a cryptographic signature**.

## Explicit non-claims

v0.1 does not claim:

- durable database persistence;
- distributed consensus;
- atomic compare-and-swap across servers;
- tamper-evident storage;
- cryptographic registry signatures;
- automatic revocation across already-running external tools;
- TOCTOU elimination;
- execution authority.

## Production direction

The future backend should persist lifecycle state with an atomic rule equivalent to:

```text
replace ACTIVE only when expected_current_lifecycle_id matches
```

This is conceptually similar to compare-and-swap / optimistic concurrency, but the current library intentionally stops at deterministic contract semantics.

## ROEM calibration

### Refinement

Turn existing `supersedesLifecycleId` from descriptive metadata into an enforceable active-state rule.

### Opportunity

Block stale-but-not-yet-expired packet replay and silent lifecycle forks before SAB.

### Enhancement

Add a versioned registry, deterministic registry binding, explicit registration transitions, active-state assertions, and mandatory Trust Admission composition.

### Mitigation

Do not pretend an in-memory/caller-supplied artifact is durable storage. Persistence, locking, and distributed race handling remain backend infrastructure work.

### Evidence / recalibration

Tests cover:

- initial Architecture + Engineering registration;
- parallel replacement without explicit supersession;
- valid explicit supersession;
- replay of superseded Architecture state;
- replay of superseded Engineering state;
- duplicate lifecycle IDs;
- registry mutation / invariant breakage;
- Trust Admission rejection of a superseded but time-fresh packet.

## Design law

> **Fresh does not mean current. A packet is admissible only when it is both time-valid and the active lifecycle for its context. Supersession must be explicit, monotonic, and visible to Trust Admission.**
