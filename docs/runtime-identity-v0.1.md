# Runtime Identity Boundary v0.1

This stacked slice prevents caller-declared adapter/executor identity from being treated as trusted runtime identity.

## Invariants

- Callers do not provide `actorId` in runtime identity evidence.
- A server-side `RuntimeIdentityVerifier` resolves adapter/executor identity from its own provider/session mapping.
- Resolved identities are process-locally stamped and deterministically bound.
- Copied/deserialized resolved identities lose the runtime stamp and require re-verification.
- Adapter operation attestations must be coupled to a fresh resolved ADAPTER identity whose actor ID exactly matches the attestation adapter ID.
- Trust Admission accepts only the verified adapter-attestation wrapper, not a raw caller/model adapter attestation.
- A verified runtime identity does not create SAB or execution authority.

## Non-claims

This source-level boundary does not provide a real authentication provider, signing key, certificate chain, hardware attestation, or executor. Assurance strings are claims produced by the configured verifier and become meaningful only when backed by a real trusted provider implementation.
