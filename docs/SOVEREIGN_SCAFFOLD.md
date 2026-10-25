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

## Policy rule: unknown is not safe

The current policy deliberately refuses to turn missing metadata into harmless defaults.

Examples:

- unknown blast radius is not treated as zero,
- unknown estimated cost is not treated as free,
- unknown secret-bearing status is not treated as false,
- unknown read size is not treated as a bounded read.

A low-risk sandbox write is auto-admitted only when its relevant bounds are explicit: reversible, below the demo blast-radius threshold, zero estimated cost, explicitly non-secret, and limited to public/internal data.

## What the SAB currently does

The implementation in `src/sab.ts` performs consequence-aware routing from explicit proposal metadata:

- malformed or contradictory proposal metadata fails closed,
- unknown proposal fields are rejected without echoing attacker-controlled field names into the audit vocabulary,
- read access is sensitivity- and volume-aware rather than automatically trusted,
- bounded public reads may pass,
- bounded internal reads pass with logging,
- sensitive or secret reads require authority,
- unknown-size or bulk reads require authority,
- fully bounded reversible sandbox writes over public/internal data may pass with logging,
- incomplete low-risk metadata routes upward rather than inheriting safe defaults,
- production, external, destructive, financial, permission-changing, sensitive, or large-blast-radius mutations require human approval,
- attempted secret exfiltration across an external boundary is hard denied,
- authorization always recomputes the policy decision server-side,
- the browser cannot submit a trusted SAB verdict,
- approvals bind to the canonical complete proposal payload and active policy version,
- approval state is short-lived and one-time in the demo server.

`SAB_POLICY_VERSION` is exposed in decisions and approvals so authorization issued under a different policy revision is not silently reused.

## Demo thresholds are policy examples, not universal truths

The current prototype uses intentionally simple thresholds to make routing visible and testable. For example, the demo treats reads of 10,000 or more records as bulk reads and sandbox writes below 25 affected records as potentially bounded when every other low-risk condition is explicit.

Those numbers are **illustrative policy placeholders**, not empirical universal standards. A real deployment must define thresholds per domain, tenant, data class, tool capability, legal obligation, and business impact.

Likewise, `estimatedCost` is currently a scalar demo field. Before financial use it needs explicit currency/unit semantics and trusted derivation at the execution boundary.

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

Approval also carries the active policy version. Changing any bound proposal field or using an approval from another policy version invalidates authorization.

The current binding is deterministic but **not cryptographic**. A production version should cryptographically hash/sign the canonical proposal and bind the signature to an authenticated human identity and policy version.

## Interactive portfolio demo

The repository includes a zero-framework local demo under `demo/`.

Run:

```bash
npm ci
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

1. bounded public read-only data → allow,
2. sensitive large production write → human gate,
3. fully bounded reversible internal sandbox write → allow with log,
4. secret-bearing external output → hard deny.

The server owns the proposal ID for the approval lifecycle. `/api/authorize` accepts only a pending proposal ID; it does not accept a client-supplied decision or proposal payload. Successful demo authorization is one-time, which prevents immediate replay.

## HTTP and runtime hardening in this MVP

The local demo includes:

- JSON-only POST API boundary,
- same-origin checks when browser origin/fetch metadata is present,
- request body size limits,
- request/header/keep-alive timeouts,
- header count limits,
- runtime allowlist validation,
- fail-closed malformed or contradictory metadata,
- server-side policy recomputation,
- one-time pending approval state,
- bounded approval lifetime,
- policy-version matching,
- loopback-only default binding,
- static-file allowlisting,
- Content Security Policy,
- `X-Content-Type-Options: nosniff`,
- `Cross-Origin-Resource-Policy: same-origin`,
- no raw internal exception leakage to the browser,
- no raw proposal target persisted in the demo audit ledger,
- attacker-independent validation reason codes,
- DOM rendering with `textContent`/node construction for server-returned audit data.

## UX and accessibility hardening

The portfolio demo includes:

- visible keyboard focus styles,
- semantic button state via `aria-pressed`,
- polite live announcements for decisions and execution status,
- reduced-motion behavior,
- descriptive alternative text for the architecture flow,
- a CI regression check for normal-text contrast on the footer,
- a stale-response guard so an in-flight evaluation cannot silently overwrite a newly selected scenario.

This is an accessibility-oriented regression baseline, **not a claim of complete WCAG conformance**. A later public release should add browser-level automated and manual accessibility testing.

## Reproducible build and CI controls

The repository now includes:

- an npm lockfile,
- exact TypeScript version pinning,
- a Node 22 engine range,
- `npm ci --ignore-scripts` in CI,
- dependency audit at high severity,
- GitHub Actions pinned to exact commit SHAs,
- checkout credentials disabled after source retrieval.

CI exercises unit, adversarial, HTTP, accessibility-contract, dependency, and policy-regression checks.

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
- complete browser-level accessibility conformance testing,
- quantitative Free Energy minimization,
- prompt-injection prevention by persona logic.

### Critical production boundary: who is allowed to describe the action?

The current demo uses scripted proposal metadata. Runtime validation can prove that metadata has an allowed shape, but it **cannot prove that the metadata truthfully describes the real operation**.

A future model must therefore never be allowed to self-certify security-relevant facts such as:

- `type = READ`,
- `scope = SANDBOX`,
- `dataSensitivity = PUBLIC`,
- a small blast radius,
- zero cost,
- absence of secrets,
- reversibility,
- target identity.

Before any real execution adapter is connected, those fields must be derived or independently verified at the trusted tool/adapter boundary from the concrete operation being executed. The policy enforcement point must compare the attested execution metadata against the approved proposal and fail closed on disagreement.

This remains the highest-priority production blocker after this MVP. Schema validation protects the shape of a claim; adapter attestation must protect the truth of the claim.

The UI's approval button is a **demo operator simulating the Node Alpha role**. It is not proof of who clicked it.

The in-memory audit list is an ephemeral demonstration ledger, not a compliance-grade audit trail.

A public deployment should remain non-mutating until authentication, persistent audit storage, rate limiting, CSRF/session protections as applicable, metadata attestation at the execution boundary, and an execution-specific authorization layer are implemented and tested.

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

1. Define an execution-adapter attestation contract that derives/verifies action type, scope, target, sensitivity, reversibility, cost, secret status, and blast radius from the concrete tool call.
2. Persist SAB audit events and pending approvals in Supabase with append-only semantics where practical.
3. Add authenticated Node Alpha identity and cryptographically bound approvals.
4. Add one strictly sandboxed execution adapter with its own policy enforcement point and metadata attestation.
5. Connect one real model provider as Node Beta proposal generation; model-produced metadata remains untrusted until adapter verification.
6. Add rate limiting and public-demo abuse controls before internet exposure.
7. Add browser-level end-to-end and accessibility automation plus manual keyboard/screen-reader checks.
8. Replace illustrative thresholds with domain-specific policy and explicit cost units.
9. Deploy the portfolio demo only after the public threat model is reviewed.

## Design rule

Do not make the language stronger than the implementation.

The system earns stronger claims by adding measurable controls, not by adding stronger adjectives.
