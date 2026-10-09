export type Gate =
  | "OBSERVE_ONLY"
  | "RECOMMEND"
  | "DRAFT"
  | "AUTO"
  | "ASK_USER"
  | "REJECT";

export interface AgentConfig {
  id: string;
  name: string;
  autonomy_level: number;
  risk_tolerance: number;
  confidence_threshold: number;
}

export interface CandidateAction {
  id: string;
  name: string;
  description?: string | null;
  value: number;
  timing: number;
  confidence: number;
  cost: number;
  risk: number;
  reversibility: number;
  informationGain?: number;
  tool?: string | null;
  toolAction?: string | null;
  payload?: Record<string, unknown>;
}

export interface RankedCandidate extends CandidateAction {
  score: number;
}

export interface EventInput {
  source: string;
  event_type?: string | null;
  summary: string;
  facts: string[];
  inferences: string[];
  unknowns: string[];
  constraints: string[];
  resources: string[];
  candidates: CandidateAction[];
  raw_data?: unknown;
}
