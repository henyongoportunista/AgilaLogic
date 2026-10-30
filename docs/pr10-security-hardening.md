# PR #10 — consent and security-composition hardening

This extends the Trust Spine draft on `feat/trust-spine-v0-3-replay-rfi` from
`e486b934db0e77eeb63e1bce4bf970e2d3233586`. It remains an experimental backend
prototype. No executor, production provider, credential, migration, merge, or
deployment is introduced. The HTO frontend is unchanged.

## Boundaries and confirmed failures

Authentication answers who is present. Consent answers whether that human
approved this exact transaction. Trust Admission checks consistency with the
current Architecture/Engineering truth. SAB determines policy eligibility.
Pre-execution rechecks those boundaries; it performs no external operation.

The starting source confirmed all five requested gaps:

1. A verified session plus a caller-created `ApprovalRecord` could produce a
   session-bound approval without independent evidence of deliberate consent.
2. The verifier supplied an assurance level, but the approval path did not
   enforce consequence-specific assurance.
3. Authentication admission accepted caller-injected verifier implementations.
4. Lifecycle registries could grow without a per-context entry limit.
5. Supabase RPC failures could expose raw provider response text.

Composition review also reproduced and closed these related failures:

- A bounded READ could return an allowing route while cost or secret status was
  unknown. Unknown/nonzero cost and unknown secret status now route upward.
- Mutable verified auth metadata could undermine a process-local identity stamp.
  Issued identity, assurance and Northstar objects are now frozen and privately
  tracked, with authentication metadata included in the context binding.
- Awaited external reads/verifications could outlive an earlier default clock.
  Default clocks are refreshed after the await, before the consequential check.
- Separate Architecture and Engineering reads could each succeed against
  incompatible registry snapshots. Both active states now use one validated
  context snapshot in preparation and in the final checkpoint.
- Publicly recomputable JSON bindings allowed a forged low-risk prepared request
  to skip actual Trust Admission. Every prepared route now requires private
  process-local issuance, and the declared SAB route is recomputed.
- Caller-owned request fields, nested transaction/resource data and explicit clocks
  could change during awaited lifecycle I/O. Preparation and the final checkpoint
  now operate on entry snapshots while preserving exact privately issued objects.
- A successful final checkpoint could be repeated. Each issued preparation now
  permits only one successful final checkpoint in its issuing process.

## Human consent contract

`src/human-consent.ts` owns bounded server challenges and privately issued
`HumanConsentReceipt` objects. The receipt binds:

- version, challenge ID and independently generated consent ID;
- verified principal, session and exact Northstar context;
- canonical proposal and exact operation binding;
- SAB policy version and assurance-policy version;
- issuance, expiry, decision and runtime mode.

The operation binding includes both lifecycle trust bindings, proposal binding,
adapter ID, resource-state binding/token and SAB policy version. Preparation
recomputes it from current inputs. An approval cannot transfer to another
proposal, resource, adapter, lifecycle, session or principal.

The evidence allowlist is exactly `providerId`, `challengeId`, `verificationRef`.
It contains neither `approved: true` nor a caller-selected principal. A separate
trusted consent verifier must validate a deliberate response to the exact
challenge. An authentication verifier alone is insufficient.

Challenges expire after at most five minutes, capped by session expiry. Receipts
cannot extend that window. REJECTED receipts never authorize. A private receipt
brand rejects copied/deserialized, forged and cross-authority receipts. Duplicate
or concurrent challenge resolution cannot mint multiple receipts. Consumption
is synchronous after successful preparation checks; concurrent preparations
cannot consume the same receipt twice in one process. Raw `ApprovalRecord`
timestamps must equal the independent receipt window.

The consent authority retains at most 256 challenges, including resolved ones.
It fails closed at capacity; it does not evict replay evidence. There is no
durable/multi-process consent registry in this prototype.

## Authentication assurance and provider pinning

`src/assurance-policy.ts` expresses the versioned mapping:

| Declared operation | Minimum assurance before consent |
| --- | --- |
| SAB permits a non-consequential operation | No additional operator assurance |
| `REQUIRE_HUMAN_APPROVAL` | `MFA` |
| `DELETE`, `PAYMENT`, `EXTERNAL_MESSAGE`, `PRODUCTION_DEPLOY`, `PERMISSION_CHANGE`, or SECRET data | `PHISHING_RESISTANT_MFA` |
| SAB `DENY` | Cannot proceed at any assurance level |

These are policy rules over declared metadata, not proof that the real operation
matches that metadata. There is no new governance-mutation action type or invented
Sal/Bjorn hierarchy. The trusted `PrincipalConsentCapability` callback is a
neutral policy hook. A future governance operation must be explicitly classified
and mapped before enabling it.

The existing authentication resolver now accepts only a privately branded
`AuthVerifierRegistry`. Production providers must come from a private static
allowlist. It is intentionally empty: unknown providers fail closed, and there
is no public registration or arbitrary production verifier-injection API.

Test providers and consent authorities are explicitly marked `test`. Resolver,
approval, preparation and final-check entry points default to `production` and
reject incompatible test stamps. A property injected into an input object cannot
select runtime mode. The separate mode argument is trusted server composition;
it must never come from request/model data. No actual auth/MFA provider is added.

## Lifecycle and provider-error contracts

`MAX_LIFECYCLE_ENTRIES_PER_CONTEXT` is 256. TypeScript validates the limit before
entry traversal/cloning and before append/supersession mutation. Outgoing CAS
and the tracked SQL contract enforce the same limit. At capacity, new lifecycle
registration fails closed without deleting tombstones, changing the revision or
superseding current active state. Duplicate replay remains rejected.

`assertPersistedLifecyclePairActive()` first rejects differing context IDs, then
loads exactly one registry snapshot and verifies both active states against it.
This prevents inconsistent separate-read composition. It does not make a store
read and a future external side effect one atomic transaction.

Supabase fetch rejection, non-success HTTP response, invalid JSON and unexpected
success response shapes expose the fixed error `lifecycle_store_backend_error`.
Raw failed response bodies are not read, and provider errors are not attached
through `Error.cause`. Known local structural validation retains fixed codes.
No diagnostics or logging subsystem is introduced.

The SQL capacity/null-kind guard is a source change only. It was not applied to
any database. Supabase tests use mocked fetch and nonfunctional fixture keys.

## API compatibility and lifecycle

- External auth boundary: `2026-10-25.2`.
- Northstar context: `2026-10-25.3`.
- SAB policy: `2026-10-25.3`.
- Pre-execution contract: `2026-10-25.3`.
- Human consent and assurance policy: `2026-10-25.1`.

Older approval/policy bindings require fresh issuance. Authentication callers
must use a pinned registry. Consequential approval callers must supply an
independently issued consent receipt plus the exact operation binding.

The intended test-only composition is illustrated by
`src/execution-security.fixture.ts`: resolve fixture authentication explicitly
in test mode, obtain Northstar context, create the exact operation binding,
issue a challenge, verify its independent response, bind the receipt, then
prepare and finally recheck. This fixture grants no real human governance role.
Production factories intentionally cannot complete this flow until independently
reviewed provider and capability configuration exist.

Prepared objects and bound approvals are frozen and process-local. Serialization
does not preserve authority; restart/another worker requires fresh verification
and preparation. The final checkpoint is one-time for every route. Failed checks
do not consume it. `verifyPreExecutionRequest()` verifies private origin and
structure; it is not itself permission to execute. The mandatory final checkpoint
must run before any future executor side effect.

`isExecutionAuthorized()` remains a low-level SAB eligibility primitive. It is
not an authentication/consent boundary. The demo HTTP approval UI remains an
explicit unauthenticated simulation with no execution adapter. It must not be
exposed or described as production human authorization.

## Verification evidence

`npm run ci` passes locally: TypeScript typecheck, compilation and all 21 test
programs. New suites cover 30 consent cases, 21 composed execution cases, four
async-clock cases, seven lifecycle-composition cases, five asynchronous input-alias cases, assurance policy, replay
capacity and sanitized provider failures. Existing tests remain in the command.
The unmodified CI portfolio-accessibility contract also passes locally.

The local runner uses Node 24.19.0 with TypeScript 5.9.3; supported repository CI
uses Node 22. Dependencies and `package-lock.json` are unchanged. Local fresh
dependency audit and HTTP socket smoke require environment capabilities that
may be restricted. Their actual final results and the new exact-head GitHub
Node-22 CI run belong in the PR verification record, not an inferred claim here.
Earlier green CI runs do not establish that this new commit passed.

## Remaining gaps and human decisions

Implemented mechanisms are process-local prototype boundaries, not cryptographic
authentication, durable distributed one-time consent, signed provenance or
authenticated adapter/executor identity. Deterministic JSON binding is not a
signature. Resource tokens remain unauthenticated structural observations.

Not implemented: real operator auth/MFA/passkeys, production consent provider,
adapter-derived independent operation truth, real execution, durable verified
receipts, live Supabase migration/integration, cross-worker consent/CAS, global
registry byte/context quotas, provider revocation refresh, tamper-evident audit,
or atomic lifecycle-and-external-operation commit. No receipt proves side effects.
No prompt-injection immunity, perfect replay prevention, perfect TOCTOU
elimination, or comprehensive accessibility certification is claimed.

Before production enablement, Sal/Bjorn must specify which principal capabilities
or joint approvals apply to each consequential class. This pass makes no such
governance decision. Production remains unconfigured and fails closed. Merge,
deployment, real credentials, external execution and migration to
`HenyongTO/PsychoJudoMasters` remain outside this pass.

**NOT MERGED / NOT DEPLOYED.**
