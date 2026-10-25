import type { CandidateAction, ObservationInput } from "./types.js";

export const GAGAMBA_WEAVE_VERSION = "2026-10-25.3" as const;

export type GagambaSignalKind =
  | "FACT"
  | "INFERENCE"
  | "PREDICTION"
  | "PREFERENCE"
  | "UNKNOWN"
  | "CONSTRAINT"
  | "RESOURCE";

export type ProvenanceSourceClass =
  | "HUMAN_STATED"
  | "TOOL_OBSERVED"
  | "SYSTEM_OBSERVED"
  | "EXTERNAL_DOCUMENT"
  | "MODEL_DERIVED"
  | "UNKNOWN_SOURCE";

export interface ProvenanceEnvelope {
  sourceClass: ProvenanceSourceClass;
  producer: string;
  observedAt: string;
  sourceRef?: string;
  evidenceRef?: string;
}

export interface GagambaSignal {
  id: string;
  kind: GagambaSignalKind;
  text: string;
  confidence?: number;
  /** @deprecated Use provenance.sourceRef for structured provenance. */
  source?: string;
  provenance?: ProvenanceEnvelope;
}

export interface GagambaIntake {
  signals: GagambaSignal[];
  candidates: CandidateAction[];
}

export interface GagambaAcceptedSignal {
  id: string;
  kind: GagambaSignalKind;
  text: string;
  confidence?: number;
  provenance: ProvenanceEnvelope | null;
}

export interface GagambaTrace {
  version: typeof GAGAMBA_WEAVE_VERSION;
  acceptedSignalIds: string[];
  withheldSignalIds: string[];
  reasons: string[];
  acceptedSignals: GagambaAcceptedSignal[];
  provenanceGapSignalIds: string[];
}

export interface GagambaObservation extends ObservationInput {
  inferences: string[];
  predictions: string[];
  preferences: string[];
}

export interface GagambaWeaveResult {
  observation: GagambaObservation;
  trace: GagambaTrace;
}

const MAX_SIGNAL_ID_LENGTH = 160;
const MAX_SIGNAL_TEXT_LENGTH = 1000;
const MAX_SOURCE_LENGTH = 500;
const MAX_PRODUCER_LENGTH = 200;

const SIGNAL_KINDS = new Set<GagambaSignalKind>([
  "FACT",
  "INFERENCE",
  "PREDICTION",
  "PREFERENCE",
  "UNKNOWN",
  "CONSTRAINT",
  "RESOURCE",
]);

const PROVENANCE_SOURCE_CLASSES = new Set<ProvenanceSourceClass>([
  "HUMAN_STATED",
  "TOOL_OBSERVED",
  "SYSTEM_OBSERVED",
  "EXTERNAL_DOCUMENT",
  "MODEL_DERIVED",
  "UNKNOWN_SOURCE",
]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validIsoInstant(value: string): boolean {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function normalizeProvenance(provenance: ProvenanceEnvelope): ProvenanceEnvelope {
  return {
    sourceClass: provenance.sourceClass,
    producer: normalizeText(provenance.producer),
    observedAt: new Date(provenance.observedAt).toISOString(),
    ...(provenance.sourceRef === undefined ? {} : { sourceRef: normalizeText(provenance.sourceRef) }),
    ...(provenance.evidenceRef === undefined ? {} : { evidenceRef: normalizeText(provenance.evidenceRef) }),
  };
}

function validateProvenance(provenance: ProvenanceEnvelope): string | undefined {
  if (typeof provenance !== "object" || provenance === null) return "invalid_signal_provenance";
  if (!PROVENANCE_SOURCE_CLASSES.has(provenance.sourceClass)) return "invalid_provenance_source_class";
  if (typeof provenance.producer !== "string" || normalizeText(provenance.producer).length === 0) {
    return "invalid_provenance_producer";
  }
  if (provenance.producer.length > MAX_PRODUCER_LENGTH) return "provenance_producer_too_long";
  if (!validIsoInstant(provenance.observedAt)) return "invalid_provenance_observed_at";

  if (provenance.sourceRef !== undefined) {
    if (typeof provenance.sourceRef !== "string" || normalizeText(provenance.sourceRef).length === 0) {
      return "invalid_provenance_source_ref";
    }
    if (provenance.sourceRef.length > MAX_SOURCE_LENGTH) return "provenance_source_ref_too_long";
  }

  if (provenance.evidenceRef !== undefined) {
    if (typeof provenance.evidenceRef !== "string" || normalizeText(provenance.evidenceRef).length === 0) {
      return "invalid_provenance_evidence_ref";
    }
    if (provenance.evidenceRef.length > MAX_SOURCE_LENGTH) return "provenance_evidence_ref_too_long";
  }

  return undefined;
}

function validateSignal(signal: GagambaSignal): string | undefined {
  if (typeof signal !== "object" || signal === null) return "invalid_signal";
  if (typeof signal.id !== "string" || signal.id.trim().length === 0) return "invalid_signal_id";
  if (signal.id.length > MAX_SIGNAL_ID_LENGTH) return "signal_id_too_long";
  if (!SIGNAL_KINDS.has(signal.kind)) return "invalid_signal_kind";
  if (typeof signal.text !== "string" || normalizeText(signal.text).length === 0) return "invalid_signal_text";
  if (signal.text.length > MAX_SIGNAL_TEXT_LENGTH) return "signal_text_too_long";

  if (
    signal.confidence !== undefined &&
    (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1)
  ) {
    return "invalid_signal_confidence";
  }

  if (signal.source !== undefined) {
    if (typeof signal.source !== "string" || normalizeText(signal.source).length === 0) {
      return "invalid_signal_source";
    }
    if (signal.source.length > MAX_SOURCE_LENGTH) return "signal_source_too_long";
  }

  if (signal.provenance !== undefined) {
    const provenanceError = validateProvenance(signal.provenance);
    if (provenanceError) return provenanceError;
    if (signal.kind === "FACT" && signal.provenance.sourceClass === "MODEL_DERIVED") {
      return "model_derived_signal_cannot_self_label_fact";
    }
  }

  return undefined;
}

/**
 * Converts heterogeneous observations into the conservative ObservationInput
 * consumed by AgilaLogic.
 *
 * This is an operational translation layer, not a claim that the complete
 * Gagamba cognitive/philosophical architecture has been implemented.
 *
 * Epistemic rule: inference/prediction must not silently become fact.
 * Provenance rule: FACT remains an epistemic label, not guaranteed truth.
 * Missing/unknown provenance is preserved explicitly as a gap rather than
 * fabricated or silently promoted into trusted evidence.
 */
export function weaveSignals(intake: GagambaIntake): GagambaWeaveResult {
  if (typeof intake !== "object" || intake === null) throw new TypeError("invalid_gagamba_intake");
  if (!Array.isArray(intake.signals)) throw new TypeError("signals_not_array");
  if (!Array.isArray(intake.candidates)) throw new TypeError("candidates_not_array");

  const facts: string[] = [];
  const unknowns: string[] = [];
  const constraints: string[] = [];
  const resources: string[] = [];
  const inferences: string[] = [];
  const predictions: string[] = [];
  const preferences: string[] = [];

  const acceptedSignalIds: string[] = [];
  const withheldSignalIds: string[] = [];
  const reasons: string[] = [];
  const acceptedSignals: GagambaAcceptedSignal[] = [];
  const provenanceGapSignalIds: string[] = [];
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();

  for (const signal of intake.signals) {
    const invalidReason = validateSignal(signal);
    if (invalidReason) {
      withheldSignalIds.push(signal?.id || "<missing>");
      reasons.push(invalidReason);
      continue;
    }

    const id = signal.id.trim();
    if (seenIds.has(id)) {
      withheldSignalIds.push(id);
      reasons.push("duplicate_signal_id");
      continue;
    }
    seenIds.add(id);

    const text = normalizeText(signal.text);
    const contentKey = `${signal.kind}:${text.toLocaleLowerCase("en-US")}`;
    if (seenContent.has(contentKey)) {
      withheldSignalIds.push(id);
      reasons.push("duplicate_signal_content");
      continue;
    }
    seenContent.add(contentKey);
    acceptedSignalIds.push(id);

    const provenance = signal.provenance ? normalizeProvenance(signal.provenance) : null;
    if (!provenance || provenance.sourceClass === "UNKNOWN_SOURCE") {
      provenanceGapSignalIds.push(id);
    }
    acceptedSignals.push({
      id,
      kind: signal.kind,
      text,
      ...(signal.confidence === undefined ? {} : { confidence: signal.confidence }),
      provenance,
    });

    switch (signal.kind) {
      case "FACT":
        facts.push(text);
        break;
      case "UNKNOWN":
        unknowns.push(text);
        break;
      case "INFERENCE":
        inferences.push(text);
        unknowns.push(`inference_requires_validation: ${text}`);
        break;
      case "PREDICTION":
        predictions.push(text);
        unknowns.push(`prediction_requires_validation: ${text}`);
        break;
      case "PREFERENCE":
        preferences.push(text);
        constraints.push(`human_preference: ${text}`);
        break;
      case "CONSTRAINT":
        constraints.push(text);
        break;
      case "RESOURCE":
        resources.push(text);
        break;
    }
  }

  return {
    observation: {
      facts,
      unknowns,
      constraints,
      resources,
      candidates: intake.candidates.map((candidate) => ({ ...candidate })),
      inferences,
      predictions,
      preferences,
    },
    trace: {
      version: GAGAMBA_WEAVE_VERSION,
      acceptedSignalIds,
      withheldSignalIds,
      reasons,
      acceptedSignals,
      provenanceGapSignalIds,
    },
  };
}
