# Trust Spine v0.1

Status: **experimental contract layer on top of the green ROEM Phase-1 Gagamba–Agila baseline**

Trust Spine v0.1 does not add a real executor. It adds inspectable contracts around three truth boundaries that must exist before consequential execution can be trusted.

## 1. Source Truth

Question:

> Where did this belief come from?

Gagamba signals may now carry a structured provenance envelope:

- source class;
- producer;
- observed-at timestamp;
- optional source reference;
- optional evidence reference.

Supported source classes:

- `HUMAN_STATED`
- `TOOL_OBSERVED`
- `SYSTEM_OBSERVED`
- `EXTERNAL_DOCUMENT`
- `MODEL_DERIVED`
- `UNKNOWN_SOURCE`

Missing provenance is preserved as an explicit gap. It is not fabricated.

A `MODEL_DERIVED` signal may not self-label as `FACT` in this prototype. That prevents one direct form of hallucination laundering. This still does not mean every accepted `FACT` is objectively true; provenance records origin, not guaranteed correctness.

## 2. State Truth

Question:

> Is this packet/context still valid now?

Trust Spine wraps ArchitecturePacket and EngineeringPacket with a `PacketLifecycle` containing:

- lifecycle ID;
- context ID;
- issued-at;
- expires-at;
- SAB policy version;
- optional superseded lifecycle reference.

Rules:

- expired packets fail;
- packets not yet valid fail;
- policy-version mismatch fails;
- Engineering state must refer to the same context as Architecture state;
- Engineering validity may not extend beyond the Architecture validity window;
- Trust Spine bindings are deterministic non-cryptographic drift checks only.

This layer answers freshness/consistency, not identity or cryptographic provenance.

### RFI lifecycle

RFI is represented as a separate evolving artifact rather than mutating the bound EngineeringPacket.

States:

- `OPEN`
- `RESOLVED`
- `EXPIRED`
- `UNRESOLVABLE`

The RFI contract carries an owner, question, current round, configured maximum rounds, expiry and deterministic non-cryptographic binding.

Repeated clarification beyond the configured round budget terminates as `UNRESOLVABLE` instead of looping forever.

## 3. Operation Truth

Question:

> What is the adapter actually about to do?

An `AdapterAttestation` contract independently describes the concrete operation:

- action type;
- scope;
- target;
- reversibility;
- data sensitivity;
- affected-record count;
- estimated-cost measurement;
- secret status;
- proposal/request linkage;
- Engineering binding;
- policy version;
- observed-at / expiry;
- adapter identifier.

The comparator checks the adapter-derived operation against the `UNATTESTED` Engineer proposal.

Any mismatch fails closed and produces no adapter-matched candidate.

A perfect match produces:

`ADAPTER_MATCHED_UNAUTHENTICATED`

This label is deliberate. The current prototype has not authenticated the adapter itself and has no hardware-rooted or cryptographic attestation. Matching structure is not trusted identity.

## Cost semantics

The existing SAB uses a prototype numeric `estimatedCost` field without currency/unit semantics.

Trust Spine therefore only allows a SAB-compatible adapter match when the attested cost unit is explicitly:

`PROTOTYPE_SCALAR`

A currency/unit-bearing production measurement must not silently collapse into that prototype scalar. Production financial semantics remain unimplemented.

## Current topology

```text
RAW SIGNALS
    |
    v
GAGAMBA WEAVE
+ provenance ledger
    |
    v
HT ArchitecturePacket
    |
    + PacketLifecycle
    v
LIFECYCLE-BOUND ARCHITECTURE STATE
    |
    v
MT EngineeringPacket
    |
    + PacketLifecycle
    v
LIFECYCLE-BOUND ENGINEERING STATE
    |
    v
UNATTESTED PROPOSAL
    |
    v
ADAPTER ATTESTATION CONTRACT
    |
    +-- mismatch --> FAIL CLOSED
    |
    `-- exact match --> ADAPTER_MATCHED_UNAUTHENTICATED
                           |
                           v
                     SAB POLICY ROUTE
```

No real external adapter is connected.

## Adversarial invariants covered by tests

- structured provenance survives the weave;
- missing provenance remains explicit;
- model-derived input cannot self-label as FACT;
- expired lifecycle is rejected;
- policy-version drift is rejected;
- Engineering context cannot silently differ from Architecture context;
- Engineering validity cannot outlive Architecture validity;
- RFI terminates after a configured round budget;
- RFI supports resolved/expired terminal states;
- adapter target mismatch fails closed;
- adapter cost-unit mismatch fails closed;
- exact operation match remains explicitly unauthenticated.

## Explicit non-claims

Trust Spine v0.1 does **not** implement or prove:

- authenticated adapter identity;
- cryptographic signing;
- hardware attestation / TEE;
- durable replay prevention;
- tamper-evident persistent state;
- real external execution;
- production cost/currency semantics;
- formal verification;
- prompt-injection immunity.

## Design law

> **Gagamba preserves where a belief came from. Trust Spine preserves whether the state is still valid. Agila proposes a bounded operation. The adapter contract states what would actually happen. Mismatch fails closed before SAB. Neither structural matching nor model confidence creates execution authority.**
