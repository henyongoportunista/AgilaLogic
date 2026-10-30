import type { GagambaSignal, GagambaSignalKind, ProvenanceEnvelope } from "./gagamba.js";
import { verifyRfiLifecycle, type RfiLifecycle } from "./trust.js";

export const RFI_RESOLUTION_VERSION = "2026-10-25.1" as const;

export type RfiResolutionKind = Exclude<GagambaSignalKind, "FACT"> | "FACT_CLAIM";

export interface RfiResolutionInput {
  signalId: string;
  kind: RfiResolutionKind;
  text: string;
  provenance?: ProvenanceEnvelope;
}

export interface RfiReinjection {
  version: typeof RFI_RESOLUTION_VERSION;
  rfiId: string;
  contextId: string;
  architectureBinding: string;
  engineeringBinding: string;
  signal: GagambaSignal;
  requiresReweave: true;
  createsAuthority: false;
}

/**
 * Converts a resolved RFI into a new epistemically typed signal that MUST be
 * reprocessed through Gagamba. Free-text RFI resolution never mutates an
 * existing ArchitecturePacket and never creates permission by itself.
 *
 * FACT_CLAIM is deliberately downgraded to INFERENCE. A future trusted source
 * adapter may create a fresh FACT signal only through the normal provenance
 * rules; human/model free text does not self-promote to FACT here.
 */
export function prepareRfiReinjection(
  rfi: RfiLifecycle,
  input: RfiResolutionInput,
): RfiReinjection {
  if (!verifyRfiLifecycle(rfi)) throw new Error("rfi_binding_mismatch");
  if (rfi.status !== "RESOLVED") throw new Error("rfi_not_resolved");

  const text = input.text.trim();
  if (text.length === 0) throw new TypeError("rfi_reinjection_text_empty");
  if (text.length > 2000) throw new TypeError("rfi_reinjection_text_too_long");

  const kind: GagambaSignalKind = input.kind === "FACT_CLAIM" ? "INFERENCE" : input.kind;
  const signal: GagambaSignal = {
    id: input.signalId,
    kind,
    text,
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  };

  return {
    version: RFI_RESOLUTION_VERSION,
    rfiId: rfi.rfiId,
    contextId: rfi.contextId,
    architectureBinding: rfi.architectureBinding,
    engineeringBinding: rfi.engineeringBinding,
    signal,
    requiresReweave: true,
    createsAuthority: false,
  };
}
