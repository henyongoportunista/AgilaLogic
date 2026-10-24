# Sovereign Scaffold MVP

**Status:** Working prototype architecture

Sovereign Scaffold is the bounded-authority execution layer for AgilaLogic. Its core principle is simple:

> Capability is not authority.

AI components may observe, retrieve, reason, rank, draft, and propose. Consequential actions must cross an explicit deterministic admission boundary before execution.

## Runtime flow

```text
Node Beta proposal
      ↓
Sovereign Assurance Boundary (SAB)
      ↓
ALLOW / ALLOW_WITH_LOG / REQUIRE_HUMAN_APPROVAL / DENY
      ↓
Node Alpha authorization when required
      ↓
Execution adapter
      ↓
Audit + outcome verification
```

## What the SAB currently does

The first implementation in `src/sab.ts` performs consequence-aware routing using explicit action metadata:

- read-only actions may pass automatically,
- bounded reversible sandbox writes may pass with logging,
- production, external, destructive, financial, permission-changing, or large-blast-radius actions require human approval,
- attempted secret exfiltration is denied rather than made approval-bypassable,
- approvals are bound to one exact proposal ID, action type, and target.

## What the SAB does not claim yet

This prototype does **not** yet claim:

- cryptographic signatures,
- mTLS enforcement,
- physically air-gapped infrastructure,
- formal verification,
- production-grade identity attestation,
- quantitative Free Energy minimization,
- prompt-injection prevention by persona logic.

Those belong to later implementation phases and should only be presented publicly once measurable controls exist.

## Relationship to AgilaLogic

AgilaLogic already provides the reasoning and decision spine:

```text
OBSERVE → FILTER → CALCULATE → DECIDE → ACT → VERIFY → STORE → RECALIBRATE
```

Sovereign Scaffold strengthens the transition from **DECIDE** to **ACT** by introducing an explicit admission layer between a proposed action and execution.

## Demo target

A minimal portfolio demo should allow a visitor to submit a proposed action such as:

```text
Delete 47 inactive customer records.
```

The interface should render the resulting SAB decision:

```text
Action: DELETE
Scope: PRODUCTION
Records affected: 47
Reversible: NO
Consequence: HIGH
Route: REQUIRE_HUMAN_APPROVAL
```

The user may then approve or reject the exact action. Any drift in target, action type, or proposal identity invalidates the approval.

## Next implementation steps

1. Add a thin API endpoint around `evaluateProposal()`.
2. Add an append-only audit event schema in Supabase.
3. Add an approval record table with expiration and exact action binding.
4. Add one real execution adapter in sandbox mode.
5. Add a simple portfolio UI that visualizes Node Beta → SAB → Node Alpha.
6. Add CI checks for SAB tests and policy regressions.

## Design rule

Do not make the language stronger than the implementation.

The system earns stronger claims by adding measurable controls, not by adding stronger adjectives.
