# ROEM Phase 1 — Refinement Audit

Status: **applied on `feat/gagamba-agila-weave`; exact-head CI pending at time of authoring**

Scope: Refinement only. No new model agents, no new external integrations, no executor, no deployment, and no authority expansion.

## Baseline preserved

The existing architecture remains:

`GAGAMBA → ArchitecturePacket + IntentEnvelope → AGILA → NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY → UNATTESTED proposal → future adapter attestation → SAB → governed human authority`

Only `HT → MT` is executable in the current branch.

## Refinement findings

### R1 — Runtime signal taxonomy could accept an invalid kind

Previous behavior validated signal ID/text/confidence/source but did not validate `signal.kind` at runtime. A JavaScript or deserialized caller could provide a value outside the TypeScript union; the signal could be marked accepted even though no switch branch consumed it.

Refinement:

- add runtime allowlist validation for the seven supported signal kinds;
- invalid kinds are withheld with `invalid_signal_kind`;
- invalid kinds cannot become facts or other epistemic classes.

This adds no new capability. It closes ambiguity between compile-time typing and runtime truth.

### R2 — Candidate identifiers could be ambiguous after normalization

Previous behavior validated candidate IDs but did not reject two candidates whose IDs normalized to the same value, e.g. `candidate-a` and `  candidate-a  `.

Refinement:

- normalize candidate IDs at the architect boundary;
- require normalized candidate IDs to be unique;
- duplicate normalized IDs fail closed with `duplicate_candidate_id`.

This prevents ambiguous selection/binding without changing ranking capability.

### R3 — Equivalent IntentEnvelope sets could create meaningless binding drift

Allowed action types/scopes/sensitivities are semantically set-like, but their array order previously affected the deterministic packet binding.

Refinement:

- deduplicate and sort those set-like values during envelope validation;
- semantically equivalent envelope sets now bind identically when the rest of the packet is identical.

This reduces representational noise; it does not weaken or broaden policy.

### R4 — `estimatedCost` lacks production unit/currency semantics

The prototype contains numeric `estimatedCost` / `maxEstimatedCost` fields. Their runtime numeric behavior is testable, but a production financial-control claim would be unjustified without explicit unit/currency semantics.

Phase-1 decision:

- do not invent a currency model during Refinement;
- keep the existing prototype scalar for compatibility;
- explicitly classify it as **prototype-only** and not a production financial guarantee;
- defer unit/currency design to a later qualified Opportunity/Enhancement cycle.

## Golden Axiom compatibility

Phase 1 preserves the calibrated engineering rule:

> **Unclear intent is unresolved state, not executable state.**

The existing precedence remains:

1. hard `REJECT` → `NO_ACTION`;
2. otherwise unresolved unknown / `ASK_USER` → `RFI_REQUIRED`;
3. otherwise no justified candidate → `NO_ACTION`;
4. otherwise → `PROPOSAL_ONLY`.

## ROEM classification

| Change | Classification | New capability? |
| --- | --- | --- |
| runtime signal-kind allowlist | Refinement | No |
| normalized unique candidate IDs | Refinement | No |
| canonical ordering for set-like envelope fields | Refinement | No |
| cost-unit claim calibration | Refinement / claim subtraction | No |
| ROEM protocol documentation | Process refinement | No |

## Exit criteria

Phase 1 is complete only when the exact final head passes:

- TypeScript typecheck;
- all existing unit/adversarial tests;
- new Gagamba invalid-kind regression test;
- new duplicate-candidate regression test;
- new IntentEnvelope canonical-order regression test;
- dependency audit;
- portfolio accessibility regression contract;
- Sovereign Scaffold adversarial HTTP/API smoke test.

Until exact-head verification is green, status remains **REFINEMENT APPLIED / VERIFICATION PENDING**.
