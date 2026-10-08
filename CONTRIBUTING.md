# Contributing

AgilaLogic changes should preserve architectural clarity, evidence proportionality, and bounded authority.

## Contribution rules

1. Preserve the core execution spine unless a change is explicitly justified by evidence.
2. Do not merge observation and action into one opaque step.
3. Keep facts, inferences, predictions, preferences, and unknowns distinguishable.
4. Do not increase tool authority as a side effect of an unrelated change.
5. Prefer deterministic logic for scoring, gating, permission checks, retries, and idempotency.
6. Use language models only where fuzzy interpretation is actually needed.
7. Any external write path must identify its permission, approval, verification, and rollback behavior.
8. Tests or simulations must not leave fake production evidence behind.

## Change process

For a non-trivial change, describe:

- what problem exists,
- why the current behavior is insufficient,
- the smallest architecture-preserving fix,
- what could fail,
- how the result will be verified.

## Commit style

Prefer short, scoped messages such as:

- `docs: clarify approval semantics`
- `core: add deterministic risk gate`
- `integrations: add read-only github sensor`
- `fix: prevent duplicate feedback application`

## Security

Follow `SECURITY.md`. Never commit secrets, credentials, OTPs, access tokens, or private production data.
