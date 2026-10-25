# Universal Protocol — ROEM

Status: **canonical quality/evolution protocol for the experimental Gagamba × Agila integration**

ROEM means:

`REFINEMENT → OPPORTUNITIES → ENHANCEMENT → MITIGATION`

ROEM is a quality-control loop, not a persona, permission system, execution token, or replacement for SAB.

> **Improve what exists, expose what it enables, strengthen only what matters, then contain what can fail.**

## R — Refinement

Question:

> What already works, and what ambiguity, duplication, contradiction, or unnecessary motion can be removed without inventing new capability?

Allowed work:

- subtract ambiguity and duplicate state;
- tighten existing contracts and validation;
- normalize equivalent representations;
- repair contradictions;
- calibrate claims to implementation;
- preserve behavior that is already tested and justified.

Phase-1 rule:

> **Do not add a new capability merely to solve a clarity problem.**

Exit evidence:

- exact changed surface is known;
- previous guarantees remain intact;
- new refinement invariants are tested;
- exact-head CI is green;
- no merge/deploy/authority escalation is implied.

## O — Opportunities

Question:

> After the baseline is clear, what material leverage or missing capability becomes visible?

An opportunity is not automatically a feature request. It must identify what materially changes if pursued.

Output is a qualified opportunity set, not implementation authority.

## E — Enhancement

Question:

> Which qualified opportunity produces demonstrable improvement without silently changing architectural intent?

Enhancement may add capability, but only against explicit architecture, evidence, tests, and authority boundaries.

## M — Mitigation

Question:

> How can the refined/enhanced system fail, be abused, drift, leak, or create unintended consequence?

Mitigation may reject an enhancement and return the system to Refinement.

## Loop

```text
CURRENT REALITY
      |
      v
REFINEMENT
      |
      v
OPPORTUNITIES
      |
      v
ENHANCEMENT
      |
      v
MITIGATION
      |
      v
EVIDENCE / RECALIBRATE
      |
      `------> REFINEMENT
```

ROEM is cyclic. A valid cycle may conclude that no enhancement is necessary.

## Gagamba × Agila mapping

Default responsibility bias:

```text
GAGAMBA ARCHITECTURE
  R — clarify / subtract / bind intent
  O — expose qualified leverage
          |
          v
AGILA ENGINEERING
  E — translate justified improvement into bounded engineering
          |
          v
RED TEAM / TRUST BOUNDARIES
  M — attack assumptions, reduce blast radius, verify failure handling
          |
          v
SAB
  deterministic authority route
          |
          v
NODE ALPHA / HUMAN GOVERNANCE
```

This is not a hard ownership map. Relevant disciplines may cross-review any phase, but persona identity never grants permissions.

## Universal invariants

1. Reality before improvement.
2. Unknown is not permission.
3. Opportunity is not obligation.
4. Enhancement is not automatically progress.
5. Mitigation may veto enhancement.
6. Evidence outranks confidence.
7. Working behavior is preserved unless a demonstrated improvement justifies changing it.
8. Failure returns to Refinement instead of being narrated as success.
9. No persona, agent consensus, model confidence, or ROEM phase creates execution authority.
10. Human governance remains outside optimization and retains the governed policy/approval role.

## ROEM exit test

- **R:** Is the system clearer and less contradictory than before?
- **O:** Is there material leverage worth considering?
- **E:** Is there a demonstrable improvement rather than additional complexity?
- **M:** Is the risk introduced by that improvement bounded and evidenced?

Unresolved answer → `RECALIBRATE`.

All defensible → `ROEM PASS`.

`ROEM PASS` is a quality conclusion only. It is not SAB authorization, human approval, deployment permission, or execution authority.
