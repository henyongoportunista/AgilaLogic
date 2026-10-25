# Gagamba × Agila weave

Status: **experimental integration contract**

This document connects Sal's **Master Architecture of Self-Awareness / Gagamba Logic** (primary human-supplied source dated 2026-10-10) with Bjorn's **AgilaLogic** without flattening the two architectures into one persona system.

Personal contact details and symbolic identity coordinates from the source are intentionally omitted from this repository because they are not required for executable behavior.

## One system, different responsibilities

```text
RAW SIGNALS / HUMAN INTENT
        |
        v
GAGAMBA WEAVE
observe, separate, subtract noise, preserve uncertainty
        |
        v
AGILALOGIC
filter, identify gaps/resources, adapt, rank, select, gate
        |
        v
SOVEREIGN ASSURANCE BOUNDARY
validate concrete action metadata and consequence route
        |
        v
HUMAN AUTHORITY / FUTURE TRUSTED ADAPTER
```

The boundary is intentional:

- **Gagamba** is the observation/intake/signal-weaving layer.
- **Agila** is the evaluation/leverage/decision layer.
- **SAB** is the authority boundary between a proposal and consequential execution.

None of these labels prove that the complete psychological, neuroscientific, symbolic, or philosophical source architecture has been implemented in software.

## Gagamba source preserved as concept

Canonical seven HT personas in the supplied source:

`HT · PH · TM · MG · KP · MM · EI`

The source also defines:

- Core Pattern Recognition / Sloth & Diligence
- Gagamba Logic (Intuition + Logic)
- seven Paradoxical Wisdom Contracts
- seven Committed First-Root-Principles
- Habi-Habi-Logical Metaboboloop
- nine synthesis steps
- 34 Ethos
- seven persona workflows

These remain **human architecture inputs** unless a specific behavior is translated into a tested software contract.

## First executable seam

`src/gagamba.ts` implements only a narrow operational translation:

```text
GagambaSignal[]
  -> validate + normalize + deduplicate
  -> preserve FACT separately
  -> keep INFERENCE/PREDICTION as validation gaps
  -> convert explicit PREFERENCE into a human constraint
  -> preserve UNKNOWN / CONSTRAINT / RESOURCE
  -> ObservationInput
  -> existing AgilaLogic decide()
```

Core epistemic invariant:

> **Inference and prediction must not silently become fact.**

Duplicate or malformed signals are withheld from the woven observation and recorded in a trace. This trace is diagnostic metadata, not a durable audit ledger.

## Current mapping discipline

Use these labels when extending the weave:

- `DIRECT_IMPLEMENTATION` — behavior is explicitly implemented and tested.
- `OPERATIONAL_ANALOGUE` — software behavior resembles a source concept but is not the concept itself.
- `PROPOSED_TRANSLATION` — candidate future software mechanism.
- `USER_CONCEPT` — source vocabulary/philosophy supplied by the human architect.
- `RESEARCH_CLAIM_PENDING_EVIDENCE` — empirical/scientific claim not established by this repository.

Do not convert an analogy into an implementation claim merely because the names or behavior sound similar.

## Current direct implementation

| Source concern | Software contract | Evidence class |
| --- | --- | --- |
| Separate truth from interpretation | FACT is kept separate from INFERENCE/PREDICTION | `DIRECT_IMPLEMENTATION` |
| Own the not-knowing | INFERENCE/PREDICTION become explicit validation gaps for Agila | `DIRECT_IMPLEMENTATION` |
| Subtract duplicate/noisy inputs | duplicate IDs/content and malformed signals are withheld | `DIRECT_IMPLEMENTATION` |
| Human intent remains visible | PREFERENCE becomes an explicit `human_preference` constraint | `DIRECT_IMPLEMENTATION` |
| Gagamba feeds Agila without replacing it | woven output is structurally compatible with `ObservationInput` | `DIRECT_IMPLEMENTATION` |

## Not implemented by this weave

This integration does **not** claim:

- quantitative Free Energy minimization;
- Active Inference implementation;
- neurobiological mechanisms or measured allostatic savings;
- autonomous persona rotation;
- RAG or external retrieval merely because the metaphor uses a web;
- prompt-injection immunity;
- cryptographic human identity or approval;
- a live model provider;
- a real execution adapter;
- that Gagamba's seven personas are one-to-one equivalents of Agila's seven modules.

## Governance vs transaction authority

Human sovereignty and hard policy denial are not contradictory when kept on different planes:

- **Governance plane:** an authorized human can deliberately review and change policy/version/system design.
- **Transaction plane:** a normal approval for one proposal cannot override an active SAB hard-deny invariant.

Changing policy is a separate governed action, not a hidden escape hatch inside a transaction approval.

## Next safe experiment

After this seam is green, the smallest useful next increment is:

1. accept a bounded human brief;
2. convert explicit statements into typed Gagamba signals;
3. weave them into `ObservationInput`;
4. pass them through `decide()`;
5. render the decision as a **proposal only**;
6. if a concrete external action is later introduced, independently attest the real operation before SAB evaluation.

Do not connect production credentials or a mutation-capable executor as part of this experiment.
