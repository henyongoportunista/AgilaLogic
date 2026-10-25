# Gagamba × Agila Weave

Status: **experimental integration contract**

This document connects Sal's **Master Architecture of Self-Awareness / Gagamba Logic** with Bjorn's **AgilaLogic** without flattening the two architectures into one persona system.

For the canonical technical topology, authority boundaries and current implementation status, see [`UNIFIED_ARCHITECTURE.md`](UNIFIED_ARCHITECTURE.md).

Personal contact details and symbolic identity coordinates from the source are intentionally omitted because they are not required for executable behavior.

## One system, different responsibilities

```text
RAW SIGNALS / HUMAN INTENT
        |
        v
GAGAMBA WEAVE
separate facts, interpretations, predictions, unknowns and preferences
        |
        v
GAGAMBA ARCHITECT DISCIPLINE(S)
define intent, invariants and machine-checkable strategic bounds
        |
        v
AGILA ENGINEER DISCIPLINE(S)
engineer against bound intent; return proposal / RFI / no-action
        |
        v
UNATTESTED ACTION PROPOSAL
        |
        v
TRUSTED ADAPTER ATTESTATION       [future]
        |
        v
SAB POLICY BOUNDARY
        |
        v
HUMAN AUTHORITY WHEN REQUIRED
```

The boundaries are intentional:

- **Gagamba** owns observation, architectural framing and intent constraints.
- **Agila** owns bounded engineering, evaluation and proposal construction.
- **Trusted adapters** must eventually establish concrete operation truth independently of model self-report.
- **SAB** is the deterministic authority boundary between a concrete proposal and consequential execution.
- **Node Alpha / the human** governs architecture/policy and provides approval when policy requires it.

None of these labels prove that the complete psychological, neuroscientific, symbolic or philosophical source architecture has been implemented in software.

## Canonical Gagamba source set

`HT · PH · TM · MG · KP · MM · EI`

The supplied source also defines:

- Core Pattern Recognition / Sloth & Diligence;
- Gagamba Logic (Intuition + Logic);
- seven Paradoxical Wisdom Contracts;
- seven Committed First-Root-Principles;
- Habi-Habi-Logical Metaboboloop;
- nine synthesis steps;
- 34 Ethos;
- seven persona workflows.

These remain **human architecture inputs** unless a specific behavior is translated into a tested software contract.

## First executable seam

`src/gagamba.ts` implements a narrow epistemic translation:

```text
GagambaSignal[]
  → validate + normalize + deduplicate
  → preserve FACT separately
  → keep INFERENCE/PREDICTION as explicit validation gaps
  → convert explicit PREFERENCE into a human constraint
  → preserve UNKNOWN / CONSTRAINT / RESOURCE
  → ObservationInput
```

Core invariant:

> **Inference and prediction must not silently become fact.**

Duplicate or malformed signals are withheld from the woven observation and recorded in a diagnostic trace. That trace is not a durable audit ledger.

## First executable strand

`src/strand.ts` implements only `HT → MT`:

```text
Gagamba weave
  → HT ArchitecturePacket
  → machine-checkable IntentEnvelope
  → MT recomputes Agila decide() from bound architecture
  → NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY
  → optional UNATTESTED proposal candidate
```

The current strand enforces:

- packet drift detection through deterministic non-cryptographic bindings;
- runtime validation of candidate metrics;
- machine-checkable strategic intent bounds;
- no caller-supplied engineering verdict;
- unresolved uncertainty returns `RFI_REQUIRED`;
- proposal generation only from `PROPOSAL_ONLY` state;
- proposals outside architected intent are rejected before SAB preview;
- engineering metadata remains explicitly `UNATTESTED`.

The IntentEnvelope constrains what engineering may propose. It does **not** authenticate or independently verify the real operation.

## Mapping discipline

Use these labels consistently:

- `IMPLEMENTED` — executable behavior exists;
- `TESTED` — behavior passed a stated test on an exact source revision;
- `OPERATIONAL_ANALOGUE` — software behavior resembles a source concept but is not the concept itself;
- `PROPOSED_DESIGN` — intended mechanism without current implementation;
- `RESEARCH_SUPPORTED` — external evidence supports the narrow stated claim;
- `HYPOTHESIS` — plausible architecture claim not yet established by this project;
- `UNATTESTED` — generated operation metadata has not been independently verified;
- `UNKNOWN` — missing or unresolved evidence.

Do not convert an analogy, hypothesis or proposal into an implementation claim merely because the names or behavior sound similar.

## Not implemented by this weave

This integration does **not** claim:

- quantitative Free Energy minimization;
- Active Inference implementation;
- neurobiological mechanisms or measured allostatic savings;
- autonomous persona rotation;
- RAG merely because the metaphor uses a web;
- prompt-injection immunity;
- cryptographic packet signing;
- authenticated human identity;
- trusted adapter attestation;
- conformal risk control;
- TEE / hardware-rooted guardrail proof;
- a live model provider;
- a real mutation-capable execution adapter.

## Governance vs transaction authority

Human sovereignty and hard policy denial live on different planes:

- **Governance plane:** an authorized human may deliberately review/change policy, version or system design.
- **Transaction plane:** ordinary approval for one proposal cannot override an active SAB hard-deny invariant.

Changing policy is a separate governed action, not a hidden transaction escape hatch.

## Expansion rule

Do not implement the other six strands by copy-paste alone.

Each new strand must define:

1. unique architect responsibility;
2. machine-checkable strategic bounds where possible;
3. engineer prohibitions;
4. an explicit RFI/contradiction path;
5. independent review for consequential work;
6. adversarial tests;
7. exact-head verification before executable routing.
