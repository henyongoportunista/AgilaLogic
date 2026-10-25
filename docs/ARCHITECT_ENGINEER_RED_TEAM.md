# 7 Gagamba Architects × 7 Agila Engineers — Red-Team Contract

Status: **experimental architecture; only the HT→MT strand is executable in this branch**

The unified architecture treats the fourteen roles as **bounded specialist disciplines**, not fourteen always-on autonomous bots.

## Role pairing

| Gagamba architect | Agila engineer | Intended handoff |
| --- | --- | --- |
| HT — Henyong Tamad | MT — Madiskarteng Tamad | decide what deserves action → smallest useful implementation route |
| PH — Pilosopong Hambog | MB — Matalinong Bobo | define architecture/invariants → challenge what can actually be defended |
| TM — Tusong Martir | KM — Kalmadong Matador | threat-model/stress design → proportional resilience and failure handling |
| MG — Mandarayang Galante | HO — Henyong Oportunista | architect resource abundance → convert resources into sustainable leverage |
| KP — Karismatikong Pinagnasaan | UO — Ugaling Oso | calibrate human interaction → preserve focus, commitment and boundaries |
| MM — Metikulosong Matakaw | UM — Usiserong Matakaw | decide what information is worth consuming → extract useful intelligence |
| EI — Edukadong Inggitero | IW — Inggiterong Wais | study/reverse-engineer external blueprints → adapt transferable mechanisms |

The pairings are routing defaults, not identity, permissions, or hard dependencies. A task may invoke one pair, several roles, or an independent cross-checker.

## Control topology

```text
NODE ALPHA / HUMAN INTENT
          |
          v
GAGAMBA ARCHITECT DISCIPLINE(S)
          |
   ArchitecturePacket
          |
          v
AGILA ENGINEER DISCIPLINE(S)
          |
   EngineeringPacket
          |
          v
UNATTESTED ACTION PROPOSAL
          |
          v
TRUSTED ADAPTER ATTESTATION   [future / not implemented]
          |
          v
SAB POLICY BOUNDARY
          |
          v
HUMAN AUTHORITY WHEN REQUIRED
          |
          v
EXECUTION ADAPTER             [future / not implemented]
```

## Red-team conclusions

### P0 — Architects do not execute

Architect roles may observe, model, constrain, compare, specify and challenge. They do not gain tool permissions, credentials, deployment rights or mutation authority from their persona name.

### P0 — Engineers do not silently rewrite architecture

An engineer consumes a bound ArchitecturePacket. If architect constraints or candidate definitions drift, the handoff fails closed. A future engineer that discovers a contradiction should return an explicit request for interpretation/revision rather than mutating the architecture silently.

### P0 — Engineer output is still untrusted at the security boundary

An EngineeringPacket may produce a proposal candidate, but the engineer cannot self-certify action type, scope, data sensitivity, blast radius, cost, reversibility or secret status. `draftUntrustedSabProposal()` labels the result `UNATTESTED` on purpose.

### P0 — SAB is not a persona

SAB is a deterministic policy boundary. Neither Gagamba nor Agila may bypass it because of confidence, role, seniority, consensus or personality framing.

### P1 — Avoid fourteen-agent committee explosion

Fourteen roles are **available disciplines**, not mandatory simultaneous executions. Always invoking all fourteen would increase latency, token cost, contradiction load and summarization loss.

Recommended routing examples:

- simple efficiency task: `HT → MT`
- research/adaptation: `EI + MM → IW + UM`
- security-sensitive design: `PH + TM + MM → MB + KM + UM → SAB`
- major architecture change: relevant architects → synthesis → relevant engineers → independent cross-check → SAB

### P1 — Primary pairs cannot approve themselves

Semantic alignment can create pair echo chambers. Consequential work should use a cross-role reviewer. Examples:

- `TM → KM → MB review`
- `MG → HO → MM evidence review`

Cross-review is an epistemic check, not execution authority.

### P1 — Persona controls lens, not permissions

A role may influence questions, evaluation criteria, output schema and review posture. It must not directly determine credentials, tool scope, authentication, authorization or policy exemptions.

### P1 — Unknown must remain unknown

Architect/engineer handoffs must preserve assumptions, predictions and unknowns as distinct from facts. Unresolved unknowns may require architect/human review; they may not be erased merely to obtain a cleaner engineering plan.

## First executable strand: HT → MT

This branch implements one deliberately narrow strand:

```text
Gagamba signals
  → weaveSignals()
  → HT ArchitecturePacket
  → MT recomputes Agila decide() from the bound packet
  → MT EngineeringPacket
  → optional UNATTESTED SAB proposal candidate
```

Implemented protections:

1. ArchitecturePacket has a deterministic non-cryptographic binding.
2. Candidate metrics are runtime-validated before entering the packet.
3. MT does not accept a caller-supplied Agila decision; it recomputes the decision from the bound packet.
4. MT may only select a candidate that matches a candidate bound by HT. Derived ranking score is not treated as architect input.
5. EngineeringPacket has its own deterministic non-cryptographic binding.
6. Mutated architecture or engineering packets fail closed in the prototype.
7. `NO_ACTION` cannot be converted into a SAB proposal.
8. Any proposal metadata emitted from the engineering layer is explicitly `UNATTESTED`.

These bindings detect packet drift inside the prototype. They are **not** signatures, authentication, cryptographic integrity or durable provenance.

## What remains deliberately unimplemented

- the other six architect→engineer executable strands;
- multi-role orchestration/routing policy;
- independent cross-review scheduler;
- authenticated human identity;
- cryptographic packet signing;
- trusted adapter metadata attestation;
- persistent proposal/approval/evidence storage;
- real model-provider agents;
- real mutation-capable execution adapters;
- claims that the fourteen software roles reproduce psychological or neuroscientific mechanisms.

## Expansion rule

Do not implement all remaining pairs at once. For each new pair:

1. define its input/output contract;
2. identify what it is forbidden to decide;
3. define a contradiction/RFI path;
4. add adversarial tests;
5. verify exact-head CI;
6. only then add it to executable routing.

One verified strand is more useful than fourteen theatrical agents.
