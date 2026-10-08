# AgilaLogic Architecture

This document describes the current technical architecture of **Henyong Oportunista OS**.

## 1. Operating principle

The system is built around a strict execution spine:

`OBSERVE → FILTER → CALCULATE → DECIDE → ACT → VERIFY → STORE → RECALIBRATE`

No component is allowed to jump directly from observation to external action.

The state machine is:

`OBSERVED → UNDERSTOOD → CANDIDATE → EVALUATED → DECIDED → AUTHORIZED → EXECUTED → VERIFIED → LEARNED`

## 2. Orchestrator model

Henyong Oportunista uses **one orchestrator plus deterministic cognitive modules**.

The system deliberately avoids starting with multiple independent LLM agents. Deterministic logic handles scoring, gating, confidence, retries, idempotency, and permission checks. Fuzzy language interpretation may be added only where deterministic logic is insufficient.

## 3. Seven cognitive modules

### MT — Selective Efficiency
Filters low-value motion. Candidate actions survive when expected value or information gain justifies attention.

### UM — Disciplined Literacy
Scans explicit unknowns and unresolved constraints. Knowledge gaps are first-class state, not hidden uncertainty.

### UO — Sovereign Resourcefulness
Inventories available resources and capabilities. Desire is treated as energy, not authority.

### IW — Constructive Adaptation
Adjusts candidate confidence when risk is high and reversibility is low. The goal is adaptation to reality without abandoning truth.

### HO — Sustainable Leverage
Ranks candidate actions by value, timing, confidence, reversibility, information gain, cost, and risk.

### KM — Proportional Response
Chooses the smallest sufficient action among viable options, preferring lower cost and lower risk when scores are close.

### MB — Calibrated Skepticism
Applies the final gate. It can observe only, recommend, draft, ask the user, reject, or allow bounded automation depending on risk, confidence, unknowns, reversibility, and autonomy level.

## 4. Integrity Kernel

Every event must maintain a separation between:

- facts,
- inferences,
- predictions,
- preferences,
- unknowns.

Core rules:

1. Never fabricate evidence.
2. Confidence must remain proportional to evidence.
3. Failures must not be rewritten as successes.
4. A principle cannot override contradictory reality.
5. When prediction and reality diverge, update the model before defending the prediction.

## 5. Database layer

Supabase Postgres stores the agent's operational state.

Core tables include:

- `agents`
- `observations`
- `opportunities`
- `decisions`
- `actions`
- `evidence`
- `lessons`

Automation tables include:

- `event_inbox`
- `automation_schedules`
- `approval_requests`
- `worker_runs`
- `tool_permissions`
- `integration_checkpoints`
- `pattern_confidence`

RLS is enabled on public operational tables. Direct anonymous/authenticated table access is not used for backend-only state.

## 6. Event queue and workers

External or scheduled inputs enter through `event_inbox`.

Queue behavior includes:

- idempotency keys,
- priority,
- bounded retry attempts,
- exponential-style backoff,
- stale-lock recovery,
- dead-letter state,
- worker-run audit records.

Workers claim queued events using row locking so parallel workers do not process the same event simultaneously.

## 7. Scheduler

Supabase `pg_cron` provides recurring scheduling.

A private dispatch helper checks whether work exists before invoking the worker path. This avoids unnecessary network calls while preserving low-latency processing.

Operational time semantics use `Asia/Manila` for user-facing schedules. UTC remains appropriate for database timestamps and interoperability.

## 8. Decision gates

Current decision gates are:

- `OBSERVE_ONLY`
- `RECOMMEND`
- `DRAFT`
- `AUTO`
- `ASK_USER`
- `REJECT`

`AUTO` does not imply phantom execution. A named real tool adapter and sufficient delegated authority must exist before any external action can run automatically.

## 9. Approval architecture

External writes are controlled by explicit approvals.

Approval is specific to the requested action. An approval for a security review does not authorize a Gmail draft. An approval for a Gmail draft does not authorize sending. Tool/action matching must be exact enough to prevent permission drift.

## 10. Tool permission layer

`tool_permissions` defines which connected capabilities may be used.

Default policy:

- read actions may be enabled when useful,
- reversible writes remain approval-gated,
- high-risk or irreversible writes remain disabled,
- connection to a tool does not imply permission to mutate that tool.

Examples:

### Gmail

Enabled:

- read
- create draft, approval required

Disabled:

- send
- archive
- label
- delete

### GitHub

Enabled:

- read
- write file, approval required

Disabled by default:

- create branch
- create issue
- comment
- create pull request
- merge pull request

## 11. Evidence and learning loop

After an action or review, the system records actual results as evidence.

Learning flow:

`DECISION → APPROVAL/REJECTION → ACTION/REVIEW → ACTUAL RESULT → EVIDENCE → LESSON → CONFIDENCE ADJUSTMENT`

Pattern confidence changes gradually rather than jumping after a single outcome. Verified feedback is idempotent: the same decision cannot be counted twice.

## 12. External integrations

### Gmail

Used as a read sensor and approval-gated draft surface.

The Gmail ingestion policy prioritizes:

- direct human messages,
- work/business opportunities,
- security/account alerts,
- billing/payment/transaction notices,
- messages requiring a decision or reply.

Promotions, newsletters, social notifications, and low-value automated updates are ignored by default.

Sensitive authentication material such as OTPs, password reset codes, tokens, and similar secrets should not be persisted into the agent event store.

### Google Calendar

Read-only monitoring is used for:

- schedule conflicts,
- upcoming events that need preparation,
- invitations needing attention,
- time-sensitive changes.

Calendar mutation is not enabled in the current phase.

### Google Drive

Used as a read-only reference sensor. The system tracks selected project references and modification state without automatically ingesting entire files.

### GitHub

The tracked repository is:

`henyongoportunista/AgilaLogic`

Current policy allows read access and explicit approval-gated file writes. Branch creation, issues, pull requests, comments, and merges remain disabled until separately proven safe.

## 13. Observability

Health checks watch for:

- dead-letter events,
- failed worker runs,
- stale processing events,
- missing integration checkpoints,
- unresolved approvals where relevant.

Healthy state should remain quiet. Notifications are reserved for meaningful problems or decisions requiring attention.

## 14. Security boundaries

The architecture must preserve these constraints:

- no service-role or secret-key exposure,
- no authorization based on untrusted user metadata,
- no silent escalation from read to write,
- no external send/merge/delete without explicit bounded authority,
- no automatic deep ingestion of unrelated private data,
- no fabricated execution when an adapter does not exist.

## 15. Epistemic boundary

AgilaLogic may use symbolic identity systems such as numerology, astrology, or MBTI as narrative coordinates or metaphors. They are not treated as scientific causal mechanisms unless supported by independent empirical evidence.

## 16. Target architecture

The goal is not maximum autonomy.

The target is:

**reliable judgment under bounded authority, with explicit evidence, reversible execution where possible, and correction when reality disagrees with the model.**
