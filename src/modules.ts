import type {
  AgentPolicy,
  CandidateAction,
  DecisionGate,
  ObservationInput,
  RankedCandidate,
} from "./types.js";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function mtFilter(candidates: CandidateAction[]): CandidateAction[] {
  return candidates.filter(
    (candidate) => candidate.value > 0.15 || (candidate.informationGain ?? 0.5) > 0.5,
  );
}

export function umFindGaps(input: ObservationInput): string[] {
  const explicit = input.unknowns.filter(Boolean);
  const constraintUnknowns = input.constraints.filter((constraint) =>
    constraint.toLowerCase().includes("unknown"),
  );
  return [...new Set([...explicit, ...constraintUnknowns])];
}

export function uoInventory(input: ObservationInput): string[] {
  return [...new Set(input.resources.filter(Boolean))];
}

export function iwAdapt(candidate: CandidateAction): CandidateAction {
  if (candidate.risk > 0.6 && candidate.reversibility < 0.5) {
    return { ...candidate, confidence: clamp01(candidate.confidence - 0.2) };
  }
  return candidate;
}

export function hoRank(candidates: CandidateAction[]): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const informationGain = candidate.informationGain ?? 0.5;
      const numerator =
        candidate.value *
        candidate.timing *
        candidate.confidence *
        (0.5 + 0.5 * candidate.reversibility) *
        (0.75 + 0.25 * informationGain);
      const denominator = 0.35 + candidate.cost + candidate.risk;
      return { ...candidate, score: clamp01(numerator / denominator) };
    })
    .sort((a, b) => b.score - a.score);
}

export function kmSelect(ranked: RankedCandidate[]): RankedCandidate | undefined {
  const viable = ranked.filter((candidate) => candidate.score >= 0.2);
  if (viable.length === 0) return undefined;

  const topScore = viable[0].score;
  const nearTop = viable.filter((candidate) => candidate.score >= topScore * 0.9);

  return nearTop.sort(
    (a, b) => a.cost + a.risk - (b.cost + b.risk),
  )[0];
}

export function mbGate(
  selected: RankedCandidate | undefined,
  gaps: string[],
  policy: AgentPolicy,
): { gate: DecisionGate; reasons: string[] } {
  if (!selected) return { gate: "OBSERVE_ONLY", reasons: ["no_viable_candidate"] };
  if (selected.risk > 0.85) return { gate: "REJECT", reasons: ["risk_too_high"] };

  const reasons: string[] = [];
  if (selected.confidence < policy.confidenceThreshold) reasons.push("low_confidence");
  if (selected.risk > policy.riskTolerance) reasons.push("risk_above_tolerance");
  if (gaps.length > 0) reasons.push("important_unknowns_present");
  if (selected.reversibility < 0.5) reasons.push("low_reversibility");

  if (policy.autonomyLevel <= 0) return { gate: "OBSERVE_ONLY", reasons };
  if (policy.autonomyLevel === 1) return { gate: "RECOMMEND", reasons };
  if (policy.autonomyLevel === 2) return { gate: "DRAFT", reasons };
  if (reasons.length > 0) return { gate: "ASK_USER", reasons };
  if (selected.reversibility >= 0.6) return { gate: "AUTO", reasons };
  return { gate: "ASK_USER", reasons: ["insufficient_reversibility"] };
}
