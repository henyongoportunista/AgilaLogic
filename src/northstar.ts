import {
  assertVerifiedOperatorSessionFresh,
  verifyVerifiedOperatorSession,
  type VerifiedOperatorSession,
} from "./auth.js";
import {
  ARCHITECT_ENGINEER_PAIRS,
  ARCHITECT_ENGINEER_STRAND_VERSION,
  type AgilaEngineerId,
  type GagambaArchitectId,
} from "./strand.js";

export const NORTHSTAR_VERSION = "2026-10-25.2" as const;

export type NorthstarPrincipal = "UNVERIFIED_PUBLIC" | "VERIFIED_SAL" | "VERIFIED_BJORN";
export type PrincipalVerification = "PUBLIC_SESSION" | "EXTERNAL_AUTH";
export type NorthstarKnowledgeClass = "PUBLIC" | "INTERNAL" | "PRIVATE_OPERATOR" | "SECRET";
export type NorthstarRoleId = GagambaArchitectId | AgilaEngineerId;
export type NorthstarLane = "ARCHITECT" | "ENGINEER";
export type NorthstarAuthorityCeiling = "ARCHITECTURE_ONLY" | "PROPOSAL_ONLY";

export const NORTHSTAR_IMMUTABLE_PRINCIPLES = [
  "capability_does_not_create_authority",
  "identity_claim_does_not_create_identity",
  "unclear_intent_is_unresolved_state",
  "unknown_is_not_safe",
  "model_output_is_untrusted_until_validated",
  "cross_role_output_is_untrusted_input_until_validated",
  "secret_material_never_enters_model_context",
  "verified_identity_does_not_override_hard_policy_deny",
  "minimum_sufficient_coordination",
] as const;

export type PrincipalContext =
  | {
      principal: "UNVERIFIED_PUBLIC";
      verification: "PUBLIC_SESSION";
      sessionId: string;
      issuedAt: string;
      expiresAt: string;
    }
  | {
      principal: "VERIFIED_SAL" | "VERIFIED_BJORN";
      verification: "EXTERNAL_AUTH";
      operatorSession: VerifiedOperatorSession;
    };

interface ResolvedPrincipalContext {
  principal: NorthstarPrincipal;
  verification: PrincipalVerification;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  operatorAuthBinding: string | null;
  operatorAuthTrust: VerifiedOperatorSession["trust"] | null;
}

export interface NorthstarRoleContract {
  roleId: NorthstarRoleId;
  lane: NorthstarLane;
  pairedRoleId: NorthstarRoleId;
  responsibility: string;
  authorityCeiling: NorthstarAuthorityCeiling;
  allowedKnowledgeClasses: readonly NorthstarKnowledgeClass[];
}

export interface CompileNorthstarContextInput {
  roleId: NorthstarRoleId;
  principalContext: PrincipalContext;
  architectureVersion: string;
  requestedKnowledgeClasses: NorthstarKnowledgeClass[];
  now?: Date;
}

export interface NorthstarContextPack {
  version: typeof NORTHSTAR_VERSION;
  architectureVersion: typeof ARCHITECT_ENGINEER_STRAND_VERSION;
  roleId: NorthstarRoleId;
  lane: NorthstarLane;
  pairedRoleId: NorthstarRoleId;
  responsibility: string;
  authorityCeiling: NorthstarAuthorityCeiling;
  principal: NorthstarPrincipal;
  principalVerification: PrincipalVerification;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  operatorAuthBinding: string | null;
  operatorAuthTrust: VerifiedOperatorSession["trust"] | null;
  allowedKnowledgeClasses: NorthstarKnowledgeClass[];
  deniedKnowledgeClasses: NorthstarKnowledgeClass[];
  immutablePrinciples: string[];
  contextBinding: string;
}

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;

const PRINCIPALS = new Set<NorthstarPrincipal>([
  "UNVERIFIED_PUBLIC",
  "VERIFIED_SAL",
  "VERIFIED_BJORN",
]);
const VERIFICATION_MODES = new Set<PrincipalVerification>(["PUBLIC_SESSION", "EXTERNAL_AUTH"]);
const KNOWLEDGE_CLASSES = new Set<NorthstarKnowledgeClass>([
  "PUBLIC",
  "INTERNAL",
  "PRIVATE_OPERATOR",
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

function parseIsoInstant(value: string, label: string): Date {
  if (typeof value !== "string") throw new TypeError(`${label}_not_string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label}_invalid_iso_instant`);
  }
  return parsed;
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

function normalizePrincipalContext(context: PrincipalContext, now: Date): ResolvedPrincipalContext {
  if (typeof context !== "object" || context === null) throw new TypeError("principal_context_required");
  if (!PRINCIPALS.has(context.principal)) throw new TypeError("invalid_principal");
  if (!VERIFICATION_MODES.has(context.verification)) throw new TypeError("invalid_principal_verification");

  if (context.principal === "UNVERIFIED_PUBLIC") {
    if (context.verification !== "PUBLIC_SESSION") throw new Error("public_principal_verification_mismatch");

    const sessionId = boundedText(context.sessionId, MAX_ID_LENGTH, "principal_session_id");
    const issuedAt = parseIsoInstant(context.issuedAt, "principal_issued_at");
    const expiresAt = parseIsoInstant(context.expiresAt, "principal_expires_at");
    const nowMs = now.getTime();

    if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
    if (expiresAt.getTime() <= issuedAt.getTime()) throw new TypeError("principal_nonpositive_window");
    if (nowMs < issuedAt.getTime()) throw new Error("principal_session_not_yet_valid");
    if (nowMs >= expiresAt.getTime()) throw new Error("principal_session_expired");

    return {
      principal: context.principal,
      verification: context.verification,
      sessionId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      operatorAuthBinding: null,
      operatorAuthTrust: null,
    };
  }

  if (context.verification !== "EXTERNAL_AUTH") throw new Error("verified_principal_requires_external_auth");
  if (!("operatorSession" in context)) throw new Error("verified_principal_requires_operator_session");
  if (!verifyVerifiedOperatorSession(context.operatorSession)) {
    throw new Error("verified_principal_operator_session_invalid");
  }
  assertVerifiedOperatorSessionFresh(context.operatorSession, now);

  const expectedPrincipal = context.operatorSession.principal === "SAL" ? "VERIFIED_SAL" : "VERIFIED_BJORN";
  if (context.principal !== expectedPrincipal) throw new Error("verified_principal_operator_session_mismatch");

  return {
    principal: expectedPrincipal,
    verification: "EXTERNAL_AUTH",
    sessionId: context.operatorSession.sessionId,
    issuedAt: context.operatorSession.issuedAt,
    expiresAt: context.operatorSession.expiresAt,
    operatorAuthBinding: context.operatorSession.sessionBinding,
    operatorAuthTrust: context.operatorSession.trust,
  };
}

function roleContracts(): NorthstarRoleContract[] {
  return ARCHITECT_ENGINEER_PAIRS.flatMap((pair) => [
    {
      roleId: pair.architect,
      lane: "ARCHITECT" as const,
      pairedRoleId: pair.engineer,
      responsibility: pair.responsibility,
      authorityCeiling: "ARCHITECTURE_ONLY" as const,
      allowedKnowledgeClasses: ["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR"] as const,
    },
    {
      roleId: pair.engineer,
      lane: "ENGINEER" as const,
      pairedRoleId: pair.architect,
      responsibility: pair.responsibility,
      authorityCeiling: "PROPOSAL_ONLY" as const,
      allowedKnowledgeClasses: ["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR"] as const,
    },
  ]);
}

export const NORTHSTAR_ROLE_CONTRACTS: readonly NorthstarRoleContract[] = roleContracts();

function findRoleContract(roleId: NorthstarRoleId): NorthstarRoleContract {
  const role = NORTHSTAR_ROLE_CONTRACTS.find((entry) => entry.roleId === roleId);
  if (!role) throw new TypeError("unknown_northstar_role");
  return role;
}

function normalizeRequestedKnowledgeClasses(values: NorthstarKnowledgeClass[]): NorthstarKnowledgeClass[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("requested_knowledge_classes_required");
  }
  if (values.some((value) => !KNOWLEDGE_CLASSES.has(value))) {
    throw new TypeError("invalid_knowledge_class");
  }
  return [...new Set(values)].sort();
}

function principalKnowledgeClasses(principal: NorthstarPrincipal): ReadonlySet<NorthstarKnowledgeClass> {
  if (principal === "UNVERIFIED_PUBLIC") return new Set<NorthstarKnowledgeClass>(["PUBLIC"]);
  return new Set<NorthstarKnowledgeClass>(["PUBLIC", "INTERNAL", "PRIVATE_OPERATOR"]);
}

function contextBinding(pack: Omit<NorthstarContextPack, "contextBinding">): string {
  return canonicalString(pack);
}

/**
 * Compiles a role-scoped Northstar context pack.
 * Verified operator principals must be backed by a fresh structurally verified operator session.
 * Northstar itself still does not authenticate the external issuer or receive raw credentials.
 */
export function compileNorthstarContext(input: CompileNorthstarContextInput): NorthstarContextPack {
  const now = input.now ?? new Date();
  if (input.architectureVersion !== ARCHITECT_ENGINEER_STRAND_VERSION) {
    throw new Error("northstar_architecture_version_mismatch");
  }

  const principalContext = normalizePrincipalContext(input.principalContext, now);
  const role = findRoleContract(input.roleId);
  const requested = normalizeRequestedKnowledgeClasses(input.requestedKnowledgeClasses);
  const principalAllowed = principalKnowledgeClasses(principalContext.principal);
  const roleAllowed = new Set(role.allowedKnowledgeClasses);

  const allowedKnowledgeClasses = requested.filter(
    (knowledgeClass) =>
      knowledgeClass !== "SECRET" && principalAllowed.has(knowledgeClass) && roleAllowed.has(knowledgeClass),
  );
  const deniedKnowledgeClasses = requested.filter(
    (knowledgeClass) => !allowedKnowledgeClasses.includes(knowledgeClass),
  );

  if (allowedKnowledgeClasses.length === 0) throw new Error("northstar_context_empty");

  const payload: Omit<NorthstarContextPack, "contextBinding"> = {
    version: NORTHSTAR_VERSION,
    architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    roleId: role.roleId,
    lane: role.lane,
    pairedRoleId: role.pairedRoleId,
    responsibility: boundedText(role.responsibility, MAX_TEXT_LENGTH, "role_responsibility"),
    authorityCeiling: role.authorityCeiling,
    principal: principalContext.principal,
    principalVerification: principalContext.verification,
    sessionId: principalContext.sessionId,
    issuedAt: principalContext.issuedAt,
    expiresAt: principalContext.expiresAt,
    operatorAuthBinding: principalContext.operatorAuthBinding,
    operatorAuthTrust: principalContext.operatorAuthTrust,
    allowedKnowledgeClasses,
    deniedKnowledgeClasses,
    immutablePrinciples: [...NORTHSTAR_IMMUTABLE_PRINCIPLES],
  };

  return { ...payload, contextBinding: contextBinding(payload) };
}

export function verifyNorthstarContextPack(pack: NorthstarContextPack): boolean {
  if (typeof pack !== "object" || pack === null) return false;
  if (pack.version !== NORTHSTAR_VERSION) return false;
  if (pack.architectureVersion !== ARCHITECT_ENGINEER_STRAND_VERSION) return false;
  if (!PRINCIPALS.has(pack.principal)) return false;
  if (!VERIFICATION_MODES.has(pack.principalVerification)) return false;

  const role = NORTHSTAR_ROLE_CONTRACTS.find((entry) => entry.roleId === pack.roleId);
  if (!role) return false;
  if (pack.lane !== role.lane) return false;
  if (pack.pairedRoleId !== role.pairedRoleId) return false;
  if (pack.authorityCeiling !== role.authorityCeiling) return false;
  if (normalize(pack.responsibility) !== normalize(role.responsibility)) return false;

  if (pack.principal === "UNVERIFIED_PUBLIC") {
    if (pack.principalVerification !== "PUBLIC_SESSION") return false;
    if (pack.operatorAuthBinding !== null || pack.operatorAuthTrust !== null) return false;
  } else {
    if (pack.principalVerification !== "EXTERNAL_AUTH") return false;
    if (typeof pack.operatorAuthBinding !== "string" || normalize(pack.operatorAuthBinding).length === 0) return false;
    if (pack.operatorAuthTrust !== "EXTERNAL_AUTH_CONTRACT_MATCHED_UNAUTHENTICATED_ISSUER") return false;
  }

  if (!Array.isArray(pack.allowedKnowledgeClasses) || pack.allowedKnowledgeClasses.length === 0) return false;
  if (!Array.isArray(pack.deniedKnowledgeClasses)) return false;
  if (pack.allowedKnowledgeClasses.some((value) => !KNOWLEDGE_CLASSES.has(value) || value === "SECRET")) {
    return false;
  }
  if (pack.deniedKnowledgeClasses.some((value) => !KNOWLEDGE_CLASSES.has(value))) return false;
  if (new Set(pack.allowedKnowledgeClasses).size !== pack.allowedKnowledgeClasses.length) return false;
  if (new Set(pack.deniedKnowledgeClasses).size !== pack.deniedKnowledgeClasses.length) return false;
  if (pack.allowedKnowledgeClasses.some((value) => pack.deniedKnowledgeClasses.includes(value))) return false;

  const principalAllowed = principalKnowledgeClasses(pack.principal);
  const roleAllowed = new Set(role.allowedKnowledgeClasses);
  if (pack.allowedKnowledgeClasses.some((value) => !principalAllowed.has(value) || !roleAllowed.has(value))) {
    return false;
  }

  if (canonicalString(pack.immutablePrinciples) !== canonicalString([...NORTHSTAR_IMMUTABLE_PRINCIPLES])) {
    return false;
  }

  try {
    boundedText(pack.sessionId, MAX_ID_LENGTH, "principal_session_id");
    const issuedAt = parseIsoInstant(pack.issuedAt, "principal_issued_at");
    const expiresAt = parseIsoInstant(pack.expiresAt, "principal_expires_at");
    if (expiresAt.getTime() <= issuedAt.getTime()) return false;
  } catch {
    return false;
  }

  const { contextBinding: claimedBinding, ...payload } = pack;
  return claimedBinding === contextBinding(payload);
}

export function assertNorthstarContextFresh(pack: NorthstarContextPack, now = new Date()): void {
  if (!verifyNorthstarContextPack(pack)) throw new Error("northstar_context_binding_mismatch");
  const issuedAt = parseIsoInstant(pack.issuedAt, "northstar_issued_at");
  const expiresAt = parseIsoInstant(pack.expiresAt, "northstar_expires_at");
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) throw new TypeError("invalid_now");
  if (nowMs < issuedAt.getTime()) throw new Error("northstar_context_not_yet_valid");
  if (nowMs >= expiresAt.getTime()) throw new Error("northstar_context_expired");
}
