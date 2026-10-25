# Operator Authentication Boundary v0.1

Status: **experimental server-side contract layer**

This layer sits before Northstar and represents the future server-side verification boundary for Sal / Bjorn operator sessions.

It deliberately does **not** contain any production secret phrase, OTP value, recovery code, passkey credential, signing key, API token, or provider credential.

## Goal

Turn an identity claim such as:

```text
"Ako si Sal"
```

into either:

```text
UNVERIFIED PUBLIC SESSION
```

or, after an external server-side verification process:

```text
AUTH FACTOR RECEIPTS
        |
        v
OPERATOR AUTH ASSERTION
        |
        v
REPLAY CONSUMPTION
        |
        v
VERIFIED OPERATOR SESSION ARTIFACT
        |
        v
NORTHSTAR CONTEXT
```

The model / agent layer never receives raw authentication secrets.

## Factor model

v0.1 recognizes three factor classes:

- `KNOWLEDGE`
- `POSSESSION`
- `INHERENCE`

Example channel mapping:

- Northstar secret phrase -> `KNOWLEDGE`
- email OTP -> `POSSESSION`
- SMS OTP -> `POSSESSION`
- TOTP -> `POSSESSION`
- passkey / hardware key -> `POSSESSION`
- biometric -> `INHERENCE`

The current prototype requires at least two **distinct factor classes** for an operator auth assertion.

Therefore:

```text
secret phrase + TOTP
= KNOWLEDGE + POSSESSION
= two distinct factor classes
```

while:

```text
email OTP + SMS OTP
= POSSESSION + POSSESSION
= two verification steps, but not two independent factor classes
```

The threshold is a prototype policy decision, not a universal security theorem.

## Secret handling

`bindOperatorAuthAssertion()` intentionally accepts only verification receipts. It does not accept:

- password strings;
- the Northstar secret phrase;
- OTP values;
- TOTP seeds;
- passkey private material;
- recovery codes;
- provider API keys.

A receipt carries only metadata such as:

- factor ID;
- factor class;
- channel;
- verifier ID;
- verification timestamp;
- optional opaque evidence reference.

Production verifiers must remain server-side.

## Replay semantics

`consumeOperatorAuthAssertion()` requires caller-supplied replay state and rejects:

- reused assertion IDs;
- reused nonce IDs.

The resulting state must be persisted by a future durable backend if replay protection is expected to survive process restarts or horizontal scaling.

v0.1 therefore does **not** claim durable replay prevention.

## Northstar binding

Verified Northstar principals now require a `VerifiedOperatorSession` artifact.

A caller can no longer create a verified principal for `compileNorthstarContext()` merely by supplying:

```text
principal = VERIFIED_SAL
verification = EXTERNAL_AUTH
```

The principal must also carry a fresh operator-session artifact whose structural binding and identity agree with the claim.

Northstar records the session binding in its own context binding.

## Trust calibration

A structurally accepted operator session is explicitly labeled:

```text
EXTERNAL_AUTH_CONTRACT_MATCHED_UNAUTHENTICATED_ISSUER
```

That wording is deliberate.

The current code verifies contract shape, factor-class diversity, freshness, replay state, identity linkage, and deterministic mutation detection.

It does **not** yet verify that the external issuer is cryptographically authentic.

A future auth adapter may use a standard identity provider, passkeys/WebAuthn, TOTP, server-side secret verification, or another approved mechanism. That adapter must prove issuer authenticity outside the model context.

## Current flow

```text
IDENTITY CLAIM
    |
    +-- no external auth --> UNVERIFIED_PUBLIC
    |
    `-- server-side factor verification
             |
             v
       factor receipts
             |
             v
       auth assertion
             |
       replay consumption
             |
             v
       operator session
             |
             v
         NORTHSTAR
             |
             v
      GAGAMBA / AGILA
             |
             v
       TRUST ADMISSION
             |
             v
            SAB
```

## Explicit non-claims

v0.1 does not claim:

- production authentication;
- authenticated issuer identity;
- cryptographic signatures;
- secure OTP delivery;
- passkey/WebAuthn implementation;
- durable replay storage;
- compromise-proof sessions;
- prompt-injection immunity;
- execution authority.

Verified identity still does not bypass SAB or a hard policy deny.

## ROEM calibration

### Refinement

Remove the loose `EXTERNAL_AUTH` object path that could represent a verified principal without a bound operator-session artifact.

### Opportunity

Provide a clean integration point for the future human-owned secret / OTP / passkey configuration without leaking those credentials into Northstar or the 14-role context.

### Enhancement

Add factor taxonomy, assertion binding, freshness, replay consumption, operator-session artifact, and Northstar linkage.

### Mitigation

Keep actual credential verification, provider identity, secret storage, delivery channels, and durable session storage outside the current prototype.

### Evidence / recalibration

Adversarial tests cover:

- valid knowledge + possession flow;
- same-class factor inflation;
- channel/class relabeling;
- assertion replay;
- nonce replay;
- identity mutation;
- expiry;
- forged operator-session binding;
- Sal/Bjorn session-to-principal mismatch.

## Design law

> **Knowing the phrase is not identity. Passing multiple verification steps is not authority. A verified operator session is only an authenticated-context input once its external issuer is independently trusted; consequential action still passes through the Trust Spine / Trust Admission / SAB chain.**
