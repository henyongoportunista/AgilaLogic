import { decide } from "./orchestrator.js";
import type { GagambaWeaveResult } from "./gagamba.js";
import type { ActionProposal } from "./sab.js";
import type {
  AgentPolicy,
  CandidateAction,
  DecisionGate,
  DecisionResult,
  RankedCandidate,
} from "./types.js";

export const ARCHITECT_ENGINEER_STRAND_VERSION = "2026-10-25.1" as const;

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
  {
    architect: "HT",
    engineer: "MT",
    responsibility: "select what deserves action; implement the smallest useful route",
  },
  {
    architect: "PH",
    engineer: "MB",
    responsibility: "define invariants; challenge what can actually be defended",
  },
  {
    architect: "TM",
    engineer: "KM",
    responsibility: "stress the design; engineer proportional resilience",
  },
  {
    architect: "MG",
    engineer: "HO",
    responsibility: "design resource abundance; convert it into sustainable leverage",
  },
  {
    architect: "KP",
    engineer: "UO",
    responsibility: "calibrate human interaction; preserve focus and boundaries",
  },
  {
    architect: "MM",
    engineer: "UM",
    responsibility: "decide what information is worth consuming; extract useful intelligence",
  },
  {
    architect: "EI",
    engineer: "IW",
    responsibility: "study external blueprints; adapt transferable mechanisms",
  },
] as const;

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
  sourceWeaveVersion: string;
  architectureBinding: string;
}

export interface HtArchitectureInput {
  packetId: string;
  objective: string;
  weave: GagambaWeaveResult;
  successCriteria: string[];
  nonGoals?: string[];
}

export type EngineeringIntent = "NO_ACTION" | "PROPOSAL_ONLY";

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
  unresolvedUnknowns: string[];
  intent: EngineeringIntent;
  requiresArchitectReview: boolean;
}

export interface HtMtStrandResult {
  architecture: ArchitecturePacket;
  decision: DecisionResult;
  engineering: EngineeringPacket;
}

export interface UntrustedSabProposalCandidate {
  trust: "UNATTESTED";
  architectureBinding: string;
  engineeringPacketId: string;
  proposal: ActionProposal;
}

export type ActionProposalMetadata = Omit<ActionProposal, "id">;

const MAX_PACKET_ID_LENGTH = 160;
const MAX_OBJECTIVE_LENGTH = 2000;
const MAX_LIST_ITEM_LENGTH = 2000;
const MAX_LIST_ITEMS = 100;

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

function packetPayload(packet: Omit<ArchitecturePacket, "architectureBinding">): string {
  return JSON.stringify(canonicalize(packet));
}

/**
 * Deterministic, non-cryptographic binding used to detect accidental or
 * silent packet drift inside this prototype. It is not identity, signing,
 * authentication, or tamper-evident storage.
 */
export function architectureBinding(packet: Omit<ArchitecturePacket, "architectureBinding">): string {
  return packetPayload(packet);
}

export function verifyArchitecturePacket(packet: ArchitecturePacket): boolean {
  const { architectureBinding: claimedBinding, ...payload } = packet;
  return claimedBinding === architectureBinding(payload);
}

function copyCandidate(candidate: CandidateAction): CandidateAction {
  return { ...candidate };
}

function sameCandidate(left: CandidateAction, right: CandidateAction): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
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
    candidates: observation.candidates.map(copyCandidate),
    sourceWeaveVersion: input.weave.trace.version,
  };

  return {
    ...payload,
    architectureBinding: architectureBinding(payload),
  };
}

/**
 * MT Engineer: consumes a bound HT packet plus the existing Agila decision.
 * It cannot silently rewrite architect constraints and never returns execution
 * authority. A selected candidate must be present in the bound architecture.
 */
export function mtEngineer(
  architecture: ArchitecturePacket,
  decision: DecisionResult,
  engineeringPacketId: string,
): EngineeringPacket {
  if (!verifyArchitecturePacket(architecture)) {
    throw new Error("architecture_binding_mismatch");
  }

  const packetId = boundedText(engineeringPacketId, MAX_PACKET_ID_LENGTH, "engineering_packet_id");
  const selected = decision.selected ? { ...decision.selected } : undefined;

  if (selected) {
    const architectCandidate = architecture.candidates.find((candidate) => candidate.id === selected.id);
    if (!architectCandidate || !sameCandidate(architectCandidate, selected)) {
      throw new Error("selected_candidate_not_bound_to_architecture");
    }
  }

  const noAction = decision.gate === "OBSERVE_ONLY" || decision.gate === "REJECT" || !selected;
  const requiresArchitectReview =
    noAction || decision.gate === "ASK_USER" || architecture.unknowns.length > 0;

  return {
    version: ARCHITECT_ENGINEER_STRAND_VERSION,
    packetId,
    engineer: "MT",
    architecturePacketId: architecture.packetId,
    architectureBinding: architecture.architectureBinding,
    decisionGate: decision.gate,
    decisionReasons: [...decision.reasons],
    selectedCandidate: selected,
    preservedConstraints: [...architecture.constraints],
    unresolvedUnknowns: [...architecture.unknowns],
    intent: noAction ? "NO_ACTION" : "PROPOSAL_ONLY",
    requiresArchitectReview,
  };
}

/**
 * First end-to-end architect→engineer strand. The engineering output remains
 * proposal-only regardless of Agila's internal gate vocabulary.
 */
export function runHtMtStrand(
  input: HtArchitectureInput,
  policy: AgentPolicy,
  engineeringPacketId: string,
): HtMtStrandResult {
  const architecture = htArchitect(input);
  const decision = decide(input.weave.observation, policy);
  const engineering = mtEngineer(architecture, decision, engineeringPacketId);
  return { architecture, decision, engineering };
}

/**
 * Produces an explicitly UNATTESTED ActionProposal candidate for SAB policy
 * preview. The metadata is not trusted merely because an engineer supplied it.
 * A production path must independently derive/attest the concrete operation.
 */
export function draftUntrustedSabProposal(
  engineering: EngineeringPacket,
  proposalId: string,
  metadata: ActionProposalMetadata,
): UntrustedSabProposalCandidate {
  if (engineering.intent !== "PROPOSAL_ONLY" || !engineering.selectedCandidate) {
    throw new Error("engineering_packet_has_no_action_proposal");
  }

  return {
    trust: "UNATTESTED",
    architectureBinding: engineering.architectureBinding,
    engineeringPacketId: engineering.packetId,
    proposal: {
      id: boundedText(proposalId, MAX_PACKET_ID_LENGTH, "proposal_id"),
      ...metadata,
    },
  };
}
