# Trust Admission v0.2

Status: **experimental mandatory composition gate layered on Northstar Integrity v0.1 + Trust Spine v0.1**

Trust Admission v0.2 closes a structural gap discovered during the live code audit: Source Truth, State Truth, Northstar role fidelity, and Operation Truth existed as separate contracts, but a future caller could accidentally use only part of the chain before presenting a proposal to SAB.

The new `admitForSab()` gate composes those checks into one fail-closed path.

## Goal

Before a proposal may be presented as SAB-admissible, the prototype now requires structural agreement across:

```text
SOURCE TRUTH
    +
STATE TRUTH
    +
NORTHSTAR ROLE / CONTEXT
    +
OPERATION TRUTH
    |
    v
TRUST ADMISSION
    |
    v
SAB-ADMISSIBLE CANDIDATE
```

This still does **not** authorize execution.

## Admission checks

### 1. Architecture state

- deterministic Architecture trust binding verifies;
- Architecture lifecycle is currently fresh;
- active SAB policy version is respected through the existing lifecycle contract.

### 2. Engineering state

- deterministic Engineering trust binding verifies;
- Engineering lifecycle is currently fresh;
- Engineering state remains bound to the exact Architecture state;
- Engineering intent must be `PROPOSAL_ONLY`.

### 3. Proposal linkage

The `UNATTESTED` proposal must match:

- Architecture binding;
- Engineering binding;
- Engineering packet ID.

### 4. Source Truth becomes consequential

Every Architecture `FACT` must have a corresponding provenance-ledger `FACT` record with a known non-model-derived origin.

A fact is blocked when:

- no provenance record exists;
- provenance is missing;
- source class is `UNKNOWN_SOURCE`;
- provenance ledger marks the fact as a provenance gap;
- a model-derived source attempts to stand in as fact origin.

This does not prove the fact is objectively true. It only makes known origin a mandatory condition for fact-bearing proposals to pass structural admission.

### 5. Northstar role fidelity

The Northstar context pack must:

- verify structurally;
- be fresh;
- represent the same Engineer role currently producing the proposal;
- remain in the `ENGINEER` lane;
- retain `PROPOSAL_ONLY` authority ceiling;
- target the same Architect↔Engineer strand version.

Identity does not become authority through this check.

### 6. Operation Truth

The AdapterAttestation comparator must produce an exact structural match between the Engineer's `UNATTESTED` proposal and the adapter-described concrete operation.

Mismatch fails closed.

## Output trust label

A successful gate returns:

`STRUCTURALLY_ADMITTED_UNAUTHENTICATED`

That wording is deliberate.

It means the currently represented Source, State, Northstar role, proposal linkage, and operation-description contracts agree structurally.

It does **not** mean:

- provenance source identity is cryptographically authenticated;
- the provenance ledger itself is tamper-evident or cryptographically authenticated;
- the adapter identity is authenticated;
- Node Alpha identity is authenticated;
- the proposal is authorized;
- SAB returned `ALLOW`;
- execution occurred;
- replay protection is durable;
- prompt injection is impossible.

## Known provenance limitation

Trust Admission v0.2 makes provenance **consequential**, but it does not yet make provenance **trusted**.

The current provenance ledger is an in-memory structural artifact derived from the Gagamba weave. The admission gate validates that Architecture FACTs have matching ledger records and known source classes, but it does not cryptographically prove that the ledger itself was produced by a trusted observer or was not replaced by a caller.

Therefore the current claim is:

> **known provenance is required for admission**

not:

> **provenance is independently authenticated**

Future source-attestation work may bind provenance to trusted tools, signed evidence, durable event identity, or another independently verifiable source mechanism. That remains outside v0.2.

## Current topology

```text
EXTERNAL AUTH [future]
        |
        v
NORTHSTAR CONTEXT
        |
        v
GAGAMBA SOURCE / INTENT
        |
        v
ARCHITECTURE STATE
        |
        v
AGILA ENGINEERING STATE
        |
        v
UNATTESTED PROPOSAL
        |
        v
ADAPTER ATTESTATION
        |
        v
TRUST ADMISSION v0.2
        |
        +-- any mismatch --> FAIL CLOSED
        |
        `-- structural match --> STRUCTURALLY_ADMITTED_UNAUTHENTICATED
                                      |
                                      v
                                     SAB
```

## ROEM calibration

### Refinement

Preserve all existing Trust Spine and Northstar invariants.

### Opportunity

Remove accidental partial-use of trust contracts and make provenance gaps materially block fact-bearing proposals.

### Enhancement

Add one narrow mandatory composition gate instead of adding another agent, router, executor, or credential system.

### Mitigation

The gate deliberately does not:

- call SAB itself;
- grant authority;
- authenticate operators;
- authenticate adapters;
- authenticate provenance sources;
- authenticate the provenance ledger itself;
- connect real tools;
- activate additional persona strands;
- claim cryptographic integrity.

### Evidence / recalibration

Adversarial tests cover:

- exact Source + State + Northstar + Operation match;
- missing fact provenance;
- wrong Northstar role;
- adapter target mismatch;
- stale Engineering state.

Future red-team targets remain:

- provenance-ledger forgery / source attestation;
- durable lifecycle supersession and replay resistance;
- attestation-to-execution TOCTOU;
- externally authenticated operator sessions;
- cross-agent context poisoning;
- RFI resolution provenance and reinjection semantics.

## Design law

> **A proposal may reach SAB only after the prototype can structurally account for where its facts came from, whether its state is still fresh, whether the correct bounded Engineer role produced it, and whether the adapter-described operation matches the proposal. Structural agreement is admission, not authority.**
