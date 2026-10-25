# RFI Resolution Reinjection v0.1

Status: **experimental typed clarification-reentry contract**

This layer prevents a free-text RFI answer from silently becoming trusted fact or mutating an existing ArchitecturePacket in place.

## Goal

Current RFI lifecycle can produce:

```text
OPEN -> RESOLVED
```

with a human/model/tool answer stored as text.

That text is not automatically truth.

The new flow is:

```text
RFI RESOLVED
    |
    v
RFI RESOLUTION ARTIFACT
(kind + provenance + exact RFI binding)
    |
    v
GAGAMBA SIGNAL
    |
    v
GAGAMBA RE-WEAVE
    |
    v
NEW ArchitecturePacket [future caller responsibility]
```

No old packet is mutated in place.

## Artifact contract

`RfiResolutionArtifact` binds:

- resolution ID
- RFI ID
- exact RFI lifecycle binding
- Architecture binding
- Engineering binding
- context ID
- epistemic signal kind
- exact resolved text
- provenance envelope
- resolution timestamp

Its trust label is:

```text
RESOLUTION_REQUIRES_GAGAMBA_REWEAVE
```

## Epistemic preservation

The artifact uses the same Gagamba signal taxonomy:

- `FACT`
- `INFERENCE`
- `PREDICTION`
- `PREFERENCE`
- `UNKNOWN`
- `CONSTRAINT`
- `RESOURCE`

The generated signal must pass normal Gagamba validation before the artifact can be bound.

Therefore:

```text
MODEL_DERIVED + FACT
```

is rejected exactly like an ordinary model-derived signal trying to self-label as fact.

A model-derived answer may remain typed as `INFERENCE` or another appropriate non-FACT category, but it does not gain fact status merely because an RFI was marked RESOLVED.

## Human answers

A human answer can be represented as:

```text
kind: FACT
provenance.sourceClass: HUMAN_STATED
```

when the fact being represented is specifically **that the human stated or decided something**. Examples include a preference, an operator clarification, or a first-person declaration.

This does not convert the content of the statement into universal objective truth. For example, `HUMAN_STATED + FACT` can support “the operator stated X”; it does not by itself prove “X is externally true.”

Authorization-relevant human statements also remain subject to the separate authenticated-principal and SAB boundaries. A human-stated RFI answer cannot create execution authority merely by being typed as FACT.

## Reinjection rule

`rfiResolutionToGagambaSignal()` returns a `GagambaSignal` only.

It does not:

- append directly to `ArchitecturePacket.facts`;
- mutate an EngineeringPacket;
- satisfy SAB;
- create authority;
- create an execution request.

The signal must be included in a new Gagamba weave. A subsequent ArchitecturePacket must then be minted from that new weave if the clarified state materially changes architecture.

If the new packet replaces an earlier lifecycle, the separate Lifecycle Registry contract must handle that supersession explicitly; RFI resolution does not silently supersede packet state by itself.

## Timing

The resolution artifact must claim a resolution time:

- not before the RFI opened;
- before the RFI expiry.

This does not currently add a `resolvedAt` field directly to the original RFI lifecycle; the artifact records the typed reinjection event separately.

## Integrity

The artifact has a deterministic binding over its typed resolution content.

Mutation of:

- text
- kind
- provenance
- RFI binding
- Architecture/Engineering linkage
- context
- timestamp

invalidates the artifact binding.

This is a drift detector, not a cryptographic signature.

## Explicit non-claims

v0.1 does not claim:

- that a resolved answer is objectively true;
- authenticated human identity by itself;
- cryptographic provenance;
- durable persistence;
- automatic packet regeneration;
- prompt-injection immunity;
- authority to act;
- direct SAB admission.

## ROEM calibration

### Refinement

Stop treating free-text `resolution` as potentially reusable truth without epistemic typing.

### Opportunity

Make clarification results safely reusable while retaining their source and epistemic category.

### Enhancement

Add a typed, provenance-bearing, RFI-bound resolution artifact and a narrow conversion back into a Gagamba signal.

### Mitigation

Require re-weave and new packet minting instead of hidden in-place state mutation.

### Evidence / recalibration

Tests cover:

- human-stated FACT resolution re-entering through Gagamba;
- model-derived FACT rejection;
- model-derived INFERENCE preservation;
- unresolved RFI rejection;
- artifact text tampering;
- resolution timestamp at/after RFI expiry.

## Design law

> **Resolved means the question received an answer; it does not mean the answer became truth. Every clarification must re-enter the epistemic pipeline with its source, type, and original RFI binding intact.**
