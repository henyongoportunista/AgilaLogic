# PR #10 red-team note — 2026-10-25

Historical checkpoint. The subsequent consent, assurance and composition pass
is documented in [pr10-security-hardening.md](pr10-security-hardening.md).
The commit and CI references below describe this earlier checkpoint only.

Latest verified head before this note: `6d04744d134f0fbf5af3dd503998278bd739f85b`
Latest verified CI run: `40180488895` — PASS.

## Material findings fixed

1. **Verified-principal spoof path**
   - Finding: `compileNorthstarContext()` previously accepted a caller-fabricated `VERIFIED_SAL` / `VERIFIED_BJORN` object as long as the string `EXTERNAL_AUTH` was present.
   - Fix: verified PrincipalContext objects are now process-locally stamped only by `resolveVerifiedPrincipalContext()` after verifier success. Northstar rejects unstamped verified contexts. Verified Northstar context packs are also process-locally stamped, so copied/deserialized verified packs require re-verification.
   - Calibration: this is an application-boundary guard, not cryptographic identity proof. A real auth provider/session verifier is still required.

2. **Malformed external lifecycle registry payload**
   - Finding: the Supabase CAS boundary was atomic but the persisted JSON registry was not sufficiently validated at every load/write boundary.
   - Fix: TypeScript now validates registry version, lifecycle uniqueness, context isolation, time windows, supersession shape and chain consistency. Supabase SQL validates registry version, entries array, same-context entries, basic required fields, lifecycle uniqueness and self-supersession before CAS.
   - Calibration: live durability/atomicity is not claimed until the SQL is applied and integration-tested against the actual Supabase project.

## Remaining deliberate gaps

- real passkey/MFA/auth-provider implementation
- authenticated adapter/executor identity
- cryptographic/tamper-evident provenance and receipts
- live Supabase migration/integration test
- real external execution adapter
- external-system TOCTOU support where the provider has no ETag/version/precondition mechanism

No merge or deployment is authorized by this note.
