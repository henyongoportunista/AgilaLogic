import { createSupabaseAdapter, toAgentPolicy } from "./supabase.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface CallRecord {
  url: string;
  init?: RequestInit;
}

const calls: CallRecord[] = [];

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, init });

  if (url.includes("/rest/v1/agents?")) {
    return new Response(
      JSON.stringify([
        {
          id: "agent-1",
          name: "Henyong Oportunista",
          mode: "recommend",
          autonomy_level: 2,
          risk_tolerance: 0.25,
          confidence_threshold: 0.65,
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.endsWith("/rest/v1/rpc/henyong_claim_events")) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.endsWith("/rest/v1/decisions")) {
    return new Response(
      JSON.stringify([
        {
          id: "decision-1",
          agent_id: "agent-1",
          selected_action: "review",
          reasoning_summary: "bounded",
          expected_result: "progress",
          gate: "DRAFT",
          approval_required: true,
          prediction: {},
          status: "pending",
        },
      ]),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.endsWith("/rest/v1/rpc/henyong_record_feedback")) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("not found", { status: 404 });
}) as typeof fetch;

const adapter = createSupabaseAdapter({
  url: "https://example.supabase.co/",
  serviceRoleKey: "test-only-key",
  fetchImpl: fakeFetch,
});

const agent = await adapter.loadAgent();
const policy = toAgentPolicy(agent);
assert(policy.autonomyLevel === 2, "agent policy autonomy mismatch");
assert(policy.riskTolerance === 0.25, "agent policy risk tolerance mismatch");

await adapter.claimEvents(agent.id, 3);

await adapter.recordDecision({
  agentId: agent.id,
  reasoningSummary: "bounded",
  expectedResult: "progress",
  result: {
    gate: "DRAFT",
    selected: {
      id: "review",
      value: 0.8,
      timing: 0.9,
      confidence: 0.8,
      cost: 0.1,
      risk: 0.2,
      reversibility: 0.9,
      informationGain: 0.8,
      score: 0.7,
    },
    reasons: [],
    gaps: [],
    resources: [],
  },
});

await adapter.recordFeedback({
  decisionId: "decision-1",
  actualResult: { reviewed: true },
  successScore: 0.8,
  contradictionScore: 0.1,
  notes: "test",
});

assert(calls.length === 4, `expected 4 fetch calls, got ${calls.length}`);
assert(
  calls[0].url.startsWith("https://example.supabase.co/rest/v1/agents?"),
  "loadAgent URL mismatch",
);

const claimBody = JSON.parse(String(calls[1].init?.body));
assert(claimBody.p_agent_id === "agent-1", "claimEvents agent mismatch");
assert(claimBody.p_limit === 3, "claimEvents limit mismatch");

const decisionHeaders = new Headers(calls[2].init?.headers);
assert(decisionHeaders.get("Prefer") === "return=representation", "decision Prefer header missing");
assert(decisionHeaders.get("apikey") === "test-only-key", "apikey header missing");
assert(
  decisionHeaders.get("Authorization") === "Bearer test-only-key",
  "authorization header missing",
);

const feedbackBody = JSON.parse(String(calls[3].init?.body));
assert(feedbackBody.p_decision_id === "decision-1", "feedback decision mismatch");
assert(feedbackBody.p_success_score === 0.8, "feedback success mismatch");
assert(feedbackBody.p_contradiction_score === 0.1, "feedback contradiction mismatch");

console.log("supabase adapter tests passed");
