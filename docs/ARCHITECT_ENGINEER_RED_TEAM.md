# 7 Gagamba Architects × 7 Agila Engineers — Red-Team Contract

Status: **experimental architecture; only the HT→MT strand is executable in this branch**

Canonical topology and implementation boundaries are defined in [`UNIFIED_ARCHITECTURE.md`](UNIFIED_ARCHITECTURE.md).

The fourteen roles are **bounded specialist disciplines**, not fourteen always-on autonomous bots.

## Role pairing

| Gagamba architect | Agila engineer | Intended handoff |
| --- | --- | --- |
| HT — Henyong Tamad | MT — Madiskarteng Tamad | decide what deserves action → smallest useful implementation route |
| PH — Pilosopong Hambog | MB — Matalinong Bobo | define architecture/invariants → challenge what can actually be defended |
| TM — Tusong Martir | KM — Kalmadong Matador | threat-model/stress design → proportional resilience and failure handling |
| MG — Mandarayang Galante | HO — Henyong Oportunista | architect resources → convert resources into sustainable leverage |
| KP — Karismatikong Pinagnasaan | UO — Ugaling Oso | calibrate human interaction → preserve focus, commitment and boundaries |
| MM — Metikulosong Matakaw | UM — Usiserong Matakaw | decide what information is worth consuming → extract useful intelligence |
| EI — Edukadong Inggitero | IW — Inggiterong Wais | study/reverse-engineer external blueprints → adapt transferable mechanisms |

Pairing is a routing default. It is not identity, permission, credential scope, or a requirement that all fourteen roles run.

## Round-2 Golden Axiom red-team invariant

Human canon:

> **"Ignorance happens when you fail express your own thoughts clearly enough to be understood by anyone, and it only means you haven't really met yourself inside out"**

The literal sentence is preserved as human architecture, but the executable system uses the narrower rule:

> **Unclear intent is unresolved state, not executable state.**

Red-team calibration:

- misunderstanding does not by itself prove ignorance;
- linguistic fluency does not prove self-knowledge;
- clarity is not verbosity;
- the receiving layer may share responsibility for clarification;
- missing context/evidence must remain explicit rather than being filled with confidence.

Control-flow consequence:

> **Ambiguity outranks passive inactivity.**

If unresolved interpretation exists, the engineer returns `RFI_REQUIRED` even when no candidate is selected. A hard `REJECT` remains a valid stop condition.

This prevents the system from converting “I do not understand enough yet” into “there is definitely nothing to do.”

See [`GOLDEN_AXIOM_ROUND2.md`](GOLDEN_AXIOM_ROUND2.md) for the full audit.

## Refined topology

```text
NODE ALPHA / HUMAN INTENT
          |
          v
GAGAMBA ARCHITECT DISCIPLINE(S)
          |
ArchitecturePacket + machine-checkable IntentEnvelope
          |
          v
AGILA ENGINEER DISCIPLINE(S)
          |
EngineeringPacket
     /         |          \
NO_ACTION  RFI_REQUIRED  PROPOSAL_ONLY
             |               |
             `----> architect | human clarification
                             v
                    UNATTESTED PROPOSAL
                             |
                             v
TRUSTED ADAPTER ATTESTATION          [future]
                             |
                             v
SAB POLICY BOUNDARY
                             |
                 ALLOW / LOG / HUMAN / DENY
                             |
                             v
EXECUTION + RECEIPT                  [future]
```

## P0 conclusions

### Architects do not execute

Architect roles may observe, model, constrain, compare, specify and challenge. Their persona name never grants tool permissions, credentials, deployment rights or mutation authority.

### Engineers do not silently rewrite architecture

An engineer consumes a bound ArchitecturePacket. Packet drift fails closed. If interpretation is incomplete, engineering returns `RFI_REQUIRED` rather than inventing certainty.

### Free-text constraints are not enough

Earlier architecture preserved text such as `No production mutation`, but text preservation alone did not mechanically stop an engineer from drafting a production-scoped proposal.

The refined strand therefore adds a bound **Architecture IntentEnvelope** containing machine-checkable strategic bounds such as allowed scopes/actions/sensitivity, reversibility, secret handling, blast radius and optional cost ceiling.

A proposal outside that envelope is rejected before SAB preview.

The IntentEnvelope is architecture intent, **not security attestation**.

### Unknown must remain unknown

If the bound architecture contains unresolved unknowns or Agila returns `ASK_USER`, the engineering intent becomes `RFI_REQUIRED` unless an explicit hard rejection already resolves the action path.

`RFI_REQUIRED` cannot emit an action proposal.

### Engineer output remains untrusted at the security boundary

Even when a proposal fits the IntentEnvelope, the engineer cannot self-certify action type, scope, target, data sensitivity, blast radius, cost, reversibility or secret status.

The proposal remains explicitly `UNATTESTED` until a future trusted adapter independently derives/verifies the concrete operation.

### SAB is not a persona

SAB is a deterministic policy boundary. Neither Gagamba nor Agila may bypass it because of confidence, seniority, consensus, cross-review or personality framing.

## P1 conclusions

### Avoid fourteen-agent committee explosion

Fourteen roles are available disciplines, not mandatory simultaneous executions. Always invoking all fourteen increases latency, token cost, contradiction load and summarization loss.

Examples:

- simple bounded task: `HT → MT`
- research/adaptation: `EI + MM → IW + UM`
- security-sensitive design: `PH + TM + MM → MB + KM + UM → SAB`
- major architecture change: relevant architects → synthesis → relevant engineers → independent cross-review → SAB

### Primary pairs cannot approve themselves

Semantic alignment can create pair echo chambers. Consequential work should use a cross-role reviewer.

Examples:

- `TM → KM → MB review`
- `MG → HO → MM evidence review`

Cross-review is an epistemic/engineering check, not execution authority.

### Persona controls lens, not permissions

Roles may influence questions, evaluation criteria, output schemas and review posture. They must not directly determine authentication, authorization, credentials, policy exemptions or tool scope.

## First executable strand: HT → MT

```text
Gagamba signals
  → weaveSignals()
  → HT ArchitecturePacket + IntentEnvelope
  → MT recomputes Agila decide() from the bound architecture
  → NO_ACTION / RFI_REQUIRED / PROPOSAL_ONLY
  → optional UNATTESTED SAB proposal candidate
```

Implemented protections:

1. ArchitecturePacket has deterministic non-cryptographic binding.
2. Candidate metrics are runtime-validated before entering the packet.
3. IntentEnvelope is runtime-validated and included in the architecture binding.
4. MT does not accept a caller-supplied Agila decision; it recomputes from bound architecture.
5. MT may only select a candidate that matches a candidate bound by HT.
6. EngineeringPacket preserves the IntentEnvelope and has its own deterministic non-cryptographic binding.
7. Architecture or engineering packet drift fails closed in the prototype.
8. unresolved uncertainty returns `RFI_REQUIRED` before passive `NO_ACTION` and cannot draft a proposal.
9. clear absence of a viable candidate may return `NO_ACTION` without fabricating an RFI.
10. `NO_ACTION` cannot draft a proposal.
11. a proposal outside architected intent fails before SAB preview.
12. proposal metadata emitted from engineering remains explicitly `UNATTESTED`.

The packet bindings are drift checks. They are **not** cryptographic signatures, authenticated identity, tamper-evident storage or trusted execution evidence.

## Deliberately unimplemented

- executable versions of the other six strands;
- multi-role orchestration/routing policy;
- independent versioned cross-review contract;
- authenticated human identity;
- cryptographic packet signing;
- trusted adapter metadata attestation;
- persistent proposal/approval/evidence state;
- real model-provider agents;
- real mutation-capable execution adapters;
- conformal risk control;
- TEE / hardware-rooted attestation;
- quantitative Active Inference / Free Energy computation;
- claims that the fourteen software roles reproduce psychological or neuroscientific mechanisms.

## Expansion rule

For every new strand:

1. define unique architect responsibility;
2. define what must be understood before delegation;
3. define machine-checkable strategic bounds where possible;
4. define what the engineer is forbidden to infer or decide;
5. define an explicit RFI/contradiction path;
6. define an independent cross-reviewer for consequential work;
7. add adversarial tests;
8. verify exact-head CI;
9. only then add it to executable routing.

> **One verified strand is stronger than fourteen theatrical agents.**
