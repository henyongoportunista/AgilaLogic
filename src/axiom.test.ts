import { weaveSignals } from "./gagamba.js";
import { runHtMtStrand } from "./strand.js";
import type { ArchitectureIntentEnvelope } from "./strand.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const boundedEnvelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["READ", "DRAFT", "WRITE"],
  allowedScopes: ["LOCAL", "SANDBOX"],
  allowedDataSensitivities: ["PUBLIC", "INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 1,
};

{
  const ambiguousWithoutCandidate = weaveSignals({
    signals: [
      {
        id: "unknown-target",
        kind: "UNKNOWN",
        text: "The exact target resource is not yet known.",
      },
    ],
    candidates: [],
  });

  const result = runHtMtStrand(
    {
      packetId: "golden-axiom-rfi",
      objective: "Decide whether a bounded implementation should proceed.",
      weave: ambiguousWithoutCandidate,
      successCriteria: ["Do not confuse missing understanding with a justified decision to do nothing."],
      intentEnvelope: boundedEnvelope,
    },
    {
      autonomyLevel: 4,
      riskTolerance: 0.5,
      confidenceThreshold: 0.7,
    },
    "golden-axiom-engineering",
  );

  assert(result.engineering.intent === "RFI_REQUIRED", "ambiguity must outrank passive NO_ACTION");
  assert(result.engineering.requiresArchitectReview, "ambiguous packet must return for interpretation");
  assert(result.engineering.unresolvedUnknowns.length === 1, "unknown must remain explicit");
}

{
  const clearWithoutCandidate = weaveSignals({ signals: [], candidates: [] });

  const result = runHtMtStrand(
    {
      packetId: "golden-axiom-no-action",
      objective: "Observe whether any justified implementation exists.",
      weave: clearWithoutCandidate,
      successCriteria: ["Do not fabricate an action when no candidate exists."],
      intentEnvelope: boundedEnvelope,
    },
    {
      autonomyLevel: 4,
      riskTolerance: 0.5,
      confidenceThreshold: 0.7,
    },
    "golden-axiom-no-action-engineering",
  );

  assert(result.engineering.intent === "NO_ACTION", "clear absence of a candidate should remain NO_ACTION");
  assert(!result.engineering.requiresArchitectReview, "clear NO_ACTION should not fabricate an RFI");
}

console.log("golden axiom clarity tests passed");
