# Unified Gagamba × Agila Architecture

Status: **experimental canonical design for the current integration branch**

Only the `HT → MT` strand is executable today. The other six architect→engineer pairings are routing contracts, not implemented autonomous agents.

## Core law

> **Capability ≠ Authority. Architecture ≠ Authorization.**

A role may observe, reason, design, engineer, review, or propose without gaining permission to mutate consequential external state.

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

These pairs are **routing defaults**. They are not permissions, identity, credentials, or mandatory one-to-one execution dependencies.

## Dynamic invocation rule

Do not run all fourteen roles by default.

- simple bounded task: invoke one relevant strand;
- uncertainty/research task: invoke relevant architect + engineer roles;
- security-sensitive task: add an independent cross-reviewer;
- major architecture change: synthesize relevant architects first, then relevant engineers, then cross-review before any SAB proposal.

The architecture optimizes for **minimum sufficient coordination**, not maximum agent count.

## ArchitecturePacket

The architect output carries two different kinds of constraints.

### Human-readable architecture

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

### Machine-checkable IntentEnvelope

The current `HT → MT` implementation also binds:

- allowed action types;
- allowed scopes;
- allowed data-sensitivity classes;
- whether reversibility is required;
- whether secret handling is allowed;
- optional maximum affected-record count;
- optional maximum estimated cost.

The IntentEnvelope means:

> **The engineer may not propose outside the architected strategic bounds.**

It does **not** mean:

> the metadata is true, authenticated, independently measured, or authorized for execution.

That distinction is critical.

## EngineeringPacket

The engineer consumes a bound ArchitecturePacket and independently recomputes the Agila decision from that bound state.

The engineer must not trust a caller-supplied decision.

It returns exactly one operational intent:

- `NO_ACTION` — no viable action should be proposed;
- `RFI_REQUIRED` — unresolved uncertainty or interpretation requires architect/human clarification;
- `PROPOSAL_ONLY` — a bounded proposal may be drafted, but no execution authority is granted.

An EngineeringPacket preserves the architecture binding, constraints, IntentEnvelope, unresolved unknowns, and selected candidate.

## RFI rule

Unknown must remain unknown.

If Agila returns `ASK_USER` or the architecture contains unresolved unknowns, the strand returns `RFI_REQUIRED`.

`RFI_REQUIRED` cannot be converted into a SAB proposal.

This prevents the engineering layer from erasing uncertainty merely to keep moving.

## Proposal rule

A proposal candidate may be emitted only when:

1. the ArchitecturePacket binding still verifies;
2. the EngineeringPacket binding still verifies;
3. engineering intent is `PROPOSAL_ONLY`;
4. the selected candidate was actually bound by the architect;
5. the proposed operation stays inside the machine-checkable IntentEnvelope.

The resulting proposal is still labeled:

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

SAB is not an agent, persona, or reviewer.

It is a deterministic policy boundary between an action proposal and consequential execution.

No architect/engineer confidence, persona label, majority vote, or cross-review consensus can bypass an active SAB hard deny.

## Cross-review rule

A primary architect→engineer pair must not self-certify consequential work.

Cross-review checks epistemic/engineering quality, not execution authority.

Examples:

- `TM → KM → MB review`
- `MG → HO → MM evidence review`

A future cross-review contract should produce a versioned review result bound to the same architecture/engineering state. It still must not become an authorization token.

## Trust and evidence labels

Use these labels consistently:

- `IMPLEMENTED` — executable code exists;
- `TESTED` — the behavior passed a stated test on an exact source revision;
- `OPERATIONAL_ANALOGUE` — software behavior resembles a human architecture concept but is not the concept itself;
- `PROPOSED_DESIGN` — intended mechanism without current implementation;
- `RESEARCH_SUPPORTED` — external research supports the narrow stated claim;
- `HYPOTHESIS` — plausible architecture claim not yet established by this project;
- `UNATTESTED` — generated metadata has not been independently verified at the execution boundary;
- `UNKNOWN` — missing or unresolved evidence.

Do not promote one label into another by wording alone.

## Current implementation boundary

### Implemented/tested in this branch

- typed Gagamba signal weave;
- fact/inference/prediction/unknown separation;
- duplicate/malformed signal withholding;
- seven architect/engineer routing identities;
- executable `HT → MT` strand;
- deterministic non-cryptographic ArchitecturePacket binding;
- machine-checkable architecture IntentEnvelope;
- MT recomputation of Agila decision from bound architecture;
- explicit `NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY` outputs;
- deterministic non-cryptographic EngineeringPacket binding;
- proposal rejection outside architecture intent;
- explicit `UNATTESTED` proposal output;
- SAB deterministic policy preview and existing adversarial tests.

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
- conformal risk control;
- TEE / hardware-rooted Proof-of-Guardrail;
- quantitative Active Inference / Free Energy computation;
- claims that software roles reproduce psychological or neuroscientific mechanisms.

## Expansion sequence

Do not clone `HT → MT` six times mechanically.

For each new strand:

1. define the architect's unique input/output responsibility;
2. define machine-checkable strategic constraints where possible;
3. define what the engineer is forbidden to decide;
4. define the RFI/contradiction path;
5. define the independent reviewer for consequential work;
6. add adversarial tests;
7. verify exact-head CI;
8. only then add the strand to executable routing.

## Final design rule

> **Gagamba defines and binds intent. Agila engineers against that intent. Neither authorizes itself. The adapter establishes concrete operation truth. SAB decides the policy route. The human governs consequential authority.**
