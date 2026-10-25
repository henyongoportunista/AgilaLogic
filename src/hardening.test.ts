import { weaveSignals } from "./gagamba.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { htArchitect, mtEngineer } from "./strand.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle, openRfi, resolveRfi } from "./trust.js";
import {
  assertArchitectureStateActive,
  createLifecycleRegistry,
  registerArchitectureState,
  registerEngineeringState,
} from "./replay.js";
import { prepareRfiReinjection } from "./rfi-resolution.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try { fn(); } catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, message);
}

const provenance = {
  sourceClass: "HUMAN_STATED" as const,
  producer: "fixture-human",
  observedAt: "2026-10-25T05:00:00.000Z",
};
const weave = weaveSignals({
  signals: [{ id: "fact-1", kind: "FACT", text: "Sandbox target exists.", provenance }],
  candidates: [{ id: "candidate-1", value: 1, timing: 1, confidence: 1, cost: 0, risk: 0, reversibility: 1 }],
});
const architecture = htArchitect({
  packetId: "arch-1",
  objective: "Exercise replay hardening.",
  weave,
  successCriteria: ["No stale lifecycle becomes active."],
  nonGoals: ["No execution."],
  intentEnvelope: {
    allowedActionTypes: ["WRITE"],
    allowedScopes: ["SANDBOX"],
    allowedDataSensitivities: ["INTERNAL"],
    requireReversible: true,
    allowSecrets: false,
  },
});
const first = bindArchitectureLifecycle(architecture, {
  lifecycleId: "arch-life-1",
  contextId: "ctx-1",
  issuedAt: "2026-10-25T05:00:00.000Z",
  expiresAt: "2026-10-25T06:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
}, new Date("2026-10-25T05:10:00.000Z"));
let registry = registerArchitectureState(createLifecycleRegistry(), first);
assertArchitectureStateActive(registry, first);
throwsWith(() => registerArchitectureState(registry, first), "lifecycle_replay_detected", "duplicate lifecycle must fail");

const second = bindArchitectureLifecycle(architecture, {
  lifecycleId: "arch-life-2",
  contextId: "ctx-1",
  issuedAt: "2026-10-25T05:15:00.000Z",
  expiresAt: "2026-10-25T06:00:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
  supersedesLifecycleId: "arch-life-1",
}, new Date("2026-10-25T05:20:00.000Z"));
registry = registerArchitectureState(registry, second);
throwsWith(() => assertArchitectureStateActive(registry, first), "lifecycle_superseded", "superseded architecture must fail");
assertArchitectureStateActive(registry, second);

const { engineering } = mtEngineer(architecture, { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 }, "eng-1");
const engineeringState = bindEngineeringLifecycle(engineering, {
  lifecycleId: "eng-life-1",
  contextId: "ctx-1",
  issuedAt: "2026-10-25T05:21:00.000Z",
  expiresAt: "2026-10-25T05:50:00.000Z",
  policyVersion: SAB_POLICY_VERSION,
}, second, new Date("2026-10-25T05:22:00.000Z"));
registry = registerEngineeringState(registry, engineeringState);
assert(registry.entries.length === 3, "registry must track both lifecycle kinds");

const rfi = openRfi({
  rfiId: "rfi-hardening",
  architectureBinding: architecture.architectureBinding,
  engineeringBinding: engineering.engineeringBinding,
  contextId: "ctx-1",
  owner: "HUMAN",
  question: "Which target is intended?",
  maxRounds: 2,
  openedAt: "2026-10-25T05:22:00.000Z",
  expiresAt: "2026-10-25T05:40:00.000Z",
});
const resolved = resolveRfi(rfi, "The intended target is sandbox.preview.", new Date("2026-10-25T05:25:00.000Z"));
const reinjection = prepareRfiReinjection(resolved, {
  signalId: "rfi-answer-1",
  kind: "FACT_CLAIM",
  text: "The intended target is sandbox.preview.",
  provenance,
});
assert(reinjection.signal.kind === "INFERENCE", "RFI free text must not self-promote to FACT");
assert(reinjection.requiresReweave, "RFI resolution must return through Gagamba");
assert(reinjection.createsAuthority === false, "RFI resolution must not create authority");

console.log("trust hardening tests passed");
