import type { AgentPolicy, DecisionResult } from "./types.js";

export interface SupabaseRuntimeConfig {
  url: string;
  serviceRoleKey: string;
  agentName?: string;
  fetchImpl?: typeof fetch;
}

export interface AgentRow {
  id: string;
  name: string;
  mode: string;
  autonomy_level: number;
  risk_tolerance: number;
  confidence_threshold: number;
}

export interface EventInboxRow {
  id: string;
  agent_id: string;
  source: string;
  event_type: string;
  payload: unknown;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
}

export interface RecordedDecisionRow {
  id: string;
  agent_id: string;
  selected_action: string | null;
  reasoning_summary: string | null;
  expected_result: string | null;
  gate: string;
  approval_required: boolean;
  prediction: unknown;
  status: string;
}

export function toAgentPolicy(agent: AgentRow): AgentPolicy {
  return {
    autonomyLevel: agent.autonomy_level,
    riskTolerance: Number(agent.risk_tolerance),
    confidenceThreshold: Number(agent.confidence_threshold),
  };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function createSupabaseAdapter(config: SupabaseRuntimeConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(config.url);
  const agentName = config.agentName ?? "Henyong Oportunista";

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${text}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async loadAgent(): Promise<AgentRow> {
      const encodedName = encodeURIComponent(agentName);
      const rows = await request<AgentRow[]>(
        `/rest/v1/agents?name=eq.${encodedName}&select=id,name,mode,autonomy_level,risk_tolerance,confidence_threshold&limit=1`,
      );
      const agent = rows[0];
      if (!agent) throw new Error(`Agent not found: ${agentName}`);
      return agent;
    },

    async claimEvents(agentId: string, limit = 10): Promise<EventInboxRow[]> {
      return request<EventInboxRow[]>("/rest/v1/rpc/henyong_claim_events", {
        method: "POST",
        body: JSON.stringify({ p_agent_id: agentId, p_limit: limit }),
      });
    },

    async recordDecision(args: {
      agentId: string;
      result: DecisionResult;
      reasoningSummary: string;
      expectedResult: string;
    }): Promise<RecordedDecisionRow> {
      const selected = args.result.selected;
      const approvalRequired =
        args.result.gate === "DRAFT" || args.result.gate === "ASK_USER";

      const rows = await request<RecordedDecisionRow[]>("/rest/v1/decisions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          agent_id: args.agentId,
          selected_action: selected?.id ?? null,
          reasoning_summary: args.reasoningSummary,
          expected_result: args.expectedResult,
          gate: args.result.gate,
          approval_required: approvalRequired,
          prediction: selected
            ? {
                action: selected.id,
                confidence: selected.confidence,
                expected_score: selected.score,
              }
            : {},
          status: "pending",
        }),
      });

      const decision = rows[0];
      if (!decision) throw new Error("Supabase did not return the inserted decision");
      return decision;
    },

    async recordFeedback(args: {
      decisionId: string;
      actualResult: unknown;
      successScore: number;
      contradictionScore: number;
      notes?: string;
    }): Promise<unknown> {
      return request<unknown>("/rest/v1/rpc/henyong_record_feedback", {
        method: "POST",
        body: JSON.stringify({
          p_decision_id: args.decisionId,
          p_actual_result: args.actualResult,
          p_success_score: args.successScore,
          p_contradiction_score: args.contradictionScore,
          p_notes: args.notes ?? "",
        }),
      });
    },
  };
}
