import {
  assertSabAdmissibleCandidateFresh,
  verifySabAdmissibleCandidate,
  type SabAdmissibleCandidate,
} from "./admission.js";
import { proposalBinding } from "./sab.js";

export const RESOURCE_PRECONDITION_VERSION = "2026-10-25.1" as const;

export interface ResourcePrecondition {
  version: typeof RESOURCE_PRECONDITION_VERSION;
  trust: "RESOURCE_PRECONDITION_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_ADAPTER";
  preconditionId: string;
  admissionBinding: string;
  proposalBinding: string;
  adapterId: string;
  target: string;
  versionToken: string;
  observedAt: string;
  expiresAt: string;
  binding: string;
}

export interface BindResourcePreconditionInput {
  preconditionId: string;
  adapterId: string;
  versionToken: string;
  observedAt: string;
  expiresAt: string;
}

const MAX_ID_LENGTH = 200;
const MAX_TARGET_LENGTH = 500;
const MAX_TOKEN_LENGTH = 2000;

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

function preconditionBinding(value: Omit<ResourcePrecondition, "binding">): string {
  return canonicalString(value);
}

export function verifyResourcePreconditionArtifact(precondition: ResourcePrecondition): boolean {
  if (typeof precondition !== "object" || precondition === null) return false;
  if (precondition.version !== RESOURCE_PRECONDITION_VERSION) return false;
  if (precondition.trust !== "RESOURCE_PRECONDITION_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_ADAPTER") return false;

  try {
    boundedText(precondition.preconditionId, MAX_ID_LENGTH, "resource_precondition_id");
    boundedText(precondition.admissionBinding, 100_000, "admission_binding");
    boundedText(precondition.proposalBinding, 100_000, "proposal_binding");
    boundedText(precondition.adapterId, MAX_ID_LENGTH, "resource_precondition_adapter_id");
    boundedText(precondition.target, MAX_TARGET_LENGTH, "resource_precondition_target");
    boundedText(precondition.versionToken, MAX_TOKEN_LENGTH, "resource_version_token");
    const observedAt = parseIsoInstant(precondition.observedAt, "resource_precondition_observed_at");
    const expiresAt = parseIsoInstant(precondition.expiresAt, "resource_precondition_expires_at");
    if (expiresAt.getTime() <= observedAt.getTime()) return false;
  } catch {
    return false;
  }

  const { binding, ...payload } = precondition;
  return binding === preconditionBinding(payload);
}

/**
 * Represents an adapter-reported resource version / reservation precondition.
 * It is structurally bound to the exact admitted proposal, but adapter identity
 * and write-time enforcement remain unauthenticated/unimplemented in v0.1.
 */
export function bindResourcePrecondition(
  candidate: SabAdmissibleCandidate,
  input: BindResourcePreconditionInput,
): ResourcePrecondition {
  if (!verifySabAdmissibleCandidate(candidate)) throw new Error("admission_candidate_invalid");

  const observedAt = parseIsoInstant(input.observedAt, "resource_precondition_observed_at");
  const expiresAt = parseIsoInstant(input.expiresAt, "resource_precondition_expires_at");
  const admittedAt = parseIsoInstant(candidate.admittedAt, "admission_admitted_at");
  const candidateExpiry = parseIsoInstant(candidate.validUntil, "admission_valid_until");

  if (observedAt.getTime() < admittedAt.getTime()) {
    throw new Error("resource_precondition_predates_admission");
  }
  if (expiresAt.getTime() <= observedAt.getTime()) {
    throw new Error("resource_precondition_nonpositive_window");
  }
  if (expiresAt.getTime() > candidateExpiry.getTime()) {
    throw new Error("resource_precondition_outlives_admission");
  }

  const adapterId = boundedText(input.adapterId, MAX_ID_LENGTH, "resource_precondition_adapter_id");
  if (adapterId !== candidate.evidence.adapterId) {
    throw new Error("resource_precondition_adapter_mismatch");
  }

  const payload: Omit<ResourcePrecondition, "binding"> = {
    version: RESOURCE_PRECONDITION_VERSION,
    trust: "RESOURCE_PRECONDITION_STRUCTURALLY_ATTESTED_UNAUTHENTICATED_ADAPTER",
    preconditionId: boundedText(input.preconditionId, MAX_ID_LENGTH, "resource_precondition_id"),
    admissionBinding: candidate.admissionBinding,
    proposalBinding: proposalBinding(candidate.proposal),
    adapterId,
    target: boundedText(candidate.proposal.target, MAX_TARGET_LENGTH, "resource_precondition_target"),
    versionToken: boundedText(input.versionToken, MAX_TOKEN_LENGTH, "resource_version_token"),
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  return { ...payload, binding: preconditionBinding(payload) };
}

export function verifyResourcePrecondition(
  precondition: ResourcePrecondition,
  candidate: SabAdmissibleCandidate,
): boolean {
  if (!verifySabAdmissibleCandidate(candidate)) return false;
  if (!verifyResourcePreconditionArtifact(precondition)) return false;
  if (precondition.admissionBinding !== candidate.admissionBinding) return false;
  if (precondition.proposalBinding !== proposalBinding(candidate.proposal)) return false;
  if (precondition.adapterId !== candidate.evidence.adapterId) return false;
  if (precondition.target !== candidate.proposal.target) return false;

  try {
    const observedAt = parseIsoInstant(precondition.observedAt, "resource_precondition_observed_at");
    const expiresAt = parseIsoInstant(precondition.expiresAt, "resource_precondition_expires_at");
    const admittedAt = parseIsoInstant(candidate.admittedAt, "admission_admitted_at");
    const candidateExpiry = parseIsoInstant(candidate.validUntil, "admission_valid_until");
    if (observedAt.getTime() < admittedAt.getTime()) return false;
    if (expiresAt.getTime() > candidateExpiry.getTime()) return false;
  } catch {
    return false;
  }

  return true;
}

export function assertResourcePreconditionFresh(
  precondition: ResourcePrecondition,
  candidate: SabAdmissibleCandidate,
  now = new Date(),
): void {
  if (!verifyResourcePrecondition(precondition, candidate)) {
    throw new Error("resource_precondition_invalid");
  }
  assertSabAdmissibleCandidateFresh(candidate, now);
  if (!Number.isFinite(now.getTime())) throw new TypeError("invalid_now");
  const observedAt = new Date(precondition.observedAt).getTime();
  const expiresAt = new Date(precondition.expiresAt).getTime();
  if (now.getTime() < observedAt) throw new Error("resource_precondition_not_yet_valid");
  if (now.getTime() >= expiresAt) throw new Error("resource_precondition_expired");
}
