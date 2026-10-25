# Unified Golden Axiom — Round 2 Audit / Red-Team / Recalibration

Status: **human canon + calibrated technical translation**

## Verbatim human canon

> **"Ignorance happens when you fail express your own thoughts clearly enough to be understood by anyone, and it only means you haven't really met yourself inside out"**

This sentence is preserved verbatim as the supplied **Unified Golden Axiom** for the Gagamba-Agila architecture.

## Red-team finding

The axiom is useful as a design philosophy, but its literal wording is too absolute to be treated as an empirical or psychological law.

A communication failure can come from many sources:

- incomplete self-understanding;
- incomplete evidence;
- ambiguous language;
- missing shared context;
- domain mismatch between sender and receiver;
- cognitive or accessibility differences;
- deliberate adversarial interpretation;
- limits of the communication channel itself.

Therefore the repository must not claim that every misunderstanding proves ignorance or proves that the speaker does not know themselves.

## Calibrated executable translation

> **Unclear intent is unresolved state, not executable state.**

Operationally:

1. the architect must express an objective;
2. success criteria must be explicit;
3. strategic limits must be machine-checkable where feasible through the `ArchitectureIntentEnvelope`;
4. facts, assumptions, predictions and unknowns remain separate;
5. the engineer may not silently infer missing strategic intent;
6. unresolved understanding returns `RFI_REQUIRED`;
7. `RFI_REQUIRED` cannot become an action proposal;
8. clarity is measured by inspectable structure and testable boundaries, not by verbosity or rhetorical confidence.

## Round-2 control-flow correction

The previous strand logic evaluated passive `NO_ACTION` before unresolved interpretation in some cases.

That created this failure mode:

```text
UNKNOWN / ambiguous state
        +
no selected candidate
        ↓
NO_ACTION
```

This is semantically wrong because **absence of a selected action does not prove the problem is understood**.

The refined precedence is:

```text
hard REJECT
   ↓
NO_ACTION

otherwise, unresolved unknown / ASK_USER
   ↓
RFI_REQUIRED

otherwise, no justified candidate
   ↓
NO_ACTION

otherwise
   ↓
PROPOSAL_ONLY
```

Design rule:

> **Ambiguity outranks inactivity; a hard reject remains a valid stop condition.**

## Why this matters to the 7×7 architecture

The Golden Axiom is not a fifteenth persona and does not grant authority.

It is a **handoff invariant** across every future strand:

```text
GAGAMBA ARCHITECT
      ↓
Can the intent be stated, bounded and questioned?
      ↓
No → RFI / clarify
Yes
      ↓
AGILA ENGINEER
      ↓
Can implementation remain inside that intent?
      ↓
No → RFI / contradiction
Yes
      ↓
UNATTESTED PROPOSAL
```

For future strands, each architect→engineer contract should define:

- what must be understood before delegation;
- what ambiguity requires RFI;
- what the engineer is forbidden to infer;
- what can be machine-checked;
- what still requires human interpretation.

## What this axiom does not mean

It does not mean:

- longer explanations are automatically clearer;
- a confident explanation is true;
- the receiver is never responsible for misunderstanding;
- self-knowledge can be proven from linguistic fluency;
- ambiguity may be erased merely to keep workflow moving;
- human intent becomes execution authority once articulated.

The authority chain remains unchanged:

`architecture intent → engineering proposal → trusted operation truth → SAB policy route → human authority when required`.

## Evidence label

- Original sentence: `USER_CONCEPT / HUMAN_CANON`
- Technical translation: `PROPOSED_DESIGN` now partially `IMPLEMENTED + TESTED` in the HT→MT strand
- Psychological claim that misunderstanding proves incomplete self-knowledge: `HYPOTHESIS`, not established by this repository

## Round-2 invariant

> **If the system does not understand enough to explain what it believes the intent is, what remains unknown, and what it is forbidden to infer, it is not ready to act.**
