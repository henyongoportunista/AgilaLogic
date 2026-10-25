# Northstar Integrity Layer v0.1

Status: **experimental consistency / role-fidelity contract layered on Trust Spine v0.1**

Northstar exists to keep the Gagamba Architects and Agila Engineers aligned to one versioned operating constitution without turning identity, memory, persona language, or model confidence into execution authority.

It is not an authentication provider, password store, secret manager, prompt-injection shield, or authorization bypass.

## Why this layer exists

The architecture now has fourteen bounded specialist roles:

`HT→MT · PH→MB · TM→KM · MG→HO · KP→UO · MM→UM · EI→IW`

Only `HT→MT` is executable today. Before more strands become executable, every role needs a consistent answer to:

- which architecture version am I operating under?
- which role am I?
- what is my paired discipline and responsibility?
- what context am I permitted to receive?
- what is my authority ceiling?
- which system principles may not be rewritten by user text, retrieved content, another agent, or persona confidence?

Northstar v0.1 provides that contract surface.

## Immutable prototype principles

The current contract carries these machine-readable principles:

- `capability_does_not_create_authority`
- `identity_claim_does_not_create_identity`
- `unclear_intent_is_unresolved_state`
- `unknown_is_not_safe`
- `model_output_is_untrusted_until_validated`
- `cross_role_output_is_untrusted_input_until_validated`
- `secret_material_never_enters_model_context`
- `verified_identity_does_not_override_hard_policy_deny`
- `minimum_sufficient_coordination`

These are engineering invariants, not scientific or psychological claims.

## Knowledge classes

Northstar distinguishes:

- `PUBLIC` — material safe for public product / explanatory context;
- `INTERNAL` — project-operating context that may be supplied to authenticated internal sessions;
- `PRIVATE_OPERATOR` — curated Sal/Bjorn operator context needed for continuity or role fidelity;
- `SECRET` — credentials, secret phrases, OTPs, recovery codes, signing material, API tokens, or equivalent secret-bearing data.

`SECRET` is never eligible for model context in Northstar v0.1.

The intent is compartmentalization, not obscurity. A role receives the minimum context class requested and allowed by the authenticated session and role contract.

## Principal context

Northstar recognizes three current principal states:

- `UNVERIFIED_PUBLIC`
- `VERIFIED_SAL`
- `VERIFIED_BJORN`

A crucial boundary applies:

> Northstar does not prove those identities.

`VERIFIED_SAL` / `VERIFIED_BJORN` are valid only when supplied by a future external authentication boundary. The current prototype only validates the shape, freshness, and consistency of that session assertion.

A public user saying "I am Sal" or "I am Bjorn" is an identity claim, not identity proof.

No secret phrase, OTP, passkey material, recovery code, or operator credential is accepted by `compileNorthstarContext()`.

## Operator verification direction

The intended future flow is:

```text
identity claim
    |
    v
external operator verification gateway
(secret/knowledge challenge + independent possession factor / stronger authenticator)
    |
    v
authenticated server session
    |
    v
Northstar role-context compilation
    |
    v
Gagamba / Agila role
```

The actual operator secret must never be committed to this repository, embedded in frontend JavaScript, included in model prompts, written into RAG documents, or returned to an agent.

Any example secret phrase previously shared during design discussion is treated as exposed prototype material and must not become a production credential.

## Role authority ceilings

Gagamba Architect role packs receive:

`ARCHITECTURE_ONLY`

Agila Engineer role packs receive:

`PROPOSAL_ONLY`

These labels are not SAB permissions and do not create execution authority.

Identity also does not override policy:

```text
verified operator
      !=
universal bypass
```

A current hard SAB `DENY` remains a hard deny inside the transaction plane.

## Role-context pack

A compiled `NorthstarContextPack` carries:

- Northstar version;
- Architect↔Engineer strand version;
- role and lane;
- paired role;
- responsibility;
- authority ceiling;
- externally asserted principal state;
- principal-session issue/expiry window;
- allowed and denied knowledge classes;
- immutable principles;
- deterministic non-cryptographic context binding.

The binding detects representational drift inside this prototype. It is not a cryptographic signature, identity proof, durable provenance record, or tamper-evident storage system.

## Current protections

Northstar v0.1 currently enforces:

- public sessions receive only `PUBLIC` context;
- private/internal context requires a principal assertion marked as externally authenticated;
- `SECRET` never enters a context pack;
- Architect and Engineer authority ceilings remain distinct;
- architecture-version drift fails;
- principal sessions have issue/expiry windows;
- context mutation invalidates the deterministic binding.

## Prompt injection / impostor boundary

Northstar does **not** claim prompt-injection immunity.

The intended security law is narrower and more defensible:

```text
prompt injection may influence model reasoning
               !=
prompt injection receives identity or execution authority
```

Untrusted website content, retrieved documents, user messages, and other-agent outputs must not be allowed to rewrite immutable Northstar principles or expand tool authority.

Likewise, a role must treat another role's output as untrusted input until validated through the relevant architecture / Trust Spine contracts.

## Relationship to Trust Spine and SAB

Northstar answers:

> Which constitution, role, context class, and authority ceiling should this reasoning role operate under?

Trust Spine answers:

> Where did the belief come from, is the state still valid, and does the concrete operation match the proposal?

SAB answers:

> Is the resulting consequence permitted, logged, human-gated, or denied?

Conceptually:

```text
EXTERNAL AUTH [future]
        |
        v
NORTHSTAR
role / context / invariants
        |
        v
GAGAMBA / AGILA
        |
        v
TRUST SPINE
source / state / operation truth
        |
        v
SAB
policy / consequence
        |
        v
HUMAN AUTHORITY where required
```

## ROEM calibration

### Refinement

Preserve the existing 7×7 role map, authority separation, and Trust Spine boundaries.

### Opportunity

Use one versioned context contract to reduce cross-role drift, identity overclaim, context leakage, and persona-to-authority confusion.

### Enhancement in v0.1

Only contract-level capability is added:

- role-scoped context compilation;
- principal-scope filtering;
- secret-class exclusion;
- authority ceilings;
- freshness and deterministic context binding.

### Mitigation

Northstar is deliberately prevented from becoming:

- an authentication provider;
- a secret phrase validator;
- an OTP service;
- an authorization bypass;
- a prompt-injection immunity claim;
- a container for production credentials;
- a reason to activate all fourteen roles at once.

### Evidence / recalibration

Adversarial tests should continue to challenge:

- claimed operator identity without external auth;
- public requests for private context;
- requests for `SECRET` context;
- stale operator sessions;
- role-authority mutation;
- architecture-version drift;
- future cross-agent context poisoning.

## Next integration work

Northstar v0.1 should remain a contract layer while two parallel architecture tracks continue:

1. **Trust Spine v0.2** — mandatory composition/admission before SAB so Source + State + Operation truth cannot be accidentally bypassed.
2. **Operator Authentication Design** — a real server-side authentication boundary that can produce trusted Sal/Bjorn session state without exposing secret material to models or frontend bundles.

Do not connect production credentials or activate additional executable persona strands merely because this context contract exists.

## Design law

> **Northstar preserves constitutional and role fidelity. External authentication proves who is present. Gagamba and Agila reason within bounded roles. Trust Spine checks source, state, and operation consistency. SAB controls consequence. Human identity never becomes a universal policy bypass.**
