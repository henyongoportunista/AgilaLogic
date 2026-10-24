# Sovereign Scaffold MVP

**Status:** Working prototype architecture + local interactive demo

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

## Interactive portfolio demo

The repository includes a zero-framework local demo under `demo/`.

Run:

```bash
npm install
npm run demo
```

Then open:

```text
http://localhost:4173
```

The demo exposes a thin local HTTP API backed by the real compiled `src/sab.ts` implementation:

- `GET /api/health`
- `POST /api/evaluate`
- `POST /api/authorize`
- `POST /api/reject`
- `GET /api/audit`

The browser UI demonstrates four policy paths:

1. read-only production access,
2. a large production write requiring Node Alpha approval,
3. a bounded reversible sandbox write,
4. attempted external secret exfiltration resulting in a hard deny.

Approvals are short-lived and bound to the exact proposal ID, action type, and target. The demo intentionally contains **no real external execution adapter**, so approval demonstrates authorization without mutating production systems.

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

## Current MVP slice

```text
Scenario / Node Beta proposal
          ↓
     SAB evaluation
          ↓
 ┌────────┼───────────────┐
ALLOW   HUMAN GATE       DENY
 │         │               │
 │      approve/veto       │
 └─────────┴───────┬───────┘
                   ↓
             audit ledger
```

This is intentionally narrow. It proves the central control boundary before adding external agent providers or production mutation adapters.

## Next implementation steps

1. Persist SAB audit events and approval records in Supabase.
2. Add one strictly sandboxed execution adapter.
3. Connect one real model provider as Node Beta proposal generation.
4. Add authenticated Node Alpha identity and signed approvals.
5. Deploy the portfolio demo to a public environment.
6. Add policy-regression cases as new action classes are introduced.

## Design rule

Do not make the language stronger than the implementation.

The system earns stronger claims by adding measurable controls, not by adding stronger adjectives.
