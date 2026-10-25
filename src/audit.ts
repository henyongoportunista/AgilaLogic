export const AUDIT_LEDGER_VERSION = "2026-10-25.1" as const;

export type AuditEventType =
  | "SOURCE_ATTESTATION_RECORDED"
  | "AUTH_ASSERTION_CONSUMED"
  | "NORTHSTAR_CONTEXT_COMPILED"
  | "LIFECYCLE_REGISTERED"
  | "LIFECYCLE_SUPERSEDED"
  | "RFI_RESOLUTION_REINJECTED"
  | "TRUST_ADMITTED"
  | "SAB_DECISION_RECORDED"
  | "EXECUTION_PERMIT_ISSUED"
  | "EXECUTION_RECEIPT_RECORDED"
  | "EXECUTION_VERIFICATION_RECORDED";

export type AuditArtifactKind =
  | "PROVENANCE_ATTESTATION"
  | "OPERATOR_AUTH_ASSERTION"
  | "NORTHSTAR_CONTEXT"
  | "LIFECYCLE_REGISTRY"
  | "RFI_RESOLUTION"
  | "TRUST_ADMISSION"
  | "SAB_DECISION"
  | "EXECUTION_PERMIT"
  | "EXECUTION_RECEIPT"
  | "EXECUTION_VERIFICATION";

export type AuditActorKind = "HUMAN" | "AGENT" | "ADAPTER" | "SYSTEM" | "UNKNOWN";

export type AuditOutcome =
  | "NONE"
  | "ALLOW"
  | "ALLOW_WITH_LOG"
  | "REQUIRE_HUMAN_APPROVAL"
  | "DENY"
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL"
  | "UNKNOWN"
  | "CONFIRMED"
  | "CONTRADICTED"
  | "INCONCLUSIVE";

export interface AuditEvent {
  eventId: string;
  eventType: AuditEventType;
  occurredAt: string;
  actorKind: AuditActorKind;
  actorId: string;
  artifactKind: AuditArtifactKind;
  artifactId: string;
  artifactBinding: string;
  outcome: AuditOutcome;
  contextId?: string;
  requestId?: string;
  executionId?: string;
}

export interface AuditLedgerEntry {
  sequence: number;
  event: AuditEvent;
  previousEntryBinding: string | null;
  entryBinding: string;
}

export interface AuditLedgerSnapshot {
  version: typeof AUDIT_LEDGER_VERSION;
  entries: AuditLedgerEntry[];
  headBinding: string | null;
  binding: string;
}

export interface AppendAuditEventInput {
  event: AuditEvent;
  expectedHeadBinding: string | null;
}

/**
 * Persistence ports may implement this interface with Supabase/Postgres or another
 * durable store later. The contract deliberately exposes optimistic head matching
 * so adapters cannot silently overwrite a concurrently advanced audit chain.
 */
export interface AuditStorePort {
  load(): Promise<AuditLedgerSnapshot>;
  append(input: AppendAuditEventInput): Promise<AuditLedgerSnapshot>;
}

const MAX_ID_LENGTH = 200;
const MAX_BINDING_LENGTH = 100_000;

const EVENT_TYPES = new Set<AuditEventType>([
  "SOURCE_ATTESTATION_RECORDED",
  "AUTH_ASSERTION_CONSUMED",
  "NORTHSTAR_CONTEXT_COMPILED",
  "LIFECYCLE_REGISTERED",
  "LIFECYCLE_SUPERSEDED",
  "RFI_RESOLUTION_REINJECTED",
  "TRUST_ADMITTED",
  "SAB_DECISION_RECORDED",
  "EXECUTION_PERMIT_ISSUED",
  "EXECUTION_RECEIPT_RECORDED",
  "EXECUTION_VERIFICATION_RECORDED",
]);

const ARTIFACT_KINDS = new Set<AuditArtifactKind>([
  "PROVENANCE_ATTESTATION",
  "OPERATOR_AUTH_ASSERTION",
  "NORTHSTAR_CONTEXT",
  "LIFECYCLE_REGISTRY",
  "RFI_RESOLUTION",
  "TRUST_ADMISSION",
  "SAB_DECISION",
  "EXECUTION_PERMIT",
  "EXECUTION_RECEIPT",
  "EXECUTION_VERIFICATION",
]);

const ACTOR_KINDS = new Set<AuditActorKind>(["HUMAN", "AGENT", "ADAPTER", "SYSTEM", "UNKNOWN"]);
const OUTCOMES = new Set<AuditOutcome>([
  "NONE",
  "ALLOW",
  "ALLOW_WITH_LOG",
  "REQUIRE_HUMAN_APPROVAL",
  "DENY",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "UNKNOWN",
  "CONFIRMED",
  "CONTRADICTED",
  "INCONCLUSIVE",
]);

const EXPECTED_ARTIFACT_KIND: Readonly<Record<AuditEventType, AuditArtifactKind>> = {
  SOURCE_ATTESTATION_RECORDED: "PROVENANCE_ATTESTATION",
  AUTH_ASSERTION_CONSUMED: "OPERATOR_AUTH_ASSERTION",
  NORTHSTAR_CONTEXT_COMPILED: "NORTHSTAR_CONTEXT",
  LIFECYCLE_REGISTERED: "LIFECYCLE_REGISTRY",
  LIFECYCLE_SUPERSEDED: "LIFECYCLE_REGISTRY",
  RFI_RESOLUTION_REINJECTED: "RFI_RESOLUTION",
  TRUST_ADMITTED: "TRUST_ADMISSION",
  SAB_DECISION_RECORDED: "SAB_DECISION",
  EXECUTION_PERMIT_ISSUED: "EXECUTION_PERMIT",
  EXECUTION_RECEIPT_RECORDED: "EXECUTION_RECEIPT",
  EXECUTION_VERIFICATION_RECORDED: "EXECUTION_VERIFICATION",
};

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

function entryBinding(entry: Omit<AuditLedgerEntry, "entryBinding">): string {
  return canonicalString(entry);
}

function snapshotBinding(snapshot: Omit<AuditLedgerSnapshot, "binding">): string {
  return canonicalString(snapshot);
}

function normalizeEvent(event: AuditEvent): AuditEvent {
  if (typeof event !== "object" || event === null) throw new Error("audit_event_required");
  if (!EVENT_TYPES.has(event.eventType)) throw new TypeError("invalid_audit_event_type");
  if (!ARTIFACT_KINDS.has(event.artifactKind)) throw new TypeError("invalid_audit_artifact_kind");
  if (!ACTOR_KINDS.has(event.actorKind)) throw new TypeError("invalid_audit_actor_kind");
  if (!OUTCOMES.has(event.outcome)) throw new TypeError("invalid_audit_outcome");
  if (EXPECTED_ARTIFACT_KIND[event.eventType] !== event.artifactKind) {
    throw new Error("audit_event_artifact_kind_mismatch");
  }

  return {
    eventId: boundedText(event.eventId, MAX_ID_LENGTH, "audit_event_id"),
    eventType: event.eventType,
    occurredAt: parseIsoInstant(event.occurredAt, "audit_occurred_at").toISOString(),
    actorKind: event.actorKind,
    actorId: boundedText(event.actorId, MAX_ID_LENGTH, "audit_actor_id"),
    artifactKind: event.artifactKind,
    artifactId: boundedText(event.artifactId, MAX_ID_LENGTH, "audit_artifact_id"),
    artifactBinding: boundedText(event.artifactBinding, MAX_BINDING_LENGTH, "audit_artifact_binding"),
    outcome: event.outcome,
    ...(event.contextId === undefined ? {} : { contextId: boundedText(event.contextId, MAX_ID_LENGTH, "audit_context_id") }),
    ...(event.requestId === undefined ? {} : { requestId: boundedText(event.requestId, MAX_ID_LENGTH, "audit_request_id") }),
    ...(event.executionId === undefined ? {} : { executionId: boundedText(event.executionId, MAX_ID_LENGTH, "audit_execution_id") }),
  };
}

export function emptyAuditLedger(): AuditLedgerSnapshot {
  const payload: Omit<AuditLedgerSnapshot, "binding"> = {
    version: AUDIT_LEDGER_VERSION,
    entries: [],
    headBinding: null,
  };
  return { ...payload, binding: snapshotBinding(payload) };
}

export function verifyAuditLedgerSnapshot(snapshot: AuditLedgerSnapshot): boolean {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  if (snapshot.version !== AUDIT_LEDGER_VERSION) return false;
  if (!Array.isArray(snapshot.entries)) return false;

  const eventIds = new Set<string>();
  let previousBinding: string | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const entry = snapshot.entries[index];
    if (typeof entry !== "object" || entry === null) return false;
    if (entry.sequence !== index + 1) return false;
    if (entry.previousEntryBinding !== previousBinding) return false;

    let normalizedEvent: AuditEvent;
    try {
      normalizedEvent = normalizeEvent(entry.event);
    } catch {
      return false;
    }
    if (canonicalString(normalizedEvent) !== canonicalString(entry.event)) return false;
    if (eventIds.has(normalizedEvent.eventId)) return false;
    eventIds.add(normalizedEvent.eventId);

    const occurredAt = new Date(normalizedEvent.occurredAt).getTime();
    if (occurredAt < previousTime) return false;
    previousTime = occurredAt;

    const { entryBinding: claimedEntryBinding, ...payload } = entry;
    if (claimedEntryBinding !== entryBinding(payload)) return false;
    previousBinding = claimedEntryBinding;
  }

  if (snapshot.headBinding !== previousBinding) return false;
  const { binding, ...payload } = snapshot;
  return binding === snapshotBinding(payload);
}

export function appendAuditEvent(
  snapshot: AuditLedgerSnapshot,
  input: AppendAuditEventInput,
): AuditLedgerSnapshot {
  if (!verifyAuditLedgerSnapshot(snapshot)) throw new Error("audit_ledger_invalid");
  if (input.expectedHeadBinding !== snapshot.headBinding) throw new Error("audit_head_conflict");

  const event = normalizeEvent(input.event);
  if (snapshot.entries.some((entry) => entry.event.eventId === event.eventId)) {
    throw new Error("audit_event_id_already_recorded");
  }

  const previous = snapshot.entries.at(-1);
  if (previous !== undefined) {
    const previousTime = new Date(previous.event.occurredAt).getTime();
    const nextTime = new Date(event.occurredAt).getTime();
    if (nextTime < previousTime) throw new Error("audit_event_backdated");
  }

  const entryPayload: Omit<AuditLedgerEntry, "entryBinding"> = {
    sequence: snapshot.entries.length + 1,
    event,
    previousEntryBinding: snapshot.headBinding,
  };
  const nextEntry: AuditLedgerEntry = {
    ...entryPayload,
    entryBinding: entryBinding(entryPayload),
  };

  const snapshotPayload: Omit<AuditLedgerSnapshot, "binding"> = {
    version: AUDIT_LEDGER_VERSION,
    entries: [...snapshot.entries, nextEntry],
    headBinding: nextEntry.entryBinding,
  };
  const next = { ...snapshotPayload, binding: snapshotBinding(snapshotPayload) };
  if (!verifyAuditLedgerSnapshot(next)) throw new Error("audit_ledger_postcondition_failed");
  return next;
}

export function currentAuditHead(snapshot: AuditLedgerSnapshot): string | null {
  if (!verifyAuditLedgerSnapshot(snapshot)) throw new Error("audit_ledger_invalid");
  return snapshot.headBinding;
}
