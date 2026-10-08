export type DecisionGate =
  | "OBSERVE_ONLY"
  | "RECOMMEND"
  | "DRAFT"
  | "AUTO"
  | "ASK_USER"
  | "REJECT";

export interface CandidateAction {
  id: string;
  value: number;
  timing: number;
  confidence: number;
  cost: number;
  risk: number;
  reversibility: number;
  informationGain?: number;
}

export interface ObservationInput {
  facts: string[];
  unknowns: string[];
  constraints: string[];
  resources: string[];
  candidates: CandidateAction[];
}

export interface RankedCandidate extends CandidateAction {
  score: number;
}

export interface DecisionResult {
  gate: DecisionGate;
  selected?: RankedCandidate;
  reasons: string[];
  gaps: string[];
  resources: string[];
}

export interface AgentPolicy {
  autonomyLevel: number;
  riskTolerance: number;
  confidenceThreshold: number;
}
