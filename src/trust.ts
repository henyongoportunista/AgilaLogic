import type { GagambaWeaveResult, ProvenanceEnvelope } from "./gagamba.js";
import {
  SAB_POLICY_VERSION,
  type ActionProposal,
  type ActionScope,
  type ActionType,
  type DataSensitivity,
} from "./sab.js";
import {
  verifyArchitecturePacket,
  verifyEngineeringPacket,
  type ArchitecturePacket,
  type EngineeringPacket,
  type UntrustedSabProposalCandidate,
} from "./strand.js";

export const TRUST_SPINE_VERSION = "2026-10-25.1" as const;

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;
const MAX_BINDING_LENGTH = 100_000;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function boundedText(value: string, maxLength: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const normalized = normalize(value);
  if (normalized.length === 0) throw new TypeError(`${label}_empty`);
  if (normalized.length > maxLength) throw new TypeError(`${label}_too_long`);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function parseIsoInstant(value: string, label: string): Date {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label}_invalid_iso_instant`);
  }
  return parsed;
}

export interface ProvenanceLedgerEntry {
  signalId: string;
  kind: string;
  text: string;
  provenance: ProvenanceEnvelope | null;
}

export interface ProvenanceLedger {
  version: typeof TRUST_SPINE_VERSION;
  entries: ProvenanceLedgerEntry[];
  provenanceGapSignalIds: string[];
}

export function buildProvenanceLedger(weave: GagambaWeaveResult): ProvenanceLedger {
  return {
    version: TRUST_SPINE_VERSION,
    entries: weave.trace.acceptedSignals.map((signal) => ({
      signalId: signal.id,
      kind: signal.kind,
      text: signal.text,
      provenance: signal.provenance ? { ...signal.provenance } : null,
    })),
    provenanceGapSignalIds: [...weave.trace.provenanceGapSignalIds],
  };
}

export interface PacketLifecycle {
  lifecycleId: string;
  contextId: string;
  issuedAt: string;
  expiresAt: string;
  policyVersion: string;
  supersedesLifecycleId?: string;
}

export function normalizePacketLifecycle(
  lifecycle: PacketLifecycle,
  expectedPolicyVersion = SAB_POLICY_VERSION,
): PacketLifecycle {
  if (typeof lifecycle !== "object" || lifecycle === null) {
    throw new TypeError("packet_lifecycle_required");
  }

  const lifecycleId = boundedText(lifecycle.lifecycleId, MAX_ID_LENGTH, "lifecycle_id");
  const contextId = boundedText(lifecycle.contextId, MAX_ID_LENGTH, "context_id");
  const policyVersion = boundedText(lifecycle.policyVersion, MAX_ID_LENGTH, "policy_version");
  const issuedAt = parseIsoInstant(lifecycle.issuedAt, "issued_at");
  const expiresAt = parseIsoInstant(lifecycle.expiresAt, "expires_at");

  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new TypeError("packet_lifecycle_nonpositive_window");
  }
  if (policyVersion !== expectedPolicyVersion) {
    throw new Error("packet_policy_version_mismatch");
  }

  return {
    lifecycleId,
    contextId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    policyVersion,
    ...(lifecycle.supersedesLifecycleId === undefined
      ? {}
      : {
          supersedesLifecycleId: boundedText(
            lifecycle.supersedesLifecycleId,
            MAX_ID_LENGTH,
            "supersedes_lifecycle_id",
          ),
        }),
  };
}

export function assertPacketLifecycleFresh(
  lifecycle: PacketLifecycle,
  now = new Date(),
  expectedPolicyVersion = SAB_POLICY_VERSION,
): void {
  const normalized = normalizePacketLifecycle(lifecycle, expectedPolicyVersion);
  const issuedAt = new Date(normalized.issuedAt).getTime();
  const expiresAt = new Date(normalized.expiresAt).getTime();
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs < issuedAt) throw new Error("packet_not_yet_valid");
  if (nowMs >= expiresAt) throw new Error("packet_expired");
}

export interface BoundArchitectureState {
  version: typeof TRUST_SPINE_VERSION;
  architecture: ArchitecturePacket;
  lifecycle: PacketLifecycle;
  trustBinding: string;
}

export interface BoundEngineeringState {
  version: typeof TRUST_SPINE_VERSION;
  engineering: EngineeringPacket;
  lifecycle: PacketLifecycle;
  architectureTrustBinding: string;
  trustBinding: string;
}

function architectureTrustBinding(
  architecture: ArchitecturePacket,
  lifecycle: PacketLifecycle,
): string {
  return canonicalString({
    trustSpineVersion: TRUST_SPINE_VERSION,
    architectureBinding: architecture.architectureBinding,
    lifecycle,
  });
}

function engineeringTrustBinding(
  engineering: EngineeringPacket,
  lifecycle: PacketLifecycle,
  architectureTrustBindingValue: string,
): string {
  return canonicalString({
    trustSpineVersion: TRUST_SPINE_VERSION,
    engineeringBinding: engineering.engineeringBinding,
    architectureTrustBinding: architectureTrustBindingValue,
    lifecycle,
  });
}

export function bindArchitectureLifecycle(
  architecture: ArchitecturePacket,
  lifecycle: PacketLifecycle,
  now = new Date(),
): BoundArchitectureState {
  if (!verifyArchitecturePacket(architecture)) throw new Error("architecture_binding_mismatch");
  const normalized = normalizePacketLifecycle(lifecycle);
  assertPacketLifecycleFresh(normalized, now);

  return {
    version: TRUST_SPINE_VERSION,
    architecture,
    lifecycle: normalized,
    trustBinding: architectureTrustBinding(architecture, normalized),
  };
}

export function verifyBoundArchitectureState(state: BoundArchitectureState): boolean {
  if (!verifyArchitecturePacket(state.architecture)) return false;
  try {
    const lifecycle = normalizePacketLifecycle(state.lifecycle);
    return state.trustBinding === architectureTrustBinding(state.architecture, lifecycle);
  } catch {
    return false;
  }
}

export function bindEngineeringLifecycle(
  engineering: EngineeringPacket,
  lifecycle: PacketLifecycle,
  architectureState: BoundArchitectureState,
  now = new Date(),
): BoundEngineeringState {
  if (!verifyBoundArchitectureState(architectureState)) {
    throw new Error("architecture_trust_binding_mismatch");
  }
  assertPacketLifecycleFresh(architectureState.lifecycle, now);
  if (!verifyEngineeringPacket(engineering)) throw new Error("engineering_binding_mismatch");
  if (engineering.architectureBinding !== architectureState.architecture.architectureBinding) {
    throw new Error("engineering_architecture_binding_mismatch");
  }

  const normalized = normalizePacketLifecycle(lifecycle);
  assertPacketLifecycleFresh(normalized, now);

  if (normalized.contextId !== architectureState.lifecycle.contextId) {
    throw new Error("packet_context_mismatch");
  }
  if (normalized.policyVersion !== architectureState.lifecycle.policyVersion) {
    throw new Error("packet_policy_version_mismatch");
  }

  const parentIssuedAt = new Date(architectureState.lifecycle.issuedAt).getTime();
  const parentExpiresAt = new Date(architectureState.lifecycle.expiresAt).getTime();
  const childIssuedAt = new Date(normalized.issuedAt).getTime();
  const childExpiresAt = new Date(normalized.expiresAt).getTime();

  if (childIssuedAt < parentIssuedAt) throw new Error("engineering_predates_architecture");
  if (childExpiresAt > parentExpiresAt) throw new Error("engineering_validity_exceeds_architecture");

  return {
    version: TRUST_SPINE_VERSION,
    engineering,
    lifecycle: normalized,
    architectureTrustBinding: architectureState.trustBinding,
    trustBinding: engineeringTrustBinding(engineering, normalized, architectureState.trustBinding),
  };
}

export function verifyBoundEngineeringState(state: BoundEngineeringState): boolean {
  if (!verifyEngineeringPacket(state.engineering)) return false;
  try {
    const lifecycle = normalizePacketLifecycle(state.lifecycle);
    return state.trustBinding === engineeringTrustBinding(
      state.engineering,
      lifecycle,
      state.architectureTrustBinding,
    );
  } catch {
    return false;
  }
}

export type RfiStatus = "OPEN" | "RESOLVED" | "EXPIRED" | "UNRESOLVABLE";
export type RfiOwner = "ARCHITECT" | "HUMAN" | "ARCHITECT_OR_HUMAN";

const RFI_OWNERS = new Set<RfiOwner>(["ARCHITECT", "HUMAN", "ARCHITECT_OR_HUMAN"]);

export interface RfiLifecycle {
  version: typeof TRUST_SPINE_VERSION;
  rfiId: string;
  architectureBinding: string;
  engineeringBinding: string;
  contextId: string;
  status: RfiStatus;
  owner: RfiOwner;
  question: string;
  round: number;
  maxRounds: number;
  openedAt: string;
  expiresAt: string;
  resolution?: string;
  binding: string;
}

function rfiBinding(rfi: Omit<RfiLifecycle, "binding">): string {
  return canonicalString(rfi);
}

export interface OpenRfiInput {
  rfiId: string;
  architectureBinding: string;
  engineeringBinding: string;
  contextId: string;
  owner: RfiOwner;
  question: string;
  maxRounds: number;
  openedAt: string;
  expiresAt: string;
}

export function openRfi(input: OpenRfiInput): RfiLifecycle {
  if (!RFI_OWNERS.has(input.owner)) throw new TypeError("invalid_rfi_owner");
  if (!Number.isInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 20) {
    throw new TypeError("invalid_rfi_max_rounds");
  }
  const openedAt = parseIsoInstant(input.openedAt, "rfi_opened_at");
  const expiresAt = parseIsoInstant(input.expiresAt, "rfi_expires_at");
  if (expiresAt.getTime() <= openedAt.getTime()) throw new TypeError("invalid_rfi_window");

  const payload: Omit<RfiLifecycle, "binding"> = {
    version: TRUST_SPINE_VERSION,
    rfiId: boundedText(input.rfiId, MAX_ID_LENGTH, "rfi_id"),
    architectureBinding: boundedText(input.architectureBinding, MAX_BINDING_LENGTH, "architecture_binding"),
    engineeringBinding: boundedText(input.engineeringBinding, MAX_BINDING_LENGTH, "engineering_binding"),
    contextId: boundedText(input.contextId, MAX_ID_LENGTH, "rfi_context_id"),
    status: "OPEN",
    owner: input.owner,
    question: boundedText(input.question, MAX_TEXT_LENGTH, "rfi_question"),
    round: 1,
    maxRounds: input.maxRounds,
    openedAt: openedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return { ...payload, binding: rfiBinding(payload) };
}

export function verifyRfiLifecycle(rfi: RfiLifecycle): boolean {
  const { binding, ...payload } = rfi;
  return binding === rfiBinding(payload);
}

function assertRfiOpen(rfi: RfiLifecycle, now: Date): void {
  if (!verifyRfiLifecycle(rfi)) throw new Error("rfi_binding_mismatch");
  if (rfi.status !== "OPEN") throw new Error("rfi_not_open");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs >= new Date(rfi.expiresAt).getTime()) throw new Error("rfi_expired");
}

export function continueRfi(rfi: RfiLifecycle, nextQuestion: string, now = new Date()): RfiLifecycle {
  assertRfiOpen(rfi, now);
  const { binding: _binding, ...current } = rfi;

  if (rfi.round >= rfi.maxRounds) {
    const terminal: Omit<RfiLifecycle, "binding"> = {
      ...current,
      status: "UNRESOLVABLE",
    };
    return { ...terminal, binding: rfiBinding(terminal) };
  }

  const next: Omit<RfiLifecycle, "binding"> = {
    ...current,
    question: boundedText(nextQuestion, MAX_TEXT_LENGTH, "rfi_question"),
    round: rfi.round + 1,
  };
  return { ...next, binding: rfiBinding(next) };
}

export function resolveRfi(rfi: RfiLifecycle, resolution: string, now = new Date()): RfiLifecycle {
  assertRfiOpen(rfi, now);
  const { binding: _binding, ...current } = rfi;
  const resolved: Omit<RfiLifecycle, "binding"> = {
    ...current,
    status: "RESOLVED",
    resolution: boundedText(resolution, MAX_TEXT_LENGTH, "rfi_resolution"),
  };
  return { ...resolved, binding: rfiBinding(resolved) };
}

export function expireRfi(rfi: RfiLifecycle, now = new Date()): RfiLifecycle {
  if (!verifyRfiLifecycle(rfi)) throw new Error("rfi_binding_mismatch");
  if (rfi.status !== "OPEN") throw new Error("rfi_not_open");
  if (now.getTime() < new Date(rfi.expiresAt).getTime()) throw new Error("rfi_not_expired");

  const { binding: _binding, ...current } = rfi;
  const expired: Omit<RfiLifecycle, "binding"> = { ...current, status: "EXPIRED" };
  return { ...expired, binding: rfiBinding(expired) };
}

export interface AttestedCost {
  amount: number;
  unit: string;
  currency?: string;
}

export interface AttestedOperation {
  type: ActionType;
  scope: ActionScope;
  target: string;
  reversible: boolean;
  dataSensitivity: DataSensitivity;
  affectedRecords?: number;
  estimatedCost?: AttestedCost;
  containsSecrets?: boolean;
}

export interface AdapterAttestation {
  version: typeof TRUST_SPINE_VERSION;
  attestationId: string;
  requestId: string;
  proposalId: string;
  engineeringBinding: string;
  policyVersion: string;
  adapterId: string;
  observedAt: string;
  expiresAt: string;
  operation: AttestedOperation;
}

export interface AdapterMatchedProposalCandidate {
  trust: "ADAPTER_MATCHED_UNAUTHENTICATED";
  attestationId: string;
  adapterId: string;
  proposal: ActionProposal;
}

export interface AdapterAttestationComparison {
  matched: boolean;
  reasons: string[];
  candidate?: AdapterMatchedProposalCandidate;
}

function compareOptional<T>(
  label: string,
  proposalValue: T | undefined,
  attestedValue: T | undefined,
  reasons: string[],
): void {
  if (proposalValue !== attestedValue) reasons.push(`${label}_mismatch`);
}

export function compareAdapterAttestation(
  expectation: UntrustedSabProposalCandidate,
  attestation: AdapterAttestation,
  now = new Date(),
): AdapterAttestationComparison {
  const reasons: string[] = [];
  if (!isRecord(attestation) || !isRecord(attestation.operation)) {
    return { matched: false, reasons: ["invalid_attestation_shape"] };
  }

  try {
    boundedText(attestation.attestationId, MAX_ID_LENGTH, "attestation_id");
    boundedText(attestation.requestId, MAX_ID_LENGTH, "attestation_request_id");
    boundedText(attestation.proposalId, MAX_ID_LENGTH, "attestation_proposal_id");
    boundedText(attestation.engineeringBinding, MAX_BINDING_LENGTH, "attestation_engineering_binding");
    boundedText(attestation.policyVersion, MAX_ID_LENGTH, "attestation_policy_version");
    boundedText(attestation.adapterId, MAX_ID_LENGTH, "adapter_id");
  } catch {
    return { matched: false, reasons: ["invalid_attestation_identity"] };
  }

  if (!Number.isFinite(now.getTime())) {
    return { matched: false, reasons: ["invalid_now"] };
  }

  const observedAt = (() => {
    try {
      return parseIsoInstant(attestation.observedAt, "attestation_observed_at");
    } catch {
      reasons.push("invalid_attestation_observed_at");
      return undefined;
    }
  })();
  const expiresAt = (() => {
    try {
      return parseIsoInstant(attestation.expiresAt, "attestation_expires_at");
    } catch {
      reasons.push("invalid_attestation_expires_at");
      return undefined;
    }
  })();

  if (observedAt && expiresAt && expiresAt.getTime() <= observedAt.getTime()) {
    reasons.push("invalid_attestation_window");
  }
  if (observedAt && now.getTime() < observedAt.getTime()) reasons.push("attestation_not_yet_valid");
  if (expiresAt && now.getTime() >= expiresAt.getTime()) reasons.push("attestation_expired");

  if (attestation.version !== TRUST_SPINE_VERSION) reasons.push("attestation_version_mismatch");
  if (attestation.requestId !== expectation.engineeringPacketId) reasons.push("attestation_request_mismatch");
  if (attestation.proposalId !== expectation.proposal.id) reasons.push("attestation_proposal_mismatch");
  if (attestation.engineeringBinding !== expectation.engineeringBinding) {
    reasons.push("attestation_engineering_binding_mismatch");
  }
  if (attestation.policyVersion !== SAB_POLICY_VERSION) reasons.push("attestation_policy_version_mismatch");

  const proposal = expectation.proposal;
  const operation = attestation.operation;

  if (operation.type !== proposal.type) reasons.push("operation_type_mismatch");
  if (operation.scope !== proposal.scope) reasons.push("operation_scope_mismatch");
  if (operation.target !== proposal.target) reasons.push("operation_target_mismatch");
  if (operation.reversible !== proposal.reversible) reasons.push("operation_reversibility_mismatch");
  if (operation.dataSensitivity !== proposal.dataSensitivity) reasons.push("operation_sensitivity_mismatch");
  compareOptional("operation_affected_records", proposal.affectedRecords, operation.affectedRecords, reasons);
  compareOptional("operation_contains_secrets", proposal.containsSecrets, operation.containsSecrets, reasons);

  if (proposal.estimatedCost === undefined && operation.estimatedCost !== undefined) {
    reasons.push("operation_estimated_cost_presence_mismatch");
  } else if (proposal.estimatedCost !== undefined && operation.estimatedCost === undefined) {
    reasons.push("operation_estimated_cost_presence_mismatch");
  } else if (proposal.estimatedCost !== undefined && operation.estimatedCost !== undefined) {
    if (!Number.isFinite(operation.estimatedCost.amount) || operation.estimatedCost.amount < 0) {
      reasons.push("invalid_attested_cost");
    } else if (operation.estimatedCost.amount !== proposal.estimatedCost) {
      reasons.push("operation_estimated_cost_mismatch");
    }

    if (operation.estimatedCost.unit !== "PROTOTYPE_SCALAR") {
      reasons.push("cost_unit_not_sab_compatible");
    }
  }

  if (reasons.length > 0) return { matched: false, reasons };

  return {
    matched: true,
    reasons: ["adapter_operation_matches_unattested_proposal"],
    candidate: {
      trust: "ADAPTER_MATCHED_UNAUTHENTICATED",
      attestationId: attestation.attestationId,
      adapterId: attestation.adapterId,
      proposal: { ...proposal },
    },
  };
}
