import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  hoRank,
  integrityKernel,
  iwAdapt,
  kmSelect,
  mbGate,
  mtFilter,
  umFindGaps,
  uoInventory,
} from "./_shared/core.ts";
import type {
  AgentConfig,
  CandidateAction,
  EventInput,
  Gate,
} from "./_shared/types.ts";

const VERSION = "2.0.0";
const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}",
) as Record<string, string>;
const adminKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!adminKey) throw new Error("missing_admin_key");

const db = createClient(url, adminKey, { auth: { persistSession: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function finite01(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeCandidate(
  raw: Record<string, unknown>,
  index: number,
): CandidateAction {
  const name = String(raw.name ?? raw.action_name ?? raw.id ?? `candidate-${index + 1}`);
  return {
    id: String(raw.id ?? name),
    name,
    description: raw.description == null ? null : String(raw.description),
    value: finite01(raw.value ?? raw.expected_value, 0.5),
    timing: finite01(raw.timing ?? raw.timing_score, 0.5),
    confidence: finite01(raw.confidence, 0.5),
    cost: finite01(raw.cost, 0.5),
    risk: finite01(raw.risk, 0.5),
    reversibility: finite01(raw.reversibility, 0.5),
    informationGain: finite01(raw.informationGain ?? raw.information_gain, 0.5),
    tool: raw.tool == null ? null : String(raw.tool),
    toolAction:
      raw.toolAction == null && raw.tool_action == null
        ? null
        : String(raw.toolAction ?? raw.tool_action),
    payload:
      raw.payload && typeof raw.payload === "object"
        ? (raw.payload as Record<string, unknown>)
        : {},
  };
}

function normalizeEvent(row: Record<string, unknown>): EventInput {
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};

  const source = String(row.source ?? payload.source ?? "unknown");
  const eventType =
    row.event_type == null
      ? payload.event_type == null
        ? null
        : String(payload.event_type)
      : String(row.event_type);
  const summary = String(
    payload.summary ?? payload.message ?? payload.subject ?? `${source}:${eventType ?? "event"}`,
  );

  const facts = [...stringArray(payload.facts)];
  if (facts.length === 0) {
    const stableFields: Array<[string, unknown]> = [
      ["source", source],
      ["event_type", eventType],
      ["repository", payload.repository],
      ["sha", payload.sha],
      ["message", payload.message],
      ["subject", payload.subject],
      ["from", payload.from],
      ["file_id", payload.file_id],
      ["event_id", payload.event_id],
      ["start", payload.start],
    ];
    for (const [key, value] of stableFields) {
      if (value !== null && value !== undefined && String(value).length > 0) {
        facts.push(`${key}=${String(value)}`);
      }
    }
  }

  const rawCandidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : Array.isArray(payload.candidate_actions)
      ? payload.candidate_actions
      : [];

  return {
    source,
    event_type: eventType,
    summary,
    facts,
    inferences: stringArray(payload.inferences),
    unknowns: stringArray(payload.unknowns),
    constraints: stringArray(payload.constraints),
    resources: stringArray(payload.resources),
    candidates: rawCandidates
      .filter(
        (value): value is Record<string, unknown> =>
          !!value && typeof value === "object",
      )
      .map(normalizeCandidate),
    raw_data: payload,
  };
}

async function authorized(req: Request) {
  const token = req.headers.get("x-henyong-dispatch");
  if (!token) return false;
  const { data, error } = await db.rpc("henyong_validate_dispatch_token", {
    p_token: token,
  });
  return !error && data === true;
}

async function getAgent(): Promise<AgentConfig> {
  const { data, error } = await db
    .from("agents")
    .select("id,name,autonomy_level,risk_tolerance,confidence_threshold")
    .eq("name", "Henyong Oportunista")
    .limit(1)
    .single();
  if (error || !data) throw error ?? new Error("agent_not_found");
  return data as AgentConfig;
}

async function processEvent(input: EventInput, config: AgentConfig) {
  const integrity = integrityKernel(input);
  if (!integrity.valid) {
    throw new Error(`integrity_failed:${integrity.violations.join(",")}`);
  }

  const gaps = umFindGaps(input);
  const resources = uoInventory(input);
  const filtered = mtFilter(input.candidates);
  const ranked = hoRank(filtered.map(iwAdapt));
  const selected = kmSelect(ranked);
  const verification = mbGate(selected, gaps, config);
  let gate: Gate = verification.gate;
  const reasons = [...verification.reasons];

  // Runtime v2 has no external execution adapters. Prevent phantom AUTO.
  if (gate === "AUTO") {
    gate = "DRAFT";
    reasons.push("no_execution_adapter");
  }

  const { data: observation, error: observationError } = await db
    .from("observations")
    .insert({
      agent_id: config.id,
      source: input.source,
      event_type: input.event_type ?? null,
      summary: input.summary,
      facts: integrity.facts,
      inferences: integrity.inferences,
      unknowns: gaps,
      raw_data: input.raw_data ?? input,
      importance: selected?.value ?? 0.5,
      novelty: 0.5,
      confidence: selected?.confidence ?? 0.5,
    })
    .select("*")
    .single();
  if (observationError) throw observationError;

  const inserted: Array<Record<string, unknown>> = [];
  for (const item of ranked) {
    const { data, error } = await db
      .from("opportunities")
      .insert({
        agent_id: config.id,
        observation_id: observation.id,
        action_name: item.name,
        description: item.description ?? null,
        expected_value: item.value,
        cost: item.cost,
        risk: item.risk,
        reversibility: item.reversibility,
        timing_score: item.timing,
        confidence: item.confidence,
        information_gain: item.informationGain ?? 0.5,
        score: item.score,
      })
      .select("*")
      .single();
    if (error) throw error;
    inserted.push(data as Record<string, unknown>);
  }

  const selectedRow =
    inserted.find((row) => row.action_name === selected?.name) ?? null;
  const reasoning = [
    `MT filtered ${input.candidates.length} candidates to ${filtered.length}.`,
    `UM found ${gaps.length} knowledge gaps.`,
    `UO found ${resources.length} available resources.`,
    `HO ranked ${ranked.length} opportunities.`,
    selected ? `KM selected ${selected.name}.` : "KM found no viable action.",
    `MB gate=${gate}${reasons.length ? ` because ${reasons.join(", ")}` : ""}.`,
  ].join(" ");

  const { data: decision, error: decisionError } = await db
    .from("decisions")
    .insert({
      agent_id: config.id,
      opportunity_id: selectedRow?.id ?? null,
      selected_action: selected?.name ?? "no_action",
      reasoning_summary: reasoning,
      expected_result: selected
        ? `Action '${selected.name}' should create measurable progress with bounded downside.`
        : "No action expected.",
      gate,
      approval_required: ["ASK_USER", "DRAFT", "RECOMMEND"].includes(gate),
      prediction: selected
        ? {
            action: selected.name,
            expected_value: selected.value,
            expected_score: selected.score,
            confidence: selected.confidence,
            tool: selected.tool ?? null,
            tool_action: selected.toolAction ?? null,
          }
        : {},
    })
    .select("*")
    .single();
  if (decisionError) throw decisionError;

  if (["ASK_USER", "DRAFT", "RECOMMEND"].includes(gate) && selected) {
    const requestedAction =
      selected.tool && selected.toolAction
        ? `${selected.tool}/${selected.toolAction}:${selected.name}`
        : selected.name;
    const { error } = await db.from("approval_requests").upsert(
      {
        agent_id: config.id,
        decision_id: decision.id,
        requested_action: requestedAction,
      },
      { onConflict: "decision_id" },
    );
    if (error) throw error;
  }

  return {
    observation_id: observation.id,
    decision_id: decision.id,
    gate,
    selected_action: selected?.name ?? null,
    reasoning_summary: reasoning,
  };
}

async function drain(limit: number) {
  const config = await getAgent();
  const { data: run, error: runError } = await db
    .from("worker_runs")
    .insert({
      agent_id: config.id,
      trigger_source: "edge:henyong-runtime",
      status: "running",
    })
    .select("*")
    .single();
  if (runError) throw runError;

  let processed = 0;
  let failed = 0;

  try {
    const { data: events, error } = await db.rpc("henyong_claim_events", {
      p_agent_id: config.id,
      p_limit: Math.max(1, Math.min(limit || 5, 20)),
    });
    if (error) throw error;

    for (const rawEvent of events ?? []) {
      const event = rawEvent as Record<string, unknown>;
      try {
        await processEvent(normalizeEvent(event), config);
        const { error: updateError } = await db
          .from("event_inbox")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
            locked_at: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
        if (updateError) throw updateError;
        processed++;
      } catch (error) {
        failed++;
        const attempts = Number(event.attempts ?? 1);
        const dead = attempts >= Number(event.max_attempts ?? 3);
        const backoffMinutes = Math.min(
          60,
          Math.pow(2, Math.max(0, attempts - 1)),
        );
        await db
          .from("event_inbox")
          .update({
            status: dead ? "dead_letter" : "queued",
            locked_at: null,
            available_at: dead
              ? event.available_at
              : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
      }
    }

    const claimed = (events ?? []).length;
    await db
      .from("worker_runs")
      .update({
        status: claimed === 0 ? "noop" : failed === 0 ? "succeeded" : "failed",
        claimed_count: claimed,
        processed_count: processed,
        failed_count: failed,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return { run_id: run.id, claimed, processed, failed };
  } catch (error) {
    await db
      .from("worker_runs")
      .update({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    try {
      const agent = await getAgent();
      return json({
        ok: true,
        service: "henyong-runtime",
        version: VERSION,
        architecture: "AgilaLogic",
        db_ok: true,
        autonomy_level: agent.autonomy_level,
      });
    } catch (error) {
      return json(
        {
          ok: false,
          service: "henyong-runtime",
          version: VERSION,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!(await authorized(req))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (String(body.op ?? "") !== "drain") {
      return json({ ok: false, error: "unsupported_operation" }, 400);
    }
    return json({ ok: true, ...(await drain(Number(body.limit ?? 5))) });
  } catch (error) {
    console.error(error);
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
