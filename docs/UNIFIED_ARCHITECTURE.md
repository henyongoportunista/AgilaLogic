# Unified Gagamba × Agila Architecture

Status: **experimental canonical design — ROEM Phase 1 refinement applied; exact-head evidence tracked in PR #2**

Only the `HT → MT` strand is executable today. The other six architect→engineer pairings remain routing contracts, not implemented autonomous agents.

## Core law

> **Capability ≠ Authority. Architecture ≠ Authorization.**

A role may observe, reason, design, engineer, review, or propose without gaining permission to mutate consequential external state.

## Universal quality protocol — ROEM

The architecture uses the process loop:

`REFINEMENT → OPPORTUNITIES → ENHANCEMENT → MITIGATION → EVIDENCE / RECALIBRATE → REFINEMENT`

ROEM is a quality/evolution protocol, not a persona or authorization mechanism.

Current applied phase: **R — Refinement**.

Phase-1 rule:

> **Preserve what works; remove ambiguity, contradiction, duplicate state, and meaningless representational drift before adding capability.**

This phase does not authorize work from O/E/M. Opportunities may be recorded, but no new capability is justified merely because it is visible.

See:

- `docs/ROEM_PROTOCOL.md`
- `docs/ROEM_PHASE1_REFINEMENT.md`

## Unified Golden Axiom

Human canon, preserved verbatim:

> **"Ignorance happens when you fail express your own thoughts clearly enough to be understood by anyone, and it only means you haven't really met yourself inside out"**

The repository does **not** treat the literal psychological claim as established fact. Its calibrated engineering translation is:

> **Unclear intent is unresolved state, not executable state.**

Operational consequence:

- objective must be explicit;
- success criteria must be explicit;
- strategic limits should be machine-checkable where feasible;
- fact, inference, prediction, preference and unknown remain distinct;
- the engineer may not silently invent missing intent;
- unresolved interpretation returns `RFI_REQUIRED`;
- ambiguity outranks passive `NO_ACTION`, except for an explicit hard rejection;
- clarity is structural and testable, not a function of verbosity or confidence.

See `docs/GOLDEN_AXIOM_ROUND2.md` for the full red-team analysis.

## Two planes

### Governance plane

Node Alpha / the authorized human governs:

- architecture and policy changes;
- version changes;
- trust-boundary changes;
- deployment decisions;
- credential and adapter activation;
- explicit approval where transaction policy requires it.

Changing policy is a separate governed action. It is not a hidden override inside a normal transaction approval.

### Transaction plane

```text
RAW SIGNALS / HUMAN INTENT
          |
          v
GAGAMBA WEAVE
separate fact / inference / prediction / unknown / preference
          |
          v
GAGAMBA ARCHITECT DISCIPLINE(S)
          |
ArchitecturePacket + IntentEnvelope
          |
          v
AGILA ENGINEER DISCIPLINE(S)
          |
EngineeringPacket
          |
          +----> NO_ACTION
          |
          +----> RFI_REQUIRED ----> architect / human clarification
          |
          `----> PROPOSAL_ONLY
                    |
                    v
          UNATTESTED ACTION PROPOSAL
                    |
                    v
TRUSTED ADAPTER ATTESTATION          [future]
                    |
                    v
SOVEREIGN ASSURANCE BOUNDARY (SAB)
                    |
      ALLOW / LOG / HUMAN / DENY
                    |
                    v
AUTHENTICATED HUMAN APPROVAL         [when required / future identity hardening]
                    |
                    v
EXECUTION ADAPTER                    [future]
                    |
                    v
RECEIPT → VERIFY → EVIDENCE → RECALIBRATE
```

The current prototype stops before a real trusted adapter or real external executor.

## 7 architect disciplines × 7 engineer disciplines

| Gagamba architect | Agila engineer | Default handoff |
| --- | --- | --- |
| HT — Henyong Tamad | MT — Madiskarteng Tamad | decide what deserves action → smallest useful implementation route |
| PH — Pilosopong Hambog | MB — Matalinong Bobo | define invariants → challenge what can actually be defended |
| TM — Tusong Martir | KM — Kalmadong Matador | stress the design → proportional resilience and failure handling |
| MG — Mandarayang Galante | HO — Henyong Oportunista | architect resources → convert them into sustainable leverage |
| KP — Karismatikong Pinagnasaan | UO — Ugaling Oso | calibrate interaction → preserve focus, commitment and boundaries |
| MM — Metikulosong Matakaw | UM — Usiserong Matakaw | decide what information is worth consuming → extract useful intelligence |
| EI — Edukadong Inggitero | IW — Inggiterong Wais | study external blueprints → adapt transferable mechanisms |

These pairings are routing defaults. They are not permissions, identity, credentials, or mandatory one-to-one execution dependencies.

## Minimum-sufficient coordination

Do not run all fourteen roles by default.

- simple bounded task → one relevant strand;
- uncertainty/research task → relevant architect + engineer roles;
- security-sensitive task → add an independent cross-reviewer;
- major architecture change → synthesize relevant architects, then relevant engineers, then cross-review before any SAB proposal.

The architecture optimizes for **minimum sufficient coordination**, not maximum agent count.

## ArchitecturePacket

The architect output contains both human-readable and machine-checkable intent.

Human-readable fields include:

- objective;
- facts;
- assumptions;
- predictions;
- unknowns;
- constraints;
- resources;
- human preferences;
- success criteria;
- non-goals;
- candidate actions.

The machine-checkable `ArchitectureIntentEnvelope` binds:

- allowed action types;
- allowed scopes;
- allowed data-sensitivity classes;
- whether reversibility is required;
- whether secret handling is allowed;
- optional maximum affected-record count;
- optional prototype numeric estimated-cost ceiling.

Set-like action/scope/sensitivity lists are deduplicated and canonicalized before binding so equivalent intent does not drift merely because array order differs.

Candidate IDs are normalized and must be unique before entering the ArchitecturePacket.

Design rule:

> **The engineer may not propose outside the architected strategic bounds.**

This does not establish that proposal metadata is true, authenticated, independently measured, or authorized for execution.

`estimatedCost` currently has no currency/unit semantics. Its numeric ceiling is prototype-only and must not be represented as a production financial-control guarantee.

## EngineeringPacket

The engineer consumes a bound ArchitecturePacket and independently recomputes the Agila decision from that state. It must not trust a caller-supplied verdict.

It returns exactly one operational intent:

- `NO_ACTION` — the state is sufficiently understood and no justified action should be proposed;
- `RFI_REQUIRED` — unresolved interpretation/evidence requires architect or human clarification;
- `PROPOSAL_ONLY` — a bounded proposal may be drafted, without execution authority.

The EngineeringPacket preserves architecture binding, constraints, IntentEnvelope, unresolved unknowns, and selected candidate.

## Clarity / RFI precedence

Round-2 red-team found a control-flow flaw: a packet with unresolved uncertainty and no selected candidate could previously collapse into `NO_ACTION`.

The refined precedence is:

1. explicit hard `REJECT` → `NO_ACTION`;
2. otherwise unresolved unknown or `ASK_USER` → `RFI_REQUIRED`;
3. otherwise no viable selected action → `NO_ACTION`;
4. otherwise → `PROPOSAL_ONLY`.

Therefore:

> **Absence of action is not evidence of understanding.**

`RFI_REQUIRED` cannot be converted into a SAB proposal.

## Gagamba runtime clarity

TypeScript unions are not treated as runtime truth.

The weave now runtime-validates the supported signal taxonomy:

`FACT · INFERENCE · PREDICTION · PREFERENCE · UNKNOWN · CONSTRAINT · RESOURCE`

A runtime value outside that set is withheld rather than being marked accepted and silently falling through the classifier.

## Proposal rule

A proposal candidate may be emitted only when:

1. ArchitecturePacket binding verifies;
2. EngineeringPacket binding verifies;
3. engineering intent is `PROPOSAL_ONLY`;
4. the selected candidate was bound by the architect;
5. the proposed operation remains inside the machine-checkable IntentEnvelope.

The resulting proposal remains:

`UNATTESTED`

because the engineer is not trusted to certify its own security metadata.

## Trusted adapter boundary

Future production adapters must independently derive or verify the concrete operation:

- action type;
- scope;
- exact target;
- resource identity;
- data sensitivity;
- reversibility;
- affected-record count / blast radius;
- cost units and amount;
- secret exposure;
- policy/version context.

If model/engineer metadata and adapter-derived metadata disagree, the path must fail closed.

Hardware-rooted attestation or cryptographic signatures may strengthen this boundary later, but neither is implemented by the current packet bindings.

## SAB boundary

SAB is not an agent, persona, or reviewer. It is a deterministic policy boundary between an action proposal and consequential execution.

No architect/engineer confidence, persona label, majority vote, or cross-review consensus can bypass an active SAB hard deny.

## Cross-review rule

A primary architect→engineer pair must not self-certify consequential work.

Cross-review checks epistemic and engineering quality, not execution authority.

Examples:

- `TM → KM → MB review`
- `MG → HO → MM evidence review`

A future cross-review contract should produce a versioned result bound to the same architecture/engineering state. It still must not become an authorization token.

## Trust and evidence labels

Use these labels consistently:

- `IMPLEMENTED` — executable code exists;
- `TESTED` — behavior passed a stated test on an exact source revision;
- `OPERATIONAL_ANALOGUE` — software behavior resembles a human architecture concept but is not the concept itself;
- `PROPOSED_DESIGN` — intended mechanism without current implementation;
- `RESEARCH_SUPPORTED` — external research supports the narrow stated claim;
- `HYPOTHESIS` — plausible architecture claim not yet established by this project;
- `USER_CONCEPT` / `HUMAN_CANON` — supplied human philosophy/wording preserved as source material;
- `UNATTESTED` — generated metadata has not been independently verified at the execution boundary;
- `UNKNOWN` — missing or unresolved evidence.

Do not promote one label into another by wording alone.

## Current implementation boundary

### Implemented / tested in this Phase-1 source

- typed Gagamba signal weave;
- fact / inference / prediction / unknown separation;
- duplicate/malformed signal withholding;
- runtime Gagamba signal-kind allowlist;
- seven architect/engineer routing identities;
- executable `HT → MT` strand;
- deterministic non-cryptographic ArchitecturePacket binding;
- normalized unique candidate IDs;
- machine-checkable ArchitectureIntentEnvelope;
- canonical ordering for set-like IntentEnvelope values;
- MT recomputation of Agila decision from bound architecture;
- explicit `NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY` outputs;
- ambiguity-before-inactivity precedence;
- deterministic non-cryptographic EngineeringPacket binding;
- proposal rejection outside architecture intent;
- explicit `UNATTESTED` proposal output;
- SAB deterministic policy preview and adversarial tests.

Exact revision evidence is recorded in PR #2; this document does not substitute for CI results.

### Not implemented

- executable versions of the other six strands;
- fourteen always-on model agents;
- multi-role orchestration scheduler;
- versioned independent cross-review contract;
- cryptographic packet signing;
- authenticated Node Alpha identity;
- trusted adapter metadata attestation;
- durable/tamper-evident approval and evidence state;
- real model-provider generation;
- mutation-capable external execution;
- explicit production currency/unit semantics for estimated cost;
- conformal risk control;
- TEE / hardware-rooted Proof-of-Guardrail;
- quantitative Active Inference / Free Energy computation;
- claims that software roles reproduce psychological or neuroscientific mechanisms.

## Expansion sequence

Do not clone `HT → MT` six times mechanically.

For each future strand:

1. define the architect's unique input/output responsibility;
2. define what must be understood before delegation;
3. define machine-checkable strategic constraints where possible;
4. define what the engineer is forbidden to infer or decide;
5. define the RFI/contradiction path;
6. define the independent reviewer for consequential work;
7. add adversarial tests;
8. verify exact-head CI;
9. only then add the strand to executable routing.

## Final design rule

> **Gagamba defines and binds intent. Agila engineers against that intent. Unclear intent returns for interpretation. Neither authorizes itself. The adapter establishes concrete operation truth. SAB decides the policy route. The human governs consequential authority.**
