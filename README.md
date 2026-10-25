# AgilaLogic

**Pattern Recognition — The Art of Architectural Thinking / The Language of Nature.**

> “No Chain, No Ruler: You do not beg for terms on a board you play on—you own the engine that sets them.”

## Creed

> **“Ako ang bida at kontrabida ng sarili kong buhay na pabida—pinanganak sa taas, sa kalangitan; lumaki sa baba, sa kalupaan; at sumisid sa karagatan, sa kailaliman. Katotohanan ang aking panata, hanggang ang pagkalimot ay tuluyang mawala.”**

AgilaLogic is the conceptual and operational architecture behind **Henyong Oportunista**: a system for observing reality, filtering noise, identifying leverage, making bounded decisions, acting with explicit authority, verifying outcomes, and learning from evidence.

## Experimental Gagamba × Agila weave

A separate integration branch adds a bounded Gagamba architecture layer in front of the existing Agila decision engine:

`RAW SIGNALS → GAGAMBA WEAVE → GAGAMBA ARCHITECT → ArchitecturePacket + IntentEnvelope → AGILA ENGINEER → NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY → UNATTESTED PROPOSAL → SAB`

The current model defines **7 Gagamba architect disciplines** and **7 Agila engineer disciplines** as available specialist roles, not fourteen always-on autonomous bots:

`HT→MT · PH→MB · TM→KM · MG→HO · KP→UO · MM→UM · EI→IW`

Only the first `HT → MT` strand is executable in the current branch. MT recomputes the Agila decision from the bound ArchitecturePacket instead of trusting a caller-supplied verdict. The Architecture IntentEnvelope constrains what engineering may propose; unresolved uncertainty returns `RFI_REQUIRED`; and any downstream operation metadata remains explicitly `UNATTESTED` until a future trusted adapter independently derives the concrete operation.

The current operational form of the Unified Golden Axiom is:

> **Unclear intent is unresolved state, not executable state.**

This means ambiguity returns for interpretation instead of being silently converted into either action or passive `NO_ACTION`.

The weave preserves facts separately from inference and prediction, keeps uncertainty visible, treats explicit human preference as a constraint, and withholds malformed or duplicate signals before they reach Agila evaluation.

This is an operational translation only. It does **not** claim that the full Gagamba psychological/philosophical architecture, Active Inference, Free Energy minimization, autonomous persona rotation, neurobiological mechanisms, cryptographic identity, trusted adapter attestation, conformal risk control, TEE proof, or real execution are implemented.

See:

- [`docs/UNIFIED_ARCHITECTURE.md`](docs/UNIFIED_ARCHITECTURE.md) — canonical technical topology and boundaries
- [`docs/GOLDEN_AXIOM_ROUND2.md`](docs/GOLDEN_AXIOM_ROUND2.md) — verbatim human canon, red-team findings and calibrated executable translation
- [`docs/GAGAMBA_AGILA_WEAVE.md`](docs/GAGAMBA_AGILA_WEAVE.md) — source-to-software weave contract
- [`docs/ARCHITECT_ENGINEER_RED_TEAM.md`](docs/ARCHITECT_ENGINEER_RED_TEAM.md) — red-team rules and expansion discipline

## Universal quality protocol — ROEM

`REFINEMENT → OPPORTUNITIES → ENHANCEMENT → MITIGATION`

ROEM is the project quality/evolution loop. It does not grant execution authority and it does not replace SAB.

Current applied phase: **R — Refinement**.

Phase 1 preserves the working architecture while removing ambiguity and representational noise. Current refinements include:

- runtime validation of the Gagamba signal taxonomy;
- normalized unique candidate identifiers;
- canonical ordering of set-like IntentEnvelope values so equivalent intent does not create meaningless binding drift;
- explicit calibration that numeric `estimatedCost` has no production currency/unit guarantee yet.

No new agents, external integrations, executor, or production authority are introduced by Phase 1.

See:

- [`docs/ROEM_PROTOCOL.md`](docs/ROEM_PROTOCOL.md)
- [`docs/ROEM_PHASE1_REFINEMENT.md`](docs/ROEM_PHASE1_REFINEMENT.md)

## Executable prototype — Sovereign Scaffold

**Capability ≠ Authority.**

This repository includes a working local prototype of the **Sovereign Assurance Boundary (SAB)**: a deterministic admission layer between an action proposal and execution authority.

The demo proves a deliberately narrow control path:

`PROPOSAL → RUNTIME VALIDATION → SAB → ALLOW / HUMAN GATE / DENY → EPHEMERAL AUDIT`

It includes sensitivity-aware reads, fail-closed runtime validation, server-side policy recomputation, complete-proposal approval binding, one-time demo authorization, replay rejection, and a hard-deny path for external secret exfiltration.

Run it locally:

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:4173`.

This is a **non-mutating local prototype**. No real external execution adapter is connected, the approval button only simulates the Node Alpha role, and authenticated human identity is not claimed yet.

See [`docs/SOVEREIGN_SCAFFOLD.md`](docs/SOVEREIGN_SCAFFOLD.md) for the threat boundary, implemented controls, adversarial tests, and explicit non-claims.

## Core operating loop

`OBSERVE → FILTER → CALCULATE → DECIDE → ACT → VERIFY → STORE → RECALIBRATE`

State progression:

`OBSERVED → UNDERSTOOD → CANDIDATE → EVALUATED → DECIDED → AUTHORIZED → EXECUTED → VERIFIED → LEARNED`

The architecture does not allow a direct jump from observation to action.

## Seven cognitive modules

1. **MT — Selective Efficiency**: remove useless motion and preserve effort for what matters.
2. **UM — Disciplined Literacy**: identify missing knowledge, uncertainty, and constraints.
3. **UO — Sovereign Resourcefulness**: inventory available resources without letting desire become authority.
4. **IW — Constructive Adaptation**: adapt to reality without abandoning truth.
5. **HO — Sustainable Leverage**: rank options by value, timing, confidence, cost, risk, reversibility, and information gain.
6. **KM — Proportional Response**: choose the smallest sufficient response among viable options.
7. **MB — Calibrated Skepticism**: challenge assumptions, gate risky actions, and require stronger evidence when stakes rise.

## Integrity Kernel

No principle may be used to falsify the reality the system exists to understand.

Operational rules:

- Never fabricate evidence.
- Separate facts, inferences, predictions, preferences, and unknowns.
- Keep confidence proportional to evidence.
- Do not rewrite failures as successes.
- Update the model before defending a failed prediction.
- External or irreversible actions require explicit authority unless a bounded delegation has been deliberately configured.

## Automation safety

Current design principle:

- Read actions may be enabled where useful.
- Reversible writes remain approval-gated.
- Irreversible or externally consequential actions remain disabled by default.
- Approval does not imply execution unless the requested tool/action exactly matches the approved action.

## Epistemic framing

Numerology, astrology, MBTI, and other symbolic identity coordinates may be used as metaphorical or narrative scaffolding. They are not treated as empirical causal truth unless independently validated.

## Current design direction

The repository currently centers on:

- one orchestrator;
- deterministic cognitive modules;
- typed Gagamba→Agila packet contracts;
- a Supabase adapter/contracts for future state, queues, decisions, evidence, and lessons;
- explicit approval gates;
- outcome verification and learned-pattern concepts;
- monitored external sensors/integrations as future bounded inputs.

The target is not maximal autonomy. The target is **reliable judgment under bounded authority**.

## Final law

Observe without becoming passive. Act without becoming reactive. Desire without becoming enslaved. Doubt without becoming paralyzed. Adapt without abandoning truth. Acquire without being consumed. Give without surrendering leverage. Learn without worshipping knowledge.

When the pattern aligns, do not waste the opening.
