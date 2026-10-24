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
export type DataSensitivity = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "SECRET";

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
  dataSensitivity: DataSensitivity;
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
  proposalBinding: string;
  approved: boolean;
  approvedBy: string;
  issuedAt: string;
  expiresAt: string;
}

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

const PROPOSAL_FIELDS = new Set([
  "id",
  "type",
  "scope",
  "target",
  "reversible",
  "dataSensitivity",
  "affectedRecords",
  "estimatedCost",
  "containsSecrets",
]);

const HIGH_IMPACT_ACTIONS = new Set<ActionType>([
  "DELETE",
  "PAYMENT",
  "EXTERNAL_MESSAGE",
  "PRODUCTION_DEPLOY",
  "PERMISSION_CHANGE",
]);

const MAX_APPROVAL_TTL_MS = 15 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validString(value: unknown, maxLength: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validOptionalNonNegativeNumber(value: unknown, max: number): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max)
  );
}

/**
 * Runtime validation is mandatory because TypeScript types disappear at the HTTP boundary.
 * Unknown fields are rejected so policy decisions cannot depend on ambiguous metadata.
 */
export function validateProposal(input: unknown): string[] {
  if (!isRecord(input)) return ["proposal_not_object"];

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!PROPOSAL_FIELDS.has(key)) errors.push(`unexpected_field:${key}`);
  }

  if (!validString(input.id, 160)) errors.push("invalid_id");
  if (!ACTION_TYPES.has(input.type as ActionType)) errors.push("invalid_action_type");
  if (!ACTION_SCOPES.has(input.scope as ActionScope)) errors.push("invalid_action_scope");
  if (!validString(input.target, 500)) errors.push("invalid_target");
  if (typeof input.reversible !== "boolean") errors.push("invalid_reversible");
  if (!DATA_SENSITIVITIES.has(input.dataSensitivity as DataSensitivity)) {
    errors.push("invalid_data_sensitivity");
  }

  if (!validOptionalNonNegativeNumber(input.affectedRecords, 1_000_000_000)) {
    errors.push("invalid_affected_records");
  } else if (
    typeof input.affectedRecords === "number" &&
    !Number.isInteger(input.affectedRecords)
  ) {
    errors.push("affected_records_must_be_integer");
  }

  if (!validOptionalNonNegativeNumber(input.estimatedCost, 1_000_000_000_000)) {
    errors.push("invalid_estimated_cost");
  }

  if (input.containsSecrets !== undefined && typeof input.containsSecrets !== "boolean") {
    errors.push("invalid_contains_secrets");
  }

  return errors;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

/**
 * Deterministic, non-cryptographic binding of the complete proposal payload.
 * A later production phase may hash/sign this canonical representation.
 */
export function proposalBinding(proposal: ActionProposal): string {
  return JSON.stringify(canonicalize(proposal)) as string;
}

function consequenceOf(proposal: ActionProposal): ConsequenceClass {
  if (proposal.type === "READ") {
    if (proposal.dataSensitivity === "PUBLIC") return "LOW";
    if (proposal.dataSensitivity === "INTERNAL") return "MEDIUM";
    if (proposal.dataSensitivity === "SENSITIVE") return "HIGH";
    return "CRITICAL";
  }

  if (
    proposal.scope === "EXTERNAL" &&
    (proposal.containsSecrets || proposal.dataSensitivity === "SECRET")
  ) {
    return "CRITICAL";
  }
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
 * Invalid or ambiguous metadata fails closed.
 */
export function evaluateProposal(input: unknown): SabDecision {
  const validationErrors = validateProposal(input);
  if (validationErrors.length > 0) {
    return {
      route: "DENY",
      consequence: "CRITICAL",
      reasons: ["invalid_proposal_metadata", ...validationErrors.slice(0, 4)],
      requiresApproval: false,
    };
  }

  const proposal = input as ActionProposal;
  const consequence = consequenceOf(proposal);
  const reasons: string[] = [];

  if (
    proposal.scope === "EXTERNAL" &&
    (proposal.containsSecrets || proposal.dataSensitivity === "SECRET")
  ) {
    return {
      route: "DENY",
      consequence: "CRITICAL",
      reasons: ["secret_exfiltration_blocked"],
      requiresApproval: false,
    };
  }

  if (proposal.type === "READ") {
    if (proposal.dataSensitivity === "PUBLIC") {
      return {
        route: "ALLOW",
        consequence,
        reasons: ["public_read_only"],
        requiresApproval: false,
      };
    }

    if (proposal.dataSensitivity === "INTERNAL") {
      return {
        route: "ALLOW_WITH_LOG",
        consequence,
        reasons: ["internal_read_logged"],
        requiresApproval: false,
      };
    }

    return {
      route: "REQUIRE_HUMAN_APPROVAL",
      consequence,
      reasons: ["sensitive_read_requires_authority"],
      requiresApproval: true,
    };
  }

  if (
    proposal.type === "WRITE" &&
    proposal.scope === "SANDBOX" &&
    proposal.reversible &&
    (proposal.affectedRecords ?? 0) < 25 &&
    (proposal.dataSensitivity === "PUBLIC" || proposal.dataSensitivity === "INTERNAL")
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
  if (proposal.dataSensitivity === "SENSITIVE" || proposal.dataSensitivity === "SECRET") {
    reasons.push("sensitive_data");
  }

  return {
    route: "REQUIRE_HUMAN_APPROVAL",
    consequence,
    reasons: reasons.length > 0 ? reasons : ["state_mutation_requires_authority"],
    requiresApproval: true,
  };
}

/**
 * Authorization always recomputes policy from the proposal. A caller cannot supply
 * a pre-forged SAB decision. Approval is bound to every proposal field through
 * proposalBinding(), not merely an ID/type/target tuple.
 */
export function isExecutionAuthorized(
  input: unknown,
  approval?: ApprovalRecord,
  now = new Date(),
): boolean {
  const validationErrors = validateProposal(input);
  if (validationErrors.length > 0) return false;

  const proposal = input as ActionProposal;
  const decision = evaluateProposal(proposal);

  if (decision.route === "DENY") return false;
  if (decision.route === "ALLOW" || decision.route === "ALLOW_WITH_LOG") return true;
  if (!approval?.approved) return false;
  if (approval.proposalId !== proposal.id) return false;
  if (approval.proposalBinding !== proposalBinding(proposal)) return false;
  if (!validString(approval.approvedBy, 200)) return false;

  const issuedAt = new Date(approval.issuedAt);
  const expiresAt = new Date(approval.expiresAt);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) return false;
  if (issuedAt > now || expiresAt <= now) return false;
  if (expiresAt <= issuedAt) return false;
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_APPROVAL_TTL_MS) return false;

  return true;
}
