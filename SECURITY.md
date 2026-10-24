# Security Policy

AgilaLogic is designed around bounded authority, explicit approvals, evidence-backed execution, and fail-closed uncertainty.

## Core security rules

- Never expose service-role keys, access tokens, passwords, OTPs, reset codes, or similar secrets.
- Never treat a connected tool as implicitly writable.
- Never escalate from read to write without explicit permission.
- Never interpret approval for one action as approval for another.
- Never fabricate execution, verification, or evidence.
- Never send, merge, delete, pay, deploy, or perform another consequential external action without explicit bounded authority.
- Never treat missing risk metadata as a harmless default: **unknown is not safe**.
- Never allow a model to self-certify the security properties of the concrete tool operation it wants to execute.

## Approval semantics

Approvals are action-specific, proposal-bound, time-bounded, and policy-version-bound.

Examples:

- `gmail/create_draft` does not authorize `gmail/send`.
- `github/write_file:README.md` does not authorize writing another file.
- approval for 5 sandbox records does not authorize 5,000 production records.
- approval issued under one policy version does not silently authorize the same proposal after policy changes.
- a security review does not authorize an outbound message.

If the concrete requested action does not exactly match the granted permission and attested execution metadata, execution must stop.

## Metadata trust boundary

Schema validation only validates the shape and internal consistency of proposal metadata. It does not prove that the metadata truthfully describes the real operation.

Before a real execution adapter is connected, the trusted adapter/policy-enforcement boundary must derive or independently verify security-relevant facts from the concrete tool call, including where applicable:

- action type,
- scope/environment,
- target,
- data sensitivity,
- reversibility,
- blast radius,
- estimated cost and units,
- secret-bearing status.

Model-produced metadata is advisory until verified. A mismatch between the approved proposal and adapter-attested operation must fail closed.

## Secret and audit handling

Secrets must not be persisted in logs, prompts, evidence payloads, or user-visible output.

Sensitive authentication content such as OTPs, reset links with embedded tokens, API keys, bearer tokens, session cookies, and similar credentials must be redacted or excluded from the agent event store.

Audit records should minimize unnecessary resource identifiers and must not echo attacker-controlled validation text. Validation/audit reason codes should come from a fixed controlled vocabulary rather than raw input.

The current demo audit is in-memory and ephemeral. It is not a compliance-grade or tamper-evident audit trail.

## Tool boundaries

Read access is not automatically low risk. Read policy must account for data sensitivity, volume, tenant scope, and downstream exposure.

Reversible writes remain approval-gated unless a deliberately bounded sandbox policy explicitly permits them. Irreversible, external, financial, permission-changing, or otherwise high-risk actions remain disabled or authority-gated until separately tested and authorized.

Current examples:

- Gmail: read enabled where authorized; create draft approval-gated; send/archive/label/delete disabled.
- GitHub: read enabled where authorized; file write approval-gated; branch/issue/comment/PR/merge disabled by default.
- Calendar: read-only in the current phase.
- Drive: read-only reference monitoring in the current phase.

## Public HTTP boundary

The local Sovereign Scaffold demo is non-mutating and loopback-bound by default. It includes request-size/time limits, JSON-only POST handling, same-origin checks when browser request metadata is present, security headers, and bounded pending/audit state.

This does not replace production authentication, authorization, rate limiting, tenant isolation, CSRF/session protections as applicable, or a reverse-proxy/WAF strategy.

## Supply-chain controls

The repository uses a committed npm lockfile and reproducible `npm ci` installation in CI. GitHub Actions are pinned to exact commit SHAs, checkout credentials are not persisted, dependency install scripts are disabled in CI, and high-severity dependency audit findings fail the workflow.

These controls reduce supply-chain uncertainty; they do not eliminate it. Dependency/action updates should be reviewed deliberately rather than floated silently.

## Failure behavior

On uncertainty, missing context, incomplete risk metadata, tool failure, policy-version mismatch, or permission mismatch:

1. stop or route upward,
2. record a non-sensitive blocked reason,
3. preserve uncertainty,
4. require explicit authority or trusted verification when needed.

The system must never guess its way through a security boundary.

## Evidence and verification

External writes must produce verifiable evidence. A write is not considered complete until the resulting external state can be read back or otherwise confirmed.

## Reporting

If you discover a security issue, do not publish exploit details or secrets in issues or commits. Record the minimal reproducible description and remediation path privately until the issue is contained.
