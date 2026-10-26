# Source Attestation v0.2

## Purpose

Close the structural Source Truth gap before any new execution work.

A provenance label answers **where a claim says it came from**. It does not prove that the source was separately checked. Architecture FACTs therefore require a separate source-attestation receipt before Trust Admission.

## Rule

```text
FACT
  -> provenance ledger entry
  -> provenance-integrity binding
  -> exact fresh source attestation
  -> Trust Admission
```

No source attestation means no structurally admitted FACT-bearing proposal.

## Exact binding

A `ProvenanceAttestation` binds:

- exact signal ID;
- epistemic kind;
- normalized signal text;
- full provenance envelope;
- verifier ID;
- verification time;
- expiry time;
- optional opaque evidence reference.

Mutation of the bound content invalidates the deterministic binding.

## State-window rule

A source receipt must remain valid through the current Architecture/Engineering state window, not merely at the instant Trust Admission runs.

This avoids treating a claim as good for a decision state that outlives its own source-verification window. A shorter source receipt requires re-verification before the state can be admitted.

If the Architecture contains no FACT claims, no source receipt is required for that reason alone.

## Fail-closed cases

Trust Admission blocks FACT-bearing state when:

- no matching provenance record exists;
- provenance is unknown;
- a FACT is model-derived;
- the provenance ledger was mutated after its integrity binding;
- no exact source attestation exists;
- the source attestation is malformed, mutated, not yet valid or expired;
- the source attestation does not cover the current state window;
- duplicate source-attestation IDs are supplied;
- the bounded attestation input limit is exceeded.

## Trust calibration

Successful source receipts are labeled:

`SOURCE_PROVENANCE_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_VERIFIER`

That label is intentional. This slice does **not** authenticate the verifier identity, prove that the external source is objectively true, provide cryptographic signing, or connect a production source-verifier provider.

Trust Admission remains:

`STRUCTURALLY_ADMITTED_UNAUTHENTICATED`

The system can now distinguish:

1. a model/claim merely carrying provenance metadata; from
2. a claim with a separately issued exact structural source-verification receipt.

It must not confuse either state with objective truth.

## Authority boundary

Source Attestation grants no execution authority.

It does not replace:

- Northstar role/state checks;
- Operation Truth comparison;
- SAB policy routing;
- independent human consent;
- pre-execution checks.

No executor, frontend behavior, n8n wiring, live Supabase work, production credential/provider, deployment or external side effect is introduced by this slice.

## Integration order

Current backend path:

```text
Gagamba signal
  -> Architecture FACT
  -> provenance ledger + integrity
  -> Source Attestation
  -> Trust Admission
  -> SAB / consent / pre-execution boundaries already present
  -> execution remains disconnected
```

This keeps Source Truth as a prerequisite to later action rather than allowing action capability to manufacture truth.
