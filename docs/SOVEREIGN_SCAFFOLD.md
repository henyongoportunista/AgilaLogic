# Sovereign Scaffold MVP

**Status:** Working prototype architecture + local interactive demo

Sovereign Scaffold is the bounded-authority execution layer for AgilaLogic. Its core principle is simple:

> Capability is not authority.

AI components may observe, retrieve, reason, rank, draft, and propose. Consequential actions must cross an explicit deterministic admission boundary before execution authority is granted.

## Runtime flow

```text
Node Beta proposal
      ↓
Runtime schema validation
      ↓
Sovereign Assurance Boundary (SAB)
      ↓
ALLOW / ALLOW_WITH_LOG / REQUIRE_HUMAN_APPROVAL / DENY
      ↓
Human authorization role when required
      ↓
Execution adapter (not connected in this MVP)
      ↓
Audit + outcome verification
```

## What the SAB currently does

The implementation in `src/sab.ts` performs consequence-aware routing from explicit proposal metadata:

- malformed or ambiguous proposal metadata fails closed,
- unknown proposal fields are rejected,
- read access is sensitivity-aware rather than automatically trusted,
- public reads may pass,
- internal reads pass with logging,
- sensitive or secret reads require authority,
- bounded reversible sandbox writes over public/internal data may pass with logging,
- production, external, destructive, financial, permission-changing, sensitive, or large-blast-radius mutations require human approval,
- attempted secret exfiltration across an external boundary is hard denied,
- authorization always recomputes the policy decision server-side,
- the browser cannot submit a trusted SAB verdict,
- approvals bind to the canonical complete proposal payload rather than only ID/type/target,
- approval state is short-lived and one-time in the demo server.

## Approval integrity

A proposal binding covers every field present in the validated proposal, including:

- action type,
- scope,
- target,
- reversibility,
- data sensitivity,
- blast radius,
- estimated cost,
- secret-bearing status,
- proposal identity.

Changing any bound field after approval invalidates that approval.

The current binding is deterministic but **not cryptographic**. A production version should cryptographically hash/sign the canonical proposal and bind the signature to an authenticated human identity and policy version.

## Interactive portfolio demo

The repository includes a zero-framework local demo under `demo/`.

Run:

```bash
npm install
npm run demo
```

Then open:

```text
http://127.0.0.1:4173
```

The demo listens on loopback by default. `HOST` must be explicitly changed to expose it beyond the local machine.

The HTTP surface is:

- `GET /api/health`
- `POST /api/evaluate`
- `POST /api/authorize`
- `POST /api/reject`
- `GET /api/audit`

The browser UI demonstrates four policy paths:

1. public read-only production data → allow,
2. sensitive large production write → human gate,
3. bounded reversible internal sandbox write → allow with log,
4. secret-bearing external output → hard deny.

The server owns the proposal ID for the approval lifecycle. `/api/authorize` accepts only a pending proposal ID; it does not accept a client-supplied decision or proposal payload. Successful demo authorization is one-time, which prevents immediate replay.

## Security hardening in this MVP

The local demo includes:

- request body size limits,
- runtime allowlist validation,
- fail-closed malformed metadata,
- server-side policy recomputation,
- one-time pending approval state,
- bounded approval lifetime,
- loopback-only default binding,
- static-file allowlisting,
- Content Security Policy,
- `X-Content-Type-Options: nosniff`,
- no raw internal exception leakage to the browser,
- DOM rendering with `textContent`/node construction for server-returned audit data.

CI exercises both happy-path and adversarial cases, including forged authorization payloads, replay attempts, malformed metadata, hard-deny secret exfiltration, and security headers.

## Explicit non-claims / residual risk

This prototype deliberately does **not** claim:

- authenticated Node Alpha identity,
- cryptographic approval signatures,
- tamper-evident or persistent audit storage,
- mTLS enforcement,
- physically air-gapped infrastructure,
- formal verification,
- rate limiting / abuse protection for public deployment,
- production authorization or tenant isolation,
- a real external execution adapter,
- a real model-provider proposal adapter,
- quantitative Free Energy minimization,
- prompt-injection prevention by persona logic.

The UI's approval button is a **demo operator simulating the Node Alpha role**. It is not proof of who clicked it.

The in-memory audit list is an ephemeral demonstration ledger, not a compliance-grade audit trail.

A public deployment should remain non-mutating until authentication, persistent audit storage, rate limiting, CSRF/session protections as applicable, and an execution-specific authorization layer are implemented and tested.

## Relationship to AgilaLogic

AgilaLogic already provides the reasoning and decision spine:

```text
OBSERVE → FILTER → CALCULATE → DECIDE → ACT → VERIFY → STORE → RECALIBRATE
```

Sovereign Scaffold strengthens the transition from **DECIDE** to **ACT** by introducing a deterministic policy/admission layer between a proposed action and execution authority.

## Current MVP slice

```text
Scenario / Node Beta proposal
          ↓
 schema validation
          ↓
     SAB evaluation
          ↓
 ┌────────┼───────────────┐
ALLOW   HUMAN GATE       DENY
 │         │               │
 │   demo approve/veto     │
 └─────────┴───────┬───────┘
                   ↓
           ephemeral audit
```

This is intentionally narrow. It proves the central control boundary before adding external agent providers or production mutation adapters.

## Next implementation steps

1. Persist SAB audit events and pending approvals in Supabase with append-only semantics where practical.
2. Add authenticated Node Alpha identity and cryptographically bound approvals.
3. Add one strictly sandboxed execution adapter with its own policy enforcement point.
4. Connect one real model provider as Node Beta proposal generation.
5. Add rate limiting and public-demo abuse controls before internet exposure.
6. Add policy-version binding and regression cases as new action classes are introduced.
7. Deploy the portfolio demo only after the public threat model is reviewed.

## Design rule

Do not make the language stronger than the implementation.

The system earns stronger claims by adding measurable controls, not by adding stronger adjectives.
