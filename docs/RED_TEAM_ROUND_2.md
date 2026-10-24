# Red-Team Round 2 — Cross-Functional Review

**Scope:** Sovereign Assurance Boundary + local portfolio demo  
**Purpose:** Find failure modes that a first security-centric pass could miss.  
**Status:** Findings refined into code/tests before merge.

This round deliberately changed professional lenses instead of repeating the first review. It was informed by current secure-application, accessibility, AI-risk, and Node/supply-chain guidance, but it is **not** a claim of certification or formal compliance.

## 1. Application Security perspective

### Findings

- Low-risk routing could inherit harmless defaults when optional risk fields were omitted.
- Unknown field names were echoed in validation reasons, creating an unnecessary attacker-controlled logging surface.
- Browser POST endpoints accepted requests without an explicit JSON/same-origin boundary.
- Approval needed to remain valid only under the policy version that evaluated it.

### Refinements

- Adopted `unknown != safe`: missing blast radius, cost, secret status, or read volume now routes upward rather than to low-risk auto-admission.
- Unknown fields now produce the fixed reason `unexpected_field`; raw attacker-controlled field names are not repeated.
- POST API now requires JSON, rejects explicit cross-site requests, and rejects mismatched Origin when present.
- Approval and pending state bind to `SAB_POLICY_VERSION`.

## 2. Backend / API engineering perspective

### Findings

- Read-only operations needed volume-aware policy, not only sensitivity-aware policy.
- Contradictory metadata such as `containsSecrets=true` with non-secret sensitivity should fail closed.
- Raw resource targets did not need to appear in the demo audit record.

### Refinements

- Unknown-size and bulk reads route to authority.
- Contradictory secret classification fails validation.
- Audit events keep action/policy/result metadata without persisting the raw target.
- Health and authorization responses expose active policy version and explicit non-capabilities.

## 3. SRE / platform perspective

### Findings

- A local-only server can still be resource-exhausted accidentally or during future exposure if request lifetime/header counts are unbounded.
- Body limit alone is not a complete resource boundary.

### Refinements

- Added request timeout, header timeout, keep-alive timeout, maximum header count, and client-error handling.
- Retained bounded request body, pending-approval count, audit count, and loopback-only default binding.
- Added CI tests for oversized bodies and request-origin boundaries.

## 4. QA / test engineering perspective

### Findings

- First-round tests concentrated on direct authorization bypass and happy-path integration.
- New controls needed regression tests for omission, contradiction, policy drift, API content type, origin mismatch, audit minimization, bulk reads, and oversized requests.

### Refinements

CI now verifies:

- incomplete low-risk metadata routes upward,
- unknown and bulk read volume routes upward,
- stale policy approvals fail,
- contradictory secret metadata fails,
- forged authorization fails,
- replay fails,
- cross-site and mismatched-origin POST requests fail,
- non-JSON POST requests fail,
- oversized bodies fail,
- secret exfiltration remains a hard deny,
- raw target/attacker validation text does not leak into the audit ledger.

## 5. UX / accessibility perspective

### Findings

- An in-flight evaluation could theoretically return after operator context changed, creating stale-decision confusion.
- Selected scenario state was primarily visual.
- Dynamic decision/status changes needed stronger assistive-technology signaling.
- Focus visibility, reduced-motion behavior, and one low-contrast footer color needed hardening.

### Refinements

- Added generation-based stale-response rejection plus disabled scenario controls during evaluation.
- Added `aria-pressed` scenario state.
- Added polite live regions for decision/execution status.
- Added visible `:focus-visible` styling and reduced-motion handling.
- Raised footer text contrast and added a CI contrast regression contract.

This is an accessibility baseline, not a claim of full WCAG conformance. Browser-level axe/Playwright and manual keyboard/screen-reader testing remain future work.

## 6. AI governance / risk perspective

### Findings

- Threshold numbers risk looking like universal truths if not explicitly scoped.
- Approval semantics need a policy-version identity, not just proposal identity.
- The central production risk remains metadata truth: a model cannot be trusted to label its own concrete operation as safe.

### Refinements

- Marked blast/read thresholds as illustrative demo policy placeholders rather than empirical standards.
- Bound decisions/approvals to explicit policy version.
- Retained adapter metadata attestation as the highest-priority production blocker.
- Documented `estimatedCost` unit/currency ambiguity as unresolved before financial use.

## 7. Supply-chain / build engineering perspective

### Findings

- CI used a floating dependency range and lacked a committed lockfile.
- GitHub Actions major tags were not immutable pins and the older major emitted a Node runtime deprecation warning.

### Refinements

- Pinned TypeScript to an exact version.
- Added a committed npm lockfile.
- Moved CI to `npm ci --ignore-scripts`.
- Added high-severity `npm audit` gating.
- Pinned current GitHub Actions releases to exact commit SHAs.
- Disabled persisted checkout credentials.

## Current residual risks

The following remain intentionally unresolved and block any claim of production-grade autonomous execution:

1. No authenticated Node Alpha identity.
2. No cryptographic approval signature.
3. No persistent/tamper-evident audit ledger.
4. No trusted execution-adapter metadata attestation.
5. No production tenant authorization/isolation.
6. No public rate limiting/abuse controls.
7. No real external execution adapter.
8. No real model-provider proposal adapter.
9. No explicit cost currency/unit model.
10. No browser-level automated + manual accessibility certification pass.

## Round-2 conclusion criteria

This round is considered green only when the **exact final PR head** passes all of the following after the refinements above:

- TypeScript typecheck,
- unit/adversarial tests,
- dependency audit,
- accessibility regression contract,
- adversarial HTTP/API smoke suite.

A prior green commit is not sufficient evidence for a later modified head.
