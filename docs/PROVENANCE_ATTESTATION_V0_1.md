# Provenance Attestation v0.1

Status: **experimental Source Truth verification seam**

The existing provenance ledger records what a signal claims about its origin. It does not independently prove that the producer or source class is authentic.

This layer adds a separate, time-bounded verification receipt for provenance-bearing signals used as Architecture FACTs.

## Flow

```text
GAGAMBA SIGNAL
  + provenance claim
        |
        v
PROVENANCE LEDGER
        |
        v
SOURCE VERIFIER RECEIPT
        |
        v
PROVENANCE ATTESTATION
        |
        v
TRUST ADMISSION
```

## Contract

A provenance attestation binds:

- signal ID
- epistemic kind
- exact signal text
- exact provenance envelope
- verifier ID
- verification time
- expiry
- optional opaque evidence reference

The trust label is deliberately:

```text
SOURCE_PROVENANCE_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_VERIFIER
```

The current library verifies structural agreement and freshness. It does **not** authenticate the verifier identity.

## FACT admission rule

Trust Admission v0.5 requires each Architecture FACT to have:

1. a known non-model-derived provenance record; and
2. a fresh provenance attestation that exactly matches that ledger entry.

A missing, expired, changed, unknown-source, or mismatched provenance attestation fails closed before SAB.

The resulting SAB-admissible candidate records the provenance attestation IDs and verifier IDs used during admission.

## Anti-laundering rules

The seam does not allow:

- `UNKNOWN_SOURCE` to be upgraded into trusted provenance merely by wrapping it;
- `MODEL_DERIVED + FACT` to be laundered through an attestation;
- an attestation to predate the observation it claims to verify;
- changed signal text/provenance to reuse an old attestation.

## What this improves

The prior ledger answered:

> “What origin metadata was attached?”

This layer additionally asks:

> “Did a separate verifier contract inspect this exact provenance-bearing signal, and is that receipt still fresh?”

That is useful for future adapters such as authenticated tool connectors, human-session verifiers, signed document ingest, or server-controlled evidence collectors.

## Explicit non-claims

v0.1 does not claim:

- authenticated verifier identity;
- cryptographic source signatures;
- objective factual truth;
- tamper-evident persistence;
- external-document authenticity;
- hardware attestation;
- prompt-injection immunity;
- execution authority.

A malicious caller able to forge both the provenance ledger and the unauthenticated verifier receipt can still create structurally matching artifacts. Production trust therefore requires an independently trusted verifier boundary later.

## ROEM calibration

### Refinement

Separate the provenance claim from the act of checking that claim.

### Opportunity

Give future trusted source adapters a narrow interface without redesigning Gagamba or Trust Admission.

### Enhancement

Require fresh exact-match source attestations for Architecture FACTs and preserve their IDs in admission evidence.

### Mitigation

Keep the trust label explicitly unauthenticated until verifier identity is independently established.

### Evidence / recalibration

Tests cover:

- exact source-attestation match;
- content mutation;
- changed ledger entry;
- expiry;
- `UNKNOWN_SOURCE` laundering attempt;
- model-derived FACT laundering attempt;
- verifier receipt predating observation;
- Trust Admission failure when a FACT has provenance but no source attestation.

## Design law

> **Provenance says where a claim says it came from. Attestation says a verifier checked that exact provenance-bearing claim. Neither becomes trustworthy identity until the verifier itself is independently trusted.**
