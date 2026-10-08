# Security Policy

AgilaLogic is designed around bounded authority, explicit approvals, and evidence-backed execution.

## Core security rules

- Never expose service-role keys, access tokens, passwords, OTPs, reset codes, or similar secrets.
- Never treat a connected tool as implicitly writable.
- Never escalate from read to write without explicit permission.
- Never interpret approval for one action as approval for another.
- Never fabricate execution, verification, or evidence.
- Never send, merge, delete, or perform another irreversible external action without explicit bounded authority.

## Approval semantics

Approvals are action-specific. Examples:

- `gmail/create_draft` does not authorize `gmail/send`.
- `github/write_file:README.md` does not authorize writing another file.
- a security review does not authorize an outbound message.

If the requested action does not exactly match the granted permission, execution must stop.

## Secret handling

Secrets must not be persisted in logs, prompts, evidence payloads, or user-visible output.

Sensitive authentication content such as OTPs, reset links with embedded tokens, API keys, bearer tokens, session cookies, and similar credentials must be redacted or excluded from the agent event store.

## Tool boundaries

Read access may be enabled where useful. Reversible writes remain approval-gated. Irreversible or high-risk actions remain disabled by default until separately tested and authorized.

Current examples:

- Gmail: read enabled; create draft approval-gated; send/archive/label/delete disabled.
- GitHub: read enabled; file write approval-gated; branch/issue/comment/PR/merge disabled by default.
- Calendar: read-only in the current phase.
- Drive: read-only reference monitoring in the current phase.

## Failure behavior

On uncertainty, missing context, tool failure, or permission mismatch:

1. stop execution,
2. record the blocked reason,
3. preserve uncertainty,
4. ask for explicit authority when needed.

The system must never guess its way through a security boundary.

## Evidence and verification

External writes must produce verifiable evidence. A write is not considered complete until the resulting external state can be read back or otherwise confirmed.

## Reporting

If you discover a security issue, do not publish exploit details or secrets in issues or commits. Record the minimal reproducible description and remediation path privately until the issue is contained.
