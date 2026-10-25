import { weaveSignals } from "./gagamba.js";
import {
  bindRfiResolution,
  rfiResolutionToGagambaSignal,
  verifyRfiResolutionArtifact,
} from "./rfi-resolution.js";
import { openRfi, resolveRfi } from "./trust.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try {
    fn();
  } catch (error) {
    matched = error instanceof Error && error.message === expected;
  }
  assert(matched, message);
}

const open = openRfi({
  rfiId: "rfi-resolution-fixture",
  architectureBinding: "architecture-binding-fixture",
  engineeringBinding: "engineering-binding-fixture",
  contextId: "rfi-resolution-context",
  owner: "HUMAN",
  question: "Is the sandbox resource approved for this bounded test?",
  maxRounds: 3,
  openedAt: "2026-10-25T06:00:00.000Z",
  expiresAt: "2026-10-25T07:00:00.000Z",
});

const resolved = resolveRfi(
  open,
  "The sandbox resource is approved for this bounded test.",
  new Date("2026-10-25T06:20:00.000Z"),
);

{
  const artifact = bindRfiResolution(resolved, {
    resolutionId: "rfi-resolution-signal-1",
    kind: "FACT",
    provenance: {
      sourceClass: "HUMAN_STATED",
      producer: "authenticated-human-input",
      observedAt: "2026-10-25T06:20:00.000Z",
      sourceRef: "rfi://rfi-resolution-fixture",
    },
    resolvedAt: "2026-10-25T06:20:00.000Z",
  });

  assert(verifyRfiResolutionArtifact(artifact), "human-stated FACT resolution artifact must verify");
  assert(artifact.text === resolved.resolution, "artifact text must come exactly from the resolved RFI");
  assert(artifact.rfiBinding === resolved.binding, "artifact must remain bound to the exact RFI lifecycle");

  const signal = rfiResolutionToGagambaSignal(artifact);
  const weave = weaveSignals({ signals: [signal], candidates: [] });
  assert(weave.trace.acceptedSignalIds.includes(signal.id), "resolution signal must re-enter through Gagamba weave");
  assert(weave.observation.facts.includes(signal.text), "human-stated FACT may become a fact only after re-weave");
}

{
  throwsWith(
    () => bindRfiResolution(resolved, {
      resolutionId: "model-fact-resolution",
      kind: "FACT",
      provenance: {
        sourceClass: "MODEL_DERIVED",
        producer: "model",
        observedAt: "2026-10-25T06:20:00.000Z",
      },
      resolvedAt: "2026-10-25T06:20:00.000Z",
    }),
    "rfi_resolution_signal_rejected:model_derived_signal_cannot_self_label_fact",
    "model-derived RFI resolution must not self-promote into FACT",
  );
}

{
  const artifact = bindRfiResolution(resolved, {
    resolutionId: "model-inference-resolution",
    kind: "INFERENCE",
    provenance: {
      sourceClass: "MODEL_DERIVED",
      producer: "model",
      observedAt: "2026-10-25T06:20:00.000Z",
    },
    resolvedAt: "2026-10-25T06:20:00.000Z",
  });
  assert(verifyRfiResolutionArtifact(artifact), "model-derived inference may remain typed as inference");
  const weave = weaveSignals({ signals: [rfiResolutionToGagambaSignal(artifact)], candidates: [] });
  assert(weave.observation.inferences.includes(resolved.resolution ?? ""), "inference must remain an inference after re-weave");
}

{
  throwsWith(
    () => bindRfiResolution(open, {
      resolutionId: "unresolved-rfi-resolution",
      kind: "FACT",
      provenance: {
        sourceClass: "HUMAN_STATED",
        producer: "human",
        observedAt: "2026-10-25T06:10:00.000Z",
      },
      resolvedAt: "2026-10-25T06:10:00.000Z",
    }),
    "rfi_not_resolved",
    "OPEN RFI must not produce a resolution artifact",
  );
}

{
  const artifact = bindRfiResolution(resolved, {
    resolutionId: "tamper-resolution",
    kind: "FACT",
    provenance: {
      sourceClass: "HUMAN_STATED",
      producer: "human",
      observedAt: "2026-10-25T06:20:00.000Z",
    },
    resolvedAt: "2026-10-25T06:20:00.000Z",
  });
  const tampered = { ...artifact, text: "A different answer was injected after resolution." };
  assert(!verifyRfiResolutionArtifact(tampered), "resolution text mutation must invalidate artifact binding");
}

{
  throwsWith(
    () => bindRfiResolution(resolved, {
      resolutionId: "late-resolution",
      kind: "FACT",
      provenance: {
        sourceClass: "HUMAN_STATED",
        producer: "human",
        observedAt: "2026-10-25T07:00:00.000Z",
      },
      resolvedAt: "2026-10-25T07:00:00.000Z",
    }),
    "rfi_resolution_at_or_after_expiry",
    "resolution artifact must not claim a resolution at or after RFI expiry",
  );
}

console.log("RFI resolution reinjection tests passed");
