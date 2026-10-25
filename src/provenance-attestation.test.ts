import { weaveSignals } from "./gagamba.js";
import {
  assertProvenanceAttestationFresh,
  bindProvenanceAttestation,
  provenanceAttestationMatchesEntry,
  verifyProvenanceAttestation,
} from "./provenance-attestation.js";
import { buildProvenanceLedger, type ProvenanceLedgerEntry } from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try {
    fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const weave = weaveSignals({
  signals: [
    {
      id: "attested-fact",
      kind: "FACT",
      text: "The sandbox fixture exists.",
      provenance: {
        sourceClass: "TOOL_OBSERVED",
        producer: "fixture-tool",
        observedAt: "2026-10-25T08:10:00.000Z",
        sourceRef: "fixture://sandbox",
        evidenceRef: "fixture://sandbox/evidence",
      },
    },
  ],
  candidates: [],
});

const ledger = buildProvenanceLedger(weave);
const entry = ledger.entries[0];
assert(entry !== undefined, "fixture provenance entry must exist");

const attestation = bindProvenanceAttestation(entry, {
  attestationId: "source-attestation-1",
  verifierId: "future-source-verifier",
  verifiedAt: "2026-10-25T08:11:00.000Z",
  expiresAt: "2026-10-25T09:00:00.000Z",
  evidenceRef: "opaque:source-verification-1",
});

{
  assert(verifyProvenanceAttestation(attestation), "bound provenance attestation must verify structurally");
  assert(provenanceAttestationMatchesEntry(attestation, entry), "attestation must match exact ledger entry");
  assertProvenanceAttestationFresh(attestation, new Date("2026-10-25T08:30:00.000Z"));
}

{
  const tampered = { ...attestation, text: "A different fact was substituted." };
  assert(!verifyProvenanceAttestation(tampered), "attestation content mutation must invalidate binding");
}

{
  const changedEntry: ProvenanceLedgerEntry = { ...entry, text: "The fixture changed after verification." };
  assert(!provenanceAttestationMatchesEntry(attestation, changedEntry), "attestation must not match changed signal content");
}

{
  throwsWith(
    () => assertProvenanceAttestationFresh(attestation, new Date("2026-10-25T09:00:00.000Z")),
    "provenance_attestation_expired",
    "provenance attestation must fail exactly at expiry",
  );
}

{
  const unknownEntry: ProvenanceLedgerEntry = {
    signalId: "unknown-source",
    kind: "FACT",
    text: "Unknown source claim.",
    provenance: {
      sourceClass: "UNKNOWN_SOURCE",
      producer: "unknown",
      observedAt: "2026-10-25T08:10:00.000Z",
    },
  };
  throwsWith(
    () => bindProvenanceAttestation(unknownEntry, {
      attestationId: "unknown-source-attestation",
      verifierId: "future-source-verifier",
      verifiedAt: "2026-10-25T08:11:00.000Z",
      expiresAt: "2026-10-25T09:00:00.000Z",
    }),
    "unknown_source_cannot_be_attested",
    "UNKNOWN_SOURCE must not be upgraded by a structural attestation wrapper",
  );
}

{
  const forgedSourceEntry = {
    signalId: "forged-source-class",
    kind: "FACT",
    text: "Forged source class claim.",
    provenance: {
      sourceClass: "TRUST_ME_BRO",
      producer: "attacker",
      observedAt: "2026-10-25T08:10:00.000Z",
    },
  } as unknown as ProvenanceLedgerEntry;
  throwsWith(
    () => bindProvenanceAttestation(forgedSourceEntry, {
      attestationId: "forged-source-attestation",
      verifierId: "future-source-verifier",
      verifiedAt: "2026-10-25T08:11:00.000Z",
      expiresAt: "2026-10-25T09:00:00.000Z",
    }),
    "invalid_provenance_source_class",
    "runtime source-class forgery must fail even when compile-time types are bypassed",
  );
}

{
  const modelFactEntry: ProvenanceLedgerEntry = {
    signalId: "model-fact",
    kind: "FACT",
    text: "Model-origin fact claim.",
    provenance: {
      sourceClass: "MODEL_DERIVED",
      producer: "model",
      observedAt: "2026-10-25T08:10:00.000Z",
    },
  };
  throwsWith(
    () => bindProvenanceAttestation(modelFactEntry, {
      attestationId: "model-fact-attestation",
      verifierId: "future-source-verifier",
      verifiedAt: "2026-10-25T08:11:00.000Z",
      expiresAt: "2026-10-25T09:00:00.000Z",
    }),
    "model_derived_fact_cannot_be_attested",
    "structural source attestation must not launder model-derived FACT provenance",
  );
}

{
  throwsWith(
    () => bindProvenanceAttestation(entry, {
      attestationId: "predating-attestation",
      verifierId: "future-source-verifier",
      verifiedAt: "2026-10-25T08:09:59.000Z",
      expiresAt: "2026-10-25T09:00:00.000Z",
    }),
    "provenance_attestation_predates_observation",
    "source verification must not predate the observation it claims to verify",
  );
}

console.log("provenance attestation tests passed");
