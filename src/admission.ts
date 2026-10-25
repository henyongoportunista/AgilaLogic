import type { ActionProposal } from "./sab.js";
import {
  assertNorthstarContextFresh,
  verifyNorthstarContextPack,
  type NorthstarContextPack,
} from "./northstar.js";
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
} from "./trust.js";

export const TRUST_ADMISSION_VERSION = "2026-10-25.3" as const;

export interface TrustAdmissionInput {
  provenanceLedger: ProvenanceLedger;
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
    northstarContextBinding: string;
    operatorAuthBinding: string | null;
    operatorAuthTrust: string | null;
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

function validateFactProvenance(
  ledger: ProvenanceLedger,
  architectureState: BoundArchitectureState,
  reasons: string[],
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

  for (const fact of architectureState.architecture.facts) {
    const matches = ledger.entries.filter((entry) => entry.kind === "FACT" && entry.text === fact);
    if (matches.length === 0) {
      addOnce(reasons, "architecture_fact_missing_provenance_record");
      continue;
    }

    const hasKnownOrigin = matches.some(
      (entry) =>
        entry.provenance !== null &&
        entry.provenance.sourceClass !== "UNKNOWN_SOURCE" &&
        entry.provenance.sourceClass !== "MODEL_DERIVED",
    );

    if (!hasKnownOrigin) {
      addOnce(reasons, "architecture_fact_unresolved_provenance");
    }

    if (matches.some((entry) => ledger.provenanceGapSignalIds.includes(entry.signalId))) {
      addOnce(reasons, "architecture_fact_has_provenance_gap");
    }
  }
}

/**
 * Mandatory structural composition gate before a proposal may be presented to SAB.
 *
 * It does not authenticate the operator, adapter, provenance source, or model.
 * It does not call SAB and does not grant execution authority.
 */
export function admitForSab(input: TrustAdmissionInput): TrustAdmissionResult {
  const reasons: string[] = [];
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

  validateFactProvenance(input.provenanceLedger, input.architectureState, reasons);

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
    if (
      input.northstarContext.principal !== "UNVERIFIED_PUBLIC" &&
      (input.northstarContext.operatorAuthBinding === null || input.northstarContext.operatorAuthTrust === null)
    ) {
      addOnce(reasons, "northstar_verified_principal_missing_auth_evidence");
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
        northstarContextBinding: input.northstarContext.contextBinding,
        operatorAuthBinding: input.northstarContext.operatorAuthBinding,
        operatorAuthTrust: input.northstarContext.operatorAuthTrust,
        attestationId: operationComparison.candidate.attestationId,
        adapterId: operationComparison.candidate.adapterId,
        principal: input.northstarContext.principal,
        roleId: input.northstarContext.roleId,
      },
    },
  };
}
