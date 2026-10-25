import { weaveSignals } from "./gagamba.js";
import { evaluateProposal } from "./sab.js";
import {
  ARCHITECT_ENGINEER_PAIRS,
  draftUntrustedSabProposal,
  htArchitect,
  mtEngineer,
  runHtMtStrand,
  verifyArchitecturePacket,
  verifyEngineeringPacket,
} from "./strand.js";
import type { ArchitectureIntentEnvelope } from "./strand.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const candidate = {
  id: "bounded-preview",
  value: 0.9,
  timing: 0.8,
  confidence: 0.9,
  cost: 0.1,
  risk: 0.1,
  reversibility: 0.9,
  informationGain: 0.8,
};

const policy = {
  autonomyLevel: 2,
  riskTolerance: 0.3,
  confidenceThreshold: 0.7,
};

const sandboxEnvelope: ArchitectureIntentEnvelope = {
  allowedActionTypes: ["READ", "DRAFT", "WRITE"],
  allowedScopes: ["LOCAL", "SANDBOX"],
  allowedDataSensitivities: ["PUBLIC", "INTERNAL"],
  requireReversible: true,
  allowSecrets: false,
  maxAffectedRecords: 10,
  maxEstimatedCost: 1,
};

const woven = weaveSignals({
  signals: [
    { id: "fact-1", kind: "FACT", text: "A local sandbox preview is available." },
    { id: "pref-1", kind: "PREFERENCE", text: "Prefer the smallest reversible change." },
    { id: "constraint-1", kind: "CONSTRAINT", text: "No production mutation." },
    { id: "resource-1", kind: "RESOURCE", text: "Local policy lab" },
  ],
  candidates: [candidate],
});

{
  assert(ARCHITECT_ENGINEER_PAIRS.length === 7, "expected seven architect-engineer pairs");
  assert(new Set(ARCHITECT_ENGINEER_PAIRS.map((pair) => pair.architect)).size === 7, "architects must be unique");
  assert(new Set(ARCHITECT_ENGINEER_PAIRS.map((pair) => pair.engineer)).size === 7, "engineers must be unique");
  assert(
    ARCHITECT_ENGINEER_PAIRS.some((pair) => pair.architect === "HT" && pair.engineer === "MT"),
    "expected HT→MT pair",
  );
}

{
  const architecture = htArchitect({
    packetId: "arch-1",
    objective: "Produce a bounded local preview without production mutation.",
    weave: woven,
    successCriteria: ["A proposal can be reviewed without external execution."],
    nonGoals: ["Do not deploy."],
    intentEnvelope: sandboxEnvelope,
  });

  assert(verifyArchitecturePacket(architecture), "architecture binding should verify");
  assert(architecture.architect === "HT", "expected HT architect");
  assert(architecture.constraints.includes("No production mutation."), "must preserve architect constraint");
  assert(
    architecture.constraints.includes("human_preference: Prefer the smallest reversible change."),
    "must preserve human preference as explicit constraint",
  );
  assert(
    architecture.intentEnvelope.allowedScopes.join(",") === "LOCAL,SANDBOX",
    "must preserve machine-checkable scope intent",
  );
}

{
  const architecture = htArchitect({
    packetId: "arch-tamper",
    objective: "Keep the current architecture bounded.",
    weave: woven,
    successCriteria: ["No silent constraint changes."],
    intentEnvelope: sandboxEnvelope,
  });

  architecture.constraints.push("Allow production mutation.");
  assert(!verifyArchitecturePacket(architecture), "mutated packet must fail binding verification");

  let failedClosed = false;
  try {
    mtEngineer(architecture, policy, "eng-tamper");
  } catch (error) {
    failedClosed = error instanceof Error && error.message === "architecture_binding_mismatch";
  }
  assert(failedClosed, "engineer must reject architecture packet drift");
}

{
  const result = runHtMtStrand(
    {
      packetId: "arch-run",
      objective: "Prepare the smallest reversible local implementation proposal.",
      weave: woven,
      successCriteria: ["Proposal is reviewable and remains non-executing."],
      nonGoals: ["No live deployment."],
      intentEnvelope: sandboxEnvelope,
    },
    policy,
    "eng-run",
  );

  assert(result.decision.gate === "DRAFT", `expected DRAFT, got ${result.decision.gate}`);
  assert(result.engineering.engineer === "MT", "expected MT engineer");
  assert(result.engineering.intent === "PROPOSAL_ONLY", "engineering must remain proposal-only");
  assert(verifyEngineeringPacket(result.engineering), "engineering binding should verify");
  assert(
    result.engineering.architectureBinding === result.architecture.architectureBinding,
    "engineering packet must bind back to architecture",
  );

  const candidateProposal = draftUntrustedSabProposal(result.engineering, "proposal-preview-1", {
    type: "WRITE",
    scope: "SANDBOX",
    target: "sandbox.preview",
    reversible: true,
    dataSensitivity: "INTERNAL",
    affectedRecords: 1,
    estimatedCost: 0,
    containsSecrets: false,
  });

  assert(candidateProposal.trust === "UNATTESTED", "engineer metadata must remain untrusted");
  const sabDecision = evaluateProposal(candidateProposal.proposal);
  assert(sabDecision.route === "ALLOW_WITH_LOG", `expected policy preview ALLOW_WITH_LOG, got ${sabDecision.route}`);

  let productionBlocked = false;
  try {
    draftUntrustedSabProposal(result.engineering, "proposal-production", {
      type: "WRITE",
      scope: "PRODUCTION",
      target: "production.customer_status",
      reversible: true,
      dataSensitivity: "INTERNAL",
      affectedRecords: 1,
      estimatedCost: 0,
      containsSecrets: false,
    });
  } catch (error) {
    productionBlocked =
      error instanceof Error && error.message.includes("scope_outside_architecture");
  }
  assert(productionBlocked, "engineer must not draft outside the architect's scope envelope");

  let unknownBlastRadiusBlocked = false;
  try {
    draftUntrustedSabProposal(result.engineering, "proposal-unknown-blast-radius", {
      type: "WRITE",
      scope: "SANDBOX",
      target: "sandbox.preview",
      reversible: true,
      dataSensitivity: "INTERNAL",
      estimatedCost: 0,
      containsSecrets: false,
    });
  } catch (error) {
    unknownBlastRadiusBlocked =
      error instanceof Error && error.message.includes("unknown_blast_radius_outside_architecture");
  }
  assert(unknownBlastRadiusBlocked, "bounded architecture must not treat unknown blast radius as safe");

  result.engineering.preservedIntentEnvelope.allowedScopes.push("PRODUCTION");
  assert(!verifyEngineeringPacket(result.engineering), "mutated engineering packet must fail verification");

  let proposalBlocked = false;
  try {
    draftUntrustedSabProposal(result.engineering, "proposal-after-tamper", {
      type: "WRITE",
      scope: "SANDBOX",
      target: "sandbox.preview",
      reversible: true,
      dataSensitivity: "INTERNAL",
      affectedRecords: 1,
      estimatedCost: 0,
      containsSecrets: false,
    });
  } catch (error) {
    proposalBlocked = error instanceof Error && error.message === "engineering_binding_mismatch";
  }
  assert(proposalBlocked, "tampered engineering packet must not emit a SAB proposal");
}

{
  const uncertainWeave = weaveSignals({
    signals: [
      { id: "inference-1", kind: "INFERENCE", text: "The target probably has no hidden dependency." },
    ],
    candidates: [candidate],
  });

  const result = runHtMtStrand(
    {
      packetId: "arch-uncertain",
      objective: "Evaluate a candidate while preserving uncertainty.",
      weave: uncertainWeave,
      successCriteria: ["Unknowns remain visible."],
      intentEnvelope: sandboxEnvelope,
    },
    {
      autonomyLevel: 4,
      riskTolerance: 0.5,
      confidenceThreshold: 0.7,
    },
    "eng-uncertain",
  );

  assert(result.decision.gate === "ASK_USER", `expected ASK_USER, got ${result.decision.gate}`);
  assert(result.engineering.intent === "RFI_REQUIRED", "uncertainty must return for interpretation");
  assert(result.engineering.requiresArchitectReview, "unknowns should force architect review");
  assert(result.engineering.unresolvedUnknowns.length > 0, "unknowns must remain in engineering packet");

  let rfiBlocked = false;
  try {
    draftUntrustedSabProposal(result.engineering, "should-wait-for-rfi", {
      type: "WRITE",
      scope: "SANDBOX",
      target: "sandbox.uncertain",
      reversible: true,
      dataSensitivity: "INTERNAL",
      affectedRecords: 1,
      estimatedCost: 0,
      containsSecrets: false,
    });
  } catch (error) {
    rfiBlocked = error instanceof Error && error.message === "engineering_packet_has_no_action_proposal";
  }
  assert(rfiBlocked, "RFI_REQUIRED packet must not emit a SAB proposal");
}

{
  const noCandidateWeave = weaveSignals({ signals: [], candidates: [] });
  const result = runHtMtStrand(
    {
      packetId: "arch-observe",
      objective: "Observe when no viable implementation exists.",
      weave: noCandidateWeave,
      successCriteria: ["Do not fabricate an action."],
      intentEnvelope: sandboxEnvelope,
    },
    {
      autonomyLevel: 4,
      riskTolerance: 0.5,
      confidenceThreshold: 0.7,
    },
    "eng-observe",
  );

  assert(result.engineering.intent === "NO_ACTION", "no candidate must produce NO_ACTION");

  let blocked = false;
  try {
    draftUntrustedSabProposal(result.engineering, "should-not-exist", {
      type: "WRITE",
      scope: "SANDBOX",
      target: "sandbox.fake",
      reversible: true,
      dataSensitivity: "INTERNAL",
      affectedRecords: 1,
      estimatedCost: 0,
      containsSecrets: false,
    });
  } catch (error) {
    blocked = error instanceof Error && error.message === "engineering_packet_has_no_action_proposal";
  }
  assert(blocked, "NO_ACTION engineering packet must not produce a SAB proposal");
}

{
  const invalidCandidateWeave = weaveSignals({
    signals: [{ id: "fact-invalid", kind: "FACT", text: "A malformed candidate arrived." }],
    candidates: [{ ...candidate, risk: Number.NaN }],
  });

  let rejected = false;
  try {
    htArchitect({
      packetId: "arch-invalid-candidate",
      objective: "Reject invalid candidate metrics.",
      weave: invalidCandidateWeave,
      successCriteria: ["Non-finite risk cannot enter the architecture packet."],
      intentEnvelope: sandboxEnvelope,
    });
  } catch (error) {
    rejected = error instanceof TypeError && error.message === "invalid_candidate_risk";
  }
  assert(rejected, "architect must fail closed on invalid candidate metrics");
}

{
  let rejectedEnvelope = false;
  try {
    htArchitect({
      packetId: "arch-invalid-envelope",
      objective: "Reject an empty intent envelope.",
      weave: woven,
      successCriteria: ["At least one scope must be explicit."],
      intentEnvelope: { ...sandboxEnvelope, allowedScopes: [] },
    });
  } catch (error) {
    rejectedEnvelope = error instanceof TypeError && error.message === "allowed_scopes_required";
  }
  assert(rejectedEnvelope, "architect must reject an empty scope envelope");
}

console.log("architect-engineer strand tests passed");
