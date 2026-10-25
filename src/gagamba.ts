import type { CandidateAction, ObservationInput } from "./types.js";

export const GAGAMBA_WEAVE_VERSION = "2026-10-25.2" as const;

export type GagambaSignalKind =
  | "FACT"
  | "INFERENCE"
  | "PREDICTION"
  | "PREFERENCE"
  | "UNKNOWN"
  | "CONSTRAINT"
  | "RESOURCE";

export interface GagambaSignal {
  id: string;
  kind: GagambaSignalKind;
  text: string;
  confidence?: number;
  source?: string;
}

export interface GagambaIntake {
  signals: GagambaSignal[];
  candidates: CandidateAction[];
}

export interface GagambaTrace {
  version: typeof GAGAMBA_WEAVE_VERSION;
  acceptedSignalIds: string[];
  withheldSignalIds: string[];
  reasons: string[];
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
const MAX_SOURCE_LENGTH = 300;

const SIGNAL_KINDS = new Set<GagambaSignalKind>([
  "FACT",
  "INFERENCE",
  "PREDICTION",
  "PREFERENCE",
  "UNKNOWN",
  "CONSTRAINT",
  "RESOURCE",
]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validateSignal(signal: GagambaSignal): string | undefined {
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
    },
  };
}
