import type { ActionProposal } from "./sab.js";
import {
  assertNorthstarContextFresh,
  verifyNorthstarContextPack,
  type NorthstarContextPack,
} from "./northstar.js";
import {
  verifyProvenanceIntegrity,
  type ProvenanceIntegrityEnvelope,
} from "./provenance-integrity.js";
import {
  assertProvenanceAttestationFresh,
  provenanceAttestationMatchesEntry,
  verifyProvenanceAttestation,
  type ProvenanceAttestation,
} from "./provenance-attestation.js";
import type { UntrustedSabProposalCandidate } from "./strand.js";
import {
  TRUST_SPINE_VERSION,
  assertPacketLifecycleFresh,
  compareAdapterAttestation,
  verifyBoundArchitectureState,
  verifyBoundEngineeringState,
  type AdapterAttestation,
  type BoundArchitectureState,
  type BoundEngineeringState,
  type ProvenanceLedger,
  type ProvenanceLedgerEntry,
} from "./trust.js";

export const TRUST_ADMISSION_VERSION = "2026-10-26.1" as const;
export const MAX_PROVENANCE_ATTESTATIONS = 256;

export interface TrustAdmissionInput {
  provenanceLedger: ProvenanceLedger;
  provenanceIntegrity: ProvenanceIntegrityEnvelope;
  provenanceAttestations: ProvenanceAttestation[];
  architectureState: BoundArchitectureState;
  engineeringState: BoundEngineeringState;
  northstarContext: NorthstarContextPack;
  expectation: UntrustedSabProposalCandidate;
  attestation: AdapterAttestation;
  now?: Date;
}

export interface SabAdmissibleCandidate {
  trust: "STRUCTURALLY_ADMITTED_UNAUTHENTICATED";
  admissionVersion: typeof TRUST_ADMISSION_VERSION;
  proposal: ActionProposal;
  evidence: {
    architectureTrustBinding: string;
    engineeringTrustBinding: string;
    provenanceIntegrityBinding: string;
    provenanceAttestationIds: string[];
    provenanceVerifierIds: string[];
    sourceTruthValidUntil: string;
    northstarContextBinding: string;
    attestationId: string;
    adapterId: string;
    principal: string;
    roleId: string;
  };
}

export interface TrustAdmissionResult {
  admitted: boolean;
  reasons: string[];
  candidate?: SabAdmissibleCandidate;
}

function addOnce(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function acceptedAttestationForEntry(
  entry: ProvenanceLedgerEntry,
  attestations: ProvenanceAttestation[],
  now: Date,
  requiredUntilMs: number,
): ProvenanceAttestation | undefined {
  for (const candidate of attestations) {
    if (!candidate || candidate.signalId !== entry.signalId) continue;
    if (!verifyProvenanceAttestation(candidate)) continue;
    if (!provenanceAttestationMatchesEntry(candidate, entry)) continue;
    try {
      assertProvenanceAttestationFresh(candidate, now);
    } catch {
      continue;
    }
    const expiresAt = new Date(candidate.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt < requiredUntilMs) continue;
    return candidate;
  }
  return undefined;
}

function validateFactProvenance(
  ledger: ProvenanceLedger,
  attestations: ProvenanceAttestation[],
  architectureState: BoundArchitectureState,
  engineeringState: BoundEngineeringState,
  now: Date,
  reasons: string[],
  acceptedAttestations: ProvenanceAttestation[],
): void {
  if (
    typeof ledger !== "object" ||
    ledger === null ||
    ledger.version !== TRUST_SPINE_VERSION ||
    !Array.isArray(ledger.entries) ||
    !Array.isArray(ledger.provenanceGapSignalIds)
  ) {
    addOnce(reasons, "invalid_provenance_ledger");
    return;
  }
  if (!Array.isArray(attestations)) {
    addOnce(reasons, "invalid_provenance_attestations");
    return;
  }
  if (attestations.length > MAX_PROVENANCE_ATTESTATIONS) {
    addOnce(reasons, "provenance_attestation_capacity_exceeded");
    return;
  }

  const attestationIds: string[] = [];
  for (const attestation of attestations) {
    if (typeof attestation !== "object" || attestation === null || typeof attestation.attestationId !== "string") {
      addOnce(reasons, "invalid_provenance_attestations");
      return;
    }
    attestationIds.push(attestation.attestationId);
  }
  if (new Set(attestationIds).size !== attestationIds.length) {
    addOnce(reasons, "duplicate_provenance_attestation_id");
  }

  const architectureExpiry = new Date(architectureState.lifecycle.expiresAt).getTime();
  const engineeringExpiry = new Date(engineeringState.lifecycle.expiresAt).getTime();
  const requiredUntilMs = Math.min(architectureExpiry, engineeringExpiry);
  if (!Number.isFinite(requiredUntilMs)) {
    addOnce(reasons, "source_truth_window_invalid");
    return;
  }

  for (const fact of architectureState.architecture.facts) {
    const matches = ledger.entries.filter((entry) => entry.kind === "FACT" && entry.text === fact);
    if (matches.length === 0) {
      addOnce(reasons, "architecture_fact_missing_provenance_record");
      continue;
    }

    const knownOriginEntries = matches.filter(
      (entry) =>
        entry.provenance !== null &&
        entry.provenance.sourceClass !== "UNKNOWN_SOURCE" &&
        entry.provenance.sourceClass !== "MODEL_DERIVED" &&
        !ledger.provenanceGapSignalIds.includes(entry.signalId),
    );

    if (knownOriginEntries.length === 0) {
      addOnce(reasons, "architecture_fact_unresolved_provenance");
      if (matches.some((entry) => ledger.provenanceGapSignalIds.includes(entry.signalId))) {
        addOnce(reasons, "architecture_fact_has_provenance_gap");
      }
      continue;
    }

    let accepted: ProvenanceAttestation | undefined;
    for (const entry of knownOriginEntries) {
      accepted = acceptedAttestationForEntry(entry, attestations, now, requiredUntilMs);
      if (accepted) break;
    }

    if (!accepted) {
      addOnce(reasons, "architecture_fact_provenance_not_attested_for_state_window");
      continue;
    }

    if (!acceptedAttestations.some((existing) => existing.attestationId === accepted!.attestationId)) {
      acceptedAttestations.push(accepted);
    }
  }
}

/**
 * Mandatory structural composition gate before a proposal may be presented to SAB.
 *
 * A FACT now needs both known provenance metadata and a fresh exact source
 * attestation that remains valid through the current Architecture/Engineering
 * state window. The verifier identity is still unauthenticated in this slice.
 *
 * This does not authenticate the operator, adapter, provenance verifier, source,
 * or model. Provenance integrity remains deterministic/non-cryptographic mutation
 * detection. This function does not call SAB and grants no execution authority.
 */
export function admitForSab(input: TrustAdmissionInput): TrustAdmissionResult {
  const reasons: string[] = [];
  const acceptedProvenanceAttestations: ProvenanceAttestation[] = [];
  const now = input.now ?? new Date();

  if (!Number.isFinite(now.getTime())) {
    return { admitted: false, reasons: ["invalid_now"] };
  }

  if (!verifyBoundArchitectureState(input.architectureState)) {
    addOnce(reasons, "architecture_state_invalid");
  } else {
    try {
      assertPacketLifecycleFresh(input.architectureState.lifecycle, now);
    } catch {
      addOnce(reasons, "architecture_state_not_fresh");
    }
  }

  if (!verifyBoundEngineeringState(input.engineeringState)) {
    addOnce(reasons, "engineering_state_invalid");
  } else {
    try {
      assertPacketLifecycleFresh(input.engineeringState.lifecycle, now);
    } catch {
      addOnce(reasons, "engineering_state_not_fresh");
    }
  }

  if (input.engineeringState.architectureTrustBinding !== input.architectureState.trustBinding) {
    addOnce(reasons, "engineering_architecture_state_mismatch");
  }

  if (
    input.engineeringState.engineering.architectureBinding !==
    input.architectureState.architecture.architectureBinding
  ) {
    addOnce(reasons, "engineering_architecture_binding_mismatch");
  }

  if (input.engineeringState.engineering.intent !== "PROPOSAL_ONLY") {
    addOnce(reasons, "engineering_intent_not_proposal_only");
  }

  if (input.expectation.architectureBinding !== input.architectureState.architecture.architectureBinding) {
    addOnce(reasons, "proposal_architecture_binding_mismatch");
  }
  if (input.expectation.engineeringBinding !== input.engineeringState.engineering.engineeringBinding) {
    addOnce(reasons, "proposal_engineering_binding_mismatch");
  }
  if (input.expectation.engineeringPacketId !== input.engineeringState.engineering.packetId) {
    addOnce(reasons, "proposal_engineering_packet_mismatch");
  }

  if (!verifyProvenanceIntegrity(
    input.provenanceLedger,
    input.architectureState,
    input.provenanceIntegrity,
  )) {
    addOnce(reasons, "provenance_integrity_invalid");
  }
  validateFactProvenance(
    input.provenanceLedger,
    input.provenanceAttestations,
    input.architectureState,
    input.engineeringState,
    now,
    reasons,
    acceptedProvenanceAttestations,
  );

  if (!verifyNorthstarContextPack(input.northstarContext)) {
    addOnce(reasons, "northstar_context_invalid");
  } else {
    try {
      assertNorthstarContextFresh(input.northstarContext, now);
    } catch {
      addOnce(reasons, "northstar_context_not_fresh");
    }

    if (input.northstarContext.roleId !== input.engineeringState.engineering.engineer) {
      addOnce(reasons, "northstar_engineer_role_mismatch");
    }
    if (input.northstarContext.lane !== "ENGINEER") {
      addOnce(reasons, "northstar_lane_mismatch");
    }
    if (input.northstarContext.authorityCeiling !== "PROPOSAL_ONLY") {
      addOnce(reasons, "northstar_authority_ceiling_mismatch");
    }
    if (input.northstarContext.architectureVersion !== input.engineeringState.engineering.version) {
      addOnce(reasons, "northstar_engineering_version_mismatch");
    }
  }

  const operationComparison = compareAdapterAttestation(input.expectation, input.attestation, now);
  if (!operationComparison.matched || !operationComparison.candidate) {
    addOnce(reasons, "operation_truth_mismatch");
    for (const reason of operationComparison.reasons) addOnce(reasons, reason);
  }

  if (reasons.length > 0 || !operationComparison.candidate) {
    return { admitted: false, reasons };
  }

  const sourceTruthValidUntilMs = Math.min(
    ...acceptedProvenanceAttestations.map((entry) => new Date(entry.expiresAt).getTime()),
  );

  return {
    admitted: true,
    reasons: ["source_state_role_and_operation_contracts_structurally_match"],
    candidate: {
      trust: "STRUCTURALLY_ADMITTED_UNAUTHENTICATED",
      admissionVersion: TRUST_ADMISSION_VERSION,
      proposal: { ...operationComparison.candidate.proposal },
      evidence: {
        architectureTrustBinding: input.architectureState.trustBinding,
        engineeringTrustBinding: input.engineeringState.trustBinding,
        provenanceIntegrityBinding: input.provenanceIntegrity.binding,
        provenanceAttestationIds: acceptedProvenanceAttestations.map((entry) => entry.attestationId).sort(),
        provenanceVerifierIds: [...new Set(acceptedProvenanceAttestations.map((entry) => entry.verifierId))].sort(),
        sourceTruthValidUntil: new Date(sourceTruthValidUntilMs).toISOString(),
        northstarContextBinding: input.northstarContext.contextBinding,
        attestationId: operationComparison.candidate.attestationId,
        adapterId: operationComparison.candidate.adapterId,
        principal: input.northstarContext.principal,
        roleId: input.northstarContext.roleId,
      },
    },
  };
}
