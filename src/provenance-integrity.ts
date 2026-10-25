import type { BoundArchitectureState, ProvenanceLedger } from "./trust.js";

export const PROVENANCE_INTEGRITY_VERSION = "2026-10-25.1" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export interface ProvenanceIntegrityEnvelope {
  version: typeof PROVENANCE_INTEGRITY_VERSION;
  architectureTrustBinding: string;
  ledgerBinding: string;
  binding: string;
}

function envelopeBinding(
  envelope: Omit<ProvenanceIntegrityEnvelope, "binding">,
): string {
  return canonicalString(envelope);
}

export function provenanceLedgerBinding(ledger: ProvenanceLedger): string {
  return canonicalString(ledger);
}

/**
 * Binds the exact provenance ledger to the exact bound Architecture state.
 * This detects mutation/drift inside the current trust chain but is deliberately
 * non-cryptographic: it does not authenticate the provenance producer, evidence,
 * or storage layer and an attacker able to rewrite all artifacts could recompute it.
 */
export function bindProvenanceLedger(
  ledger: ProvenanceLedger,
  architectureState: BoundArchitectureState,
): ProvenanceIntegrityEnvelope {
  const payload: Omit<ProvenanceIntegrityEnvelope, "binding"> = {
    version: PROVENANCE_INTEGRITY_VERSION,
    architectureTrustBinding: architectureState.trustBinding,
    ledgerBinding: provenanceLedgerBinding(ledger),
  };

  return { ...payload, binding: envelopeBinding(payload) };
}

export function verifyProvenanceIntegrity(
  ledger: ProvenanceLedger,
  architectureState: BoundArchitectureState,
  integrity: ProvenanceIntegrityEnvelope,
): boolean {
  if (typeof integrity !== "object" || integrity === null) return false;
  if (integrity.version !== PROVENANCE_INTEGRITY_VERSION) return false;
  if (integrity.architectureTrustBinding !== architectureState.trustBinding) return false;
  if (integrity.ledgerBinding !== provenanceLedgerBinding(ledger)) return false;

  const { binding, ...payload } = integrity;
  return binding === envelopeBinding(payload);
}
