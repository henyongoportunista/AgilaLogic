import type { AuthenticationAssurance } from "./external-auth.js";
import { evaluateProposal, type ActionProposal, type ActionType } from "./sab.js";

export const ASSURANCE_POLICY_VERSION = "2026-10-25.1" as const;

const PHISHING_RESISTANT_ACTIONS: ReadonlySet<ActionType> = new Set([
  "DELETE",
  "PAYMENT",
  "EXTERNAL_MESSAGE",
  "PRODUCTION_DEPLOY",
  "PERMISSION_CHANGE",
]);

const ASSURANCE_RANK: ReadonlyMap<AuthenticationAssurance, number> = new Map([
  ["SINGLE_FACTOR", 0],
  ["MFA", 1],
  ["PHISHING_RESISTANT_MFA", 2],
]);

/**
 * Policy over declared operation metadata, not proof of an operation's truth.
 * A sufficient assurance level only permits continuing to the consent boundary.
 * It never creates consent, authorization, or an override for SAB DENY.
 */
export function requiredAuthenticationAssurance(
  proposal: ActionProposal,
): AuthenticationAssurance | null {
  const decision = evaluateProposal(proposal);
  if (decision.route === "DENY") throw new Error("sab_denied");
  if (PHISHING_RESISTANT_ACTIONS.has(proposal.type) || proposal.dataSensitivity === "SECRET") {
    return "PHISHING_RESISTANT_MFA";
  }
  return decision.route === "REQUIRE_HUMAN_APPROVAL" ? "MFA" : null;
}

export function assertAuthenticationAssurance(
  proposal: ActionProposal,
  actual: AuthenticationAssurance | undefined,
): void {
  const required = requiredAuthenticationAssurance(proposal);
  if (required === null) return;
  if (actual === undefined) throw new Error("authentication_assurance_required");
  const actualRank = ASSURANCE_RANK.get(actual);
  if (actualRank === undefined) throw new Error("authentication_assurance_invalid");
  if (actualRank < ASSURANCE_RANK.get(required)!) {
    throw new Error("authentication_assurance_insufficient");
  }
}
