import { decide } from "./orchestrator.js";
import type { GagambaWeaveResult } from "./gagamba.js";
import type {
  ActionProposal,
  ActionScope,
  ActionType,
  DataSensitivity,
} from "./sab.js";
import type {
  AgentPolicy,
  CandidateAction,
  DecisionGate,
  DecisionResult,
  ObservationInput,
  RankedCandidate,
} from "./types.js";

export const ARCHITECT_ENGINEER_STRAND_VERSION = "2026-10-25.5" as const;

export type GagambaArchitectId = "HT" | "PH" | "TM" | "MG" | "KP" | "MM" | "EI";
export type AgilaEngineerId = "MT" | "MB" | "KM" | "HO" | "UO" | "UM" | "IW";

export interface ArchitectEngineerPair {
  architect: GagambaArchitectId;
  engineer: AgilaEngineerId;
  responsibility: string;
}

/**
 * Routing shorthand, not a permission map and not a requirement that all
 * fourteen roles run for every task.
 */
export const ARCHITECT_ENGINEER_PAIRS: readonly ArchitectEngineerPair[] = [
  { architect: "HT", engineer: "MT", responsibility: "select what deserves action; implement the smallest useful route" },
  { architect: "PH", engineer: "MB", responsibility: "define invariants; challenge what can actually be defended" },
  { architect: "TM", engineer: "KM", responsibility: "stress the design; engineer proportional resilience" },
  { architect: "MG", engineer: "HO", responsibility: "design resource abundance; convert it into sustainable leverage" },
  { architect: "KP", engineer: "UO", responsibility: "calibrate human interaction; preserve focus and boundaries" },
  { architect: "MM", engineer: "UM", responsibility: "decide what information is worth consuming; extract useful intelligence" },
  { architect: "EI", engineer: "IW", responsibility: "study external blueprints; adapt transferable mechanisms" },
] as const;

/**
 * Machine-checkable strategic intent. This constrains what an engineer may
 * propose; it is not authentication, security attestation, or SAB policy.
 *
 * maxEstimatedCost remains a prototype scalar only. Currency/unit semantics
 * are not established yet, so it must not be presented as a production
 * financial-control guarantee.
 */
export interface ArchitectureIntentEnvelope {
  allowedActionTypes: ActionType[];
  allowedScopes: ActionScope[];
  allowedDataSensitivities: DataSensitivity[];
  requireReversible: boolean;
  allowSecrets: boolean;
  maxAffectedRecords?: number;
  maxEstimatedCost?: number;
}

export interface ArchitecturePacket {
  version: typeof ARCHITECT_ENGINEER_STRAND_VERSION;
  packetId: string;
  architect: "HT";
  objective: string;
  facts: string[];
  assumptions: string[];
  predictions: string[];
  unknowns: string[];
  constraints: string[];
  resources: string[];
  humanPreferences: string[];
  successCriteria: string[];
  nonGoals: string[];
  candidates: CandidateAction[];
  intentEnvelope: ArchitectureIntentEnvelope;
  sourceWeaveVersion: string;
  architectureBinding: string;
}

export interface HtArchitectureInput {
  packetId: string;
  objective: string;
  weave: GagambaWeaveResult;
  successCriteria: string[];
  nonGoals?: string[];
  intentEnvelope: ArchitectureIntentEnvelope;
}

export type EngineeringIntent = "NO_ACTION" | "RFI_REQUIRED" | "PROPOSAL_ONLY";

export interface EngineeringPacket {
  version: typeof ARCHITECT_ENGINEER_STRAND_VERSION;
  packetId: string;
  engineer: "MT";
  architecturePacketId: string;
  architectureBinding: string;
  decisionGate: DecisionGate;
  decisionReasons: string[];
  selectedCandidate?: RankedCandidate;
  preservedConstraints: string[];
  preservedIntentEnvelope: ArchitectureIntentEnvelope;
  unresolvedUnknowns: string[];
  intent: EngineeringIntent;
  requiresArchitectReview: boolean;
  engineeringBinding: string;
}

export interface MtEngineerResult {
  decision: DecisionResult;
  engineering: EngineeringPacket;
}

export interface HtMtStrandResult {
  architecture: ArchitecturePacket;
  decision: DecisionResult;
  engineering: EngineeringPacket;
}

export interface UntrustedSabProposalCandidate {
  trust: "UNATTESTED";
  architectureBinding: string;
  engineeringBinding: string;
  engineeringPacketId: string;
  proposal: ActionProposal;
}

export type ActionProposalMetadata = Omit<ActionProposal, "id">;

const MAX_PACKET_ID_LENGTH = 160;
const MAX_OBJECTIVE_LENGTH = 2000;
const MAX_LIST_ITEM_LENGTH = 2000;
const MAX_LIST_ITEMS = 100;

const ACTION_TYPES = new Set<ActionType>([
  "READ",
  "DRAFT",
  "WRITE",
  "DELETE",
  "PAYMENT",
  "EXTERNAL_MESSAGE",
  "PRODUCTION_DEPLOY",
  "PERMISSION_CHANGE",
]);
const ACTION_SCOPES = new Set<ActionScope>([
  "LOCAL",
  "SANDBOX",
  "STAGING",
  "PRODUCTION",
  "EXTERNAL",
]);
const DATA_SENSITIVITIES = new Set<DataSensitivity>([
  "PUBLIC",
  "INTERNAL",
  "SENSITIVE",
  "SECRET",
]);

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

function boundedList(values: string[], label: string): string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label}_not_array`);
  if (values.length > MAX_LIST_ITEMS) throw new TypeError(`${label}_too_many_items`);
  return values.map((value) => boundedText(value, MAX_LIST_ITEM_LENGTH, `${label}_item`));
}

function validUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateCandidate(candidate: CandidateAction): CandidateAction {
  const id = boundedText(candidate.id, MAX_PACKET_ID_LENGTH, "candidate_id");
  if (!validUnit(candidate.value)) throw new TypeError("invalid_candidate_value");
  if (!validUnit(candidate.timing)) throw new TypeError("invalid_candidate_timing");
  if (!validUnit(candidate.confidence)) throw new TypeError("invalid_candidate_confidence");
  if (!Number.isFinite(candidate.cost) || candidate.cost < 0) throw new TypeError("invalid_candidate_cost");
  if (!validUnit(candidate.risk)) throw new TypeError("invalid_candidate_risk");
  if (!validUnit(candidate.reversibility)) throw new TypeError("invalid_candidate_reversibility");
  if (candidate.informationGain !== undefined && !validUnit(candidate.informationGain)) {
    throw new TypeError("invalid_candidate_information_gain");
  }

  return { ...candidate, id };
}

function validateCandidates(candidates: CandidateAction[]): CandidateAction[] {
  const seenIds = new Set<string>();

  return candidates.map((candidate) => {
    const validated = validateCandidate(candidate);
    if (seenIds.has(validated.id)) throw new TypeError("duplicate_candidate_id");
    seenIds.add(validated.id);
    return validated;
  });
}

function uniqueKnownValues<T extends string>(
  values: T[],
  allowed: ReadonlySet<T>,
  label: string,
): T[] {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${label}_required`);
  const normalized = [...new Set(values)].sort();
  if (normalized.some((value) => !allowed.has(value))) throw new TypeError(`invalid_${label}`);
  return normalized;
}

function validateIntentEnvelope(envelope: ArchitectureIntentEnvelope): ArchitectureIntentEnvelope {
  if (typeof envelope !== "object" || envelope === null) {
    throw new TypeError("intent_envelope_required");
  }
  if (typeof envelope.requireReversible !== "boolean") {
    throw new TypeError("invalid_require_reversible");
  }
  if (typeof envelope.allowSecrets !== "boolean") {
    throw new TypeError("invalid_allow_secrets");
  }
  if (
    envelope.maxAffectedRecords !== undefined &&
    (!Number.isInteger(envelope.maxAffectedRecords) || envelope.maxAffectedRecords < 0)
  ) {
    throw new TypeError("invalid_max_affected_records");
  }
  if (
    envelope.maxEstimatedCost !== undefined &&
    (!Number.isFinite(envelope.maxEstimatedCost) || envelope.maxEstimatedCost < 0)
  ) {
    throw new TypeError("invalid_max_estimated_cost");
  }

  return {
    allowedActionTypes: uniqueKnownValues(envelope.allowedActionTypes, ACTION_TYPES, "allowed_action_types"),
    allowedScopes: uniqueKnownValues(envelope.allowedScopes, ACTION_SCOPES, "allowed_scopes"),
    allowedDataSensitivities: uniqueKnownValues(
      envelope.allowedDataSensitivities,
      DATA_SENSITIVITIES,
      "allowed_data_sensitivities",
    ),
    requireReversible: envelope.requireReversible,
    allowSecrets: envelope.allowSecrets,
    ...(envelope.maxAffectedRecords === undefined
      ? {}
      : { maxAffectedRecords: envelope.maxAffectedRecords }),
    ...(envelope.maxEstimatedCost === undefined
      ? {}
      : { maxEstimatedCost: envelope.maxEstimatedCost }),
  };
}

function copyIntentEnvelope(envelope: ArchitectureIntentEnvelope): ArchitectureIntentEnvelope {
  return {
    ...envelope,
    allowedActionTypes: [...envelope.allowedActionTypes],
    allowedScopes: [...envelope.allowedScopes],
    allowedDataSensitivities: [...envelope.allowedDataSensitivities],
  };
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

/**
 * Deterministic, non-cryptographic binding used to detect accidental or
 * silent packet drift inside this prototype. It is not identity, signing,
 * authentication, or tamper-evident storage.
 */
export function architectureBinding(packet: Omit<ArchitecturePacket, "architectureBinding">): string {
  return canonicalString(packet);
}

export function verifyArchitecturePacket(packet: ArchitecturePacket): boolean {
  const { architectureBinding: claimedBinding, ...payload } = packet;
  return claimedBinding === architectureBinding(payload);
}

function engineeringBinding(packet: Omit<EngineeringPacket, "engineeringBinding">): string {
  return canonicalString(packet);
}

export function verifyEngineeringPacket(packet: EngineeringPacket): boolean {
  const { engineeringBinding: claimedBinding, ...payload } = packet;
  return claimedBinding === engineeringBinding(payload);
}

function copyCandidate(candidate: CandidateAction): CandidateAction {
  return { ...candidate };
}

function candidateCore(candidate: CandidateAction): CandidateAction {
  return {
    id: candidate.id,
    value: candidate.value,
    timing: candidate.timing,
    confidence: candidate.confidence,
    cost: candidate.cost,
    risk: candidate.risk,
    reversibility: candidate.reversibility,
    ...(candidate.informationGain === undefined ? {} : { informationGain: candidate.informationGain }),
  };
}

function sameCandidate(left: CandidateAction, right: CandidateAction): boolean {
  return canonicalString(candidateCore(left)) === canonicalString(candidateCore(right));
}

function observationFromArchitecture(architecture: ArchitecturePacket): ObservationInput {
  return {
    facts: [...architecture.facts],
    unknowns: [...architecture.unknowns],
    constraints: [...architecture.constraints],
    resources: [...architecture.resources],
    candidates: architecture.candidates.map(copyCandidate),
  };
}

function proposalIntentViolations(
  envelope: ArchitectureIntentEnvelope,
  proposal: ActionProposalMetadata,
): string[] {
  const violations: string[] = [];
  if (!envelope.allowedActionTypes.includes(proposal.type)) violations.push("action_type_outside_architecture");
  if (!envelope.allowedScopes.includes(proposal.scope)) violations.push("scope_outside_architecture");
  if (!envelope.allowedDataSensitivities.includes(proposal.dataSensitivity)) {
    violations.push("data_sensitivity_outside_architecture");
  }
  if (envelope.requireReversible && !proposal.reversible) violations.push("irreversible_action_outside_architecture");
  if (!envelope.allowSecrets && (proposal.containsSecrets === true || proposal.dataSensitivity === "SECRET")) {
    violations.push("secret_handling_outside_architecture");
  }
  if (envelope.maxAffectedRecords !== undefined) {
    if (proposal.affectedRecords === undefined) violations.push("unknown_blast_radius_outside_architecture");
    else if (proposal.affectedRecords > envelope.maxAffectedRecords) violations.push("blast_radius_outside_architecture");
  }
  if (envelope.maxEstimatedCost !== undefined) {
    if (proposal.estimatedCost === undefined) violations.push("unknown_cost_outside_architecture");
    else if (proposal.estimatedCost > envelope.maxEstimatedCost) violations.push("cost_outside_architecture");
  }
  return violations;
}

/**
 * HT Architect: turns an already-woven Gagamba observation into a versioned
 * architecture packet. This function does not execute tools or grant authority.
 */
export function htArchitect(input: HtArchitectureInput): ArchitecturePacket {
  const packetId = boundedText(input.packetId, MAX_PACKET_ID_LENGTH, "packet_id");
  const objective = boundedText(input.objective, MAX_OBJECTIVE_LENGTH, "objective");
  const successCriteria = boundedList(input.successCriteria, "success_criteria");
  if (successCriteria.length === 0) throw new TypeError("success_criteria_required");

  const observation = input.weave.observation;
  const candidates = validateCandidates(observation.candidates);
  const intentEnvelope = validateIntentEnvelope(input.intentEnvelope);

  const payload: Omit<ArchitecturePacket, "architectureBinding"> = {
    version: ARCHITECT_ENGINEER_STRAND_VERSION,
    packetId,
    architect: "HT",
    objective,
    facts: [...observation.facts],
    assumptions: [...observation.inferences],
    predictions: [...observation.predictions],
    unknowns: [...observation.unknowns],
    constraints: [...observation.constraints],
    resources: [...observation.resources],
    humanPreferences: [...observation.preferences],
    successCriteria,
    nonGoals: boundedList(input.nonGoals ?? [], "non_goals"),
    candidates,
    intentEnvelope,
    sourceWeaveVersion: input.weave.trace.version,
  };

  return { ...payload, architectureBinding: architectureBinding(payload) };
}

/**
 * MT Engineer: recomputes Agila's decision from the bound HT packet. It does
 * not accept a caller-supplied verdict, cannot silently rewrite architect
 * constraints, and never returns execution authority.
 *
 * Clarity rule: unresolved interpretation outranks passive inactivity. If the
 * packet is ambiguous, return for interpretation instead of pretending that
 * the absence of a selected action means the problem itself is resolved.
 */
export function mtEngineer(
  architecture: ArchitecturePacket,
  policy: AgentPolicy,
  engineeringPacketId: string,
): MtEngineerResult {
  if (!verifyArchitecturePacket(architecture)) throw new Error("architecture_binding_mismatch");

  const packetId = boundedText(engineeringPacketId, MAX_PACKET_ID_LENGTH, "engineering_packet_id");
  const decision = decide(observationFromArchitecture(architecture), policy);
  const selected = decision.selected ? { ...decision.selected } : undefined;

  if (selected) {
    const architectCandidate = architecture.candidates.find((candidate) => candidate.id === selected.id);
    if (!architectCandidate || !sameCandidate(architectCandidate, selected)) {
      throw new Error("selected_candidate_not_bound_to_architecture");
    }
  }

  const hardReject = decision.gate === "REJECT";
  const requiresArchitectReview = !hardReject && (
    decision.gate === "ASK_USER" || architecture.unknowns.length > 0
  );
  const noAction = hardReject || decision.gate === "OBSERVE_ONLY" || !selected;
  const intent: EngineeringIntent = requiresArchitectReview
    ? "RFI_REQUIRED"
    : noAction
      ? "NO_ACTION"
      : "PROPOSAL_ONLY";

  const payload: Omit<EngineeringPacket, "engineeringBinding"> = {
    version: ARCHITECT_ENGINEER_STRAND_VERSION,
    packetId,
    engineer: "MT",
    architecturePacketId: architecture.packetId,
    architectureBinding: architecture.architectureBinding,
    decisionGate: decision.gate,
    decisionReasons: [...decision.reasons],
    selectedCandidate: selected,
    preservedConstraints: [...architecture.constraints],
    preservedIntentEnvelope: copyIntentEnvelope(architecture.intentEnvelope),
    unresolvedUnknowns: [...architecture.unknowns],
    intent,
    requiresArchitectReview,
  };

  return {
    decision,
    engineering: { ...payload, engineeringBinding: engineeringBinding(payload) },
  };
}

/**
 * First end-to-end architect→engineer strand. The engineering output remains
 * proposal-only or explicitly returns for interpretation; neither grants authority.
 */
export function runHtMtStrand(
  input: HtArchitectureInput,
  policy: AgentPolicy,
  engineeringPacketId: string,
): HtMtStrandResult {
  const architecture = htArchitect(input);
  const { decision, engineering } = mtEngineer(architecture, policy, engineeringPacketId);
  return { architecture, decision, engineering };
}

/**
 * Produces an explicitly UNATTESTED ActionProposal candidate for SAB policy
 * preview. The metadata is not trusted merely because an engineer supplied it.
 * It must first remain inside the architect's machine-checkable intent envelope.
 * A production path must still independently derive/attest the concrete operation.
 */
export function draftUntrustedSabProposal(
  engineering: EngineeringPacket,
  proposalId: string,
  metadata: ActionProposalMetadata,
): UntrustedSabProposalCandidate {
  if (!verifyEngineeringPacket(engineering)) throw new Error("engineering_binding_mismatch");
  if (engineering.intent !== "PROPOSAL_ONLY" || !engineering.selectedCandidate) {
    throw new Error("engineering_packet_has_no_action_proposal");
  }

  const violations = proposalIntentViolations(engineering.preservedIntentEnvelope, metadata);
  if (violations.length > 0) {
    throw new Error(`proposal_outside_architecture:${violations.join(",")}`);
  }

  return {
    trust: "UNATTESTED",
    architectureBinding: engineering.architectureBinding,
    engineeringBinding: engineering.engineeringBinding,
    engineeringPacketId: engineering.packetId,
    proposal: { id: boundedText(proposalId, MAX_PACKET_ID_LENGTH, "proposal_id"), ...metadata },
  };
}
