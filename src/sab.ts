export type ActionType =
  | "READ"
  | "DRAFT"
  | "WRITE"
  | "DELETE"
  | "PAYMENT"
  | "EXTERNAL_MESSAGE"
  | "PRODUCTION_DEPLOY"
  | "PERMISSION_CHANGE";

export type ActionScope = "LOCAL" | "SANDBOX" | "STAGING" | "PRODUCTION" | "EXTERNAL";

export type ConsequenceClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type SabRoute =
  | "ALLOW"
  | "ALLOW_WITH_LOG"
  | "REQUIRE_HUMAN_APPROVAL"
  | "DENY";

export interface ActionProposal {
  id: string;
  type: ActionType;
  scope: ActionScope;
  target: string;
  reversible: boolean;
  affectedRecords?: number;
  estimatedCost?: number;
  containsSecrets?: boolean;
}

export interface SabDecision {
  route: SabRoute;
  consequence: ConsequenceClass;
  reasons: string[];
  requiresApproval: boolean;
}

export interface ApprovalRecord {
  proposalId: string;
  actionType: ActionType;
  target: string;
  approved: boolean;
  approvedBy: string;
  expiresAt?: string;
}

const HIGH_IMPACT_ACTIONS = new Set<ActionType>([
  "DELETE",
  "PAYMENT",
  "EXTERNAL_MESSAGE",
  "PRODUCTION_DEPLOY",
  "PERMISSION_CHANGE",
]);

function consequenceOf(proposal: ActionProposal): ConsequenceClass {
  if (proposal.containsSecrets && proposal.scope === "EXTERNAL") return "CRITICAL";
  if (proposal.type === "PERMISSION_CHANGE") return "CRITICAL";
  if (proposal.type === "PAYMENT" || proposal.type === "DELETE") return "HIGH";
  if (proposal.type === "PRODUCTION_DEPLOY" || proposal.type === "EXTERNAL_MESSAGE") return "HIGH";
  if (proposal.scope === "PRODUCTION") return "HIGH";
  if ((proposal.affectedRecords ?? 0) >= 25) return "HIGH";
  if (proposal.type === "WRITE" || proposal.type === "DRAFT") return "MEDIUM";
  return "LOW";
}

/**
 * Deterministic admission layer between an AI proposal and execution.
 *
 * Important: this module does not claim that an LLM can certify its own safety.
 * It routes by explicit action metadata and consequence rules.
 */
export function evaluateProposal(proposal: ActionProposal): SabDecision {
  const consequence = consequenceOf(proposal);
  const reasons: string[] = [];

  if (proposal.containsSecrets && proposal.scope === "EXTERNAL") {
    return {
      route: "DENY",
      consequence: "CRITICAL",
      reasons: ["secret_exfiltration_blocked"],
      requiresApproval: false,
    };
  }

  if (proposal.type === "READ") {
    return {
      route: "ALLOW",
      consequence,
      reasons: ["read_only"],
      requiresApproval: false,
    };
  }

  if (
    proposal.type === "WRITE" &&
    proposal.scope === "SANDBOX" &&
    proposal.reversible &&
    (proposal.affectedRecords ?? 0) < 25
  ) {
    return {
      route: "ALLOW_WITH_LOG",
      consequence,
      reasons: ["bounded_reversible_sandbox_write"],
      requiresApproval: false,
    };
  }

  if (HIGH_IMPACT_ACTIONS.has(proposal.type)) reasons.push("high_impact_action");
  if (proposal.scope === "PRODUCTION") reasons.push("production_scope");
  if (proposal.scope === "EXTERNAL") reasons.push("external_effect");
  if (!proposal.reversible) reasons.push("irreversible_or_hard_to_reverse");
  if ((proposal.affectedRecords ?? 0) >= 25) reasons.push("large_blast_radius");
  if ((proposal.estimatedCost ?? 0) > 0) reasons.push("financial_consequence");

  return {
    route: "REQUIRE_HUMAN_APPROVAL",
    consequence,
    reasons: reasons.length > 0 ? reasons : ["state_mutation_requires_authority"],
    requiresApproval: true,
  };
}

/**
 * Approval is bound to one concrete proposal identity, action type, and target.
 * A generic approval cannot silently authorize a different mutation.
 */
export function isExecutionAuthorized(
  proposal: ActionProposal,
  decision: SabDecision,
  approval?: ApprovalRecord,
  now = new Date(),
): boolean {
  if (decision.route === "DENY") return false;
  if (decision.route === "ALLOW" || decision.route === "ALLOW_WITH_LOG") return true;
  if (!approval?.approved) return false;
  if (approval.proposalId !== proposal.id) return false;
  if (approval.actionType !== proposal.type) return false;
  if (approval.target !== proposal.target) return false;

  if (approval.expiresAt) {
    const expiresAt = new Date(approval.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return false;
  }

  return true;
}
