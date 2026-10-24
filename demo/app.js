const scenarios = [
  {
    name: "Read public catalog",
    note: "Read-only query over non-sensitive demo data.",
    proposal: {
      type: "READ",
      scope: "PRODUCTION",
      target: "public.catalog",
      reversible: true,
      affectedRecords: 250,
    },
  },
  {
    name: "Update 47 records",
    note: "High-blast-radius production mutation.",
    proposal: {
      type: "WRITE",
      scope: "PRODUCTION",
      target: "crm.customer_status",
      reversible: true,
      affectedRecords: 47,
    },
  },
  {
    name: "Sandbox draft",
    note: "Bounded reversible write inside sandbox.",
    proposal: {
      type: "WRITE",
      scope: "SANDBOX",
      target: "sandbox.message_draft",
      reversible: true,
      affectedRecords: 1,
    },
  },
  {
    name: "External secret leak",
    note: "Secret-bearing output crossing an external boundary.",
    proposal: {
      type: "EXTERNAL_MESSAGE",
      scope: "EXTERNAL",
      target: "external.webhook",
      reversible: false,
      affectedRecords: 1,
      containsSecrets: true,
    },
  },
];

const $ = (selector) => document.querySelector(selector);
const scenarioGrid = $("#scenarioGrid");
const evaluateBtn = $("#evaluateBtn");
const approveBtn = $("#approveBtn");
const rejectBtn = $("#rejectBtn");
const refreshAuditBtn = $("#refreshAuditBtn");
const humanGate = $("#humanGate");
const routeBadge = $("#routeBadge");

let activeScenario = scenarios[1];
let activeDecision = null;

function setReasons(reasons) {
  const list = $("#reasons");
  list.replaceChildren();
  for (const reason of reasons) {
    const item = document.createElement("li");
    item.textContent = String(reason);
    list.appendChild(item);
  }
}

function renderScenarios() {
  scenarioGrid.replaceChildren();
  scenarios.forEach((scenario) => {
    const button = document.createElement("button");
    button.className = `scenario-btn${scenario === activeScenario ? " selected" : ""}`;

    const title = document.createElement("strong");
    title.textContent = scenario.name;
    const note = document.createElement("small");
    note.textContent = scenario.note;
    button.append(title, note);

    button.addEventListener("click", () => {
      activeScenario = scenario;
      activeDecision = null;
      renderScenarios();
      renderProposal(scenario.proposal);
      resetDecision();
    });
    scenarioGrid.appendChild(button);
  });
}

function renderProposal(proposal) {
  $("#pType").textContent = proposal.type;
  $("#pScope").textContent = proposal.scope;
  $("#pTarget").textContent = proposal.target;
  $("#pReversible").textContent = proposal.reversible ? "YES" : "NO";
  $("#pBlast").textContent = `${proposal.affectedRecords ?? 0} record(s)`;
}

function resetDecision() {
  routeBadge.textContent = "NOT EVALUATED";
  routeBadge.className = "decision-badge neutral";
  $("#consequence").textContent = "—";
  setReasons(["Run a scenario to inspect deterministic routing."]);
  humanGate.hidden = true;
  approveBtn.disabled = false;
  rejectBtn.disabled = false;
  $("#executionStatus").textContent = "WAITING";
  $("#executionNote").textContent = "No real external side effect is executed in this demo.";
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function renderDecision(decision) {
  routeBadge.textContent = decision.route.replaceAll("_", " ");
  routeBadge.className = `decision-badge ${
    decision.route === "DENY"
      ? "deny"
      : decision.route === "REQUIRE_HUMAN_APPROVAL"
        ? "gate"
        : "allow"
  }`;
  $("#consequence").textContent = decision.consequence;
  setReasons(decision.reasons);
  humanGate.hidden = !decision.requiresApproval;

  if (decision.route === "ALLOW" || decision.route === "ALLOW_WITH_LOG") {
    $("#executionStatus").textContent = "ADMITTED BY POLICY";
    $("#executionNote").textContent = "Authorized only inside this demonstration. No external execution adapter is connected.";
  } else if (decision.route === "DENY") {
    $("#executionStatus").textContent = "HARD BLOCK";
    $("#executionNote").textContent = "This proposal cannot be rescued by ordinary demo-operator approval.";
  } else {
    $("#executionStatus").textContent = "AWAITING DEMO OPERATOR";
    $("#executionNote").textContent = "The proposal stops here. This button simulates the Node Alpha role; identity authentication is intentionally not implemented yet.";
  }
}

async function evaluate() {
  evaluateBtn.disabled = true;
  evaluateBtn.textContent = "Evaluating…";
  activeDecision = null;
  humanGate.hidden = true;

  try {
    activeDecision = await post("/api/evaluate", { proposal: activeScenario.proposal });
    renderProposal(activeDecision.proposal);
    renderDecision(activeDecision.decision);
    await refreshAudit();
  } catch (error) {
    $("#executionStatus").textContent = "DEMO ERROR";
    $("#executionNote").textContent = error instanceof Error ? error.message : String(error);
  } finally {
    evaluateBtn.disabled = false;
    evaluateBtn.textContent = "Evaluate through SAB";
  }
}

async function approve() {
  if (!activeDecision?.proposal?.id) return;
  approveBtn.disabled = true;
  rejectBtn.disabled = true;

  try {
    const result = await post("/api/authorize", { proposalId: activeDecision.proposal.id });
    $("#executionStatus").textContent = result.status;
    $("#executionNote").textContent = result.authorized
      ? "The server re-evaluated the stored proposal and accepted a one-time demo authorization. No external adapter is connected and no identity claim is made."
      : "Policy or approval-state checks prevented authorization.";
    humanGate.hidden = true;
    activeDecision = null;
    await refreshAudit();
  } catch (error) {
    $("#executionStatus").textContent = "AUTHORIZATION BLOCKED";
    $("#executionNote").textContent = error instanceof Error ? error.message : String(error);
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
  }
}

async function reject() {
  if (!activeDecision?.proposal?.id) return;
  approveBtn.disabled = true;
  rejectBtn.disabled = true;

  try {
    await post("/api/reject", { proposalId: activeDecision.proposal.id });
    $("#executionStatus").textContent = "BLOCKED BY HUMAN VETO";
    $("#executionNote").textContent = "The demo operator rejected the pending mutation. The pending approval state was removed.";
    humanGate.hidden = true;
    activeDecision = null;
    await refreshAudit();
  } catch (error) {
    $("#executionStatus").textContent = "VETO ERROR";
    $("#executionNote").textContent = error instanceof Error ? error.message : String(error);
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
  }
}

async function refreshAudit() {
  const response = await fetch("/api/audit", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { entries } = await response.json();
  const list = $("#auditList");
  list.replaceChildren();

  if (!entries?.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No events yet.";
    list.appendChild(empty);
    return;
  }

  for (const entry of entries.slice(0, 12)) {
    const detail = entry.detail ?? {};
    const summary = [
      detail.proposalId,
      detail.route,
      detail.authorized === false ? "blocked" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const row = document.createElement("div");
    row.className = "audit-entry";

    const time = document.createElement("time");
    time.textContent = new Date(entry.at).toLocaleTimeString();

    const code = document.createElement("code");
    code.textContent = summary || String(entry.id ?? "event");

    const type = document.createElement("strong");
    type.textContent = String(entry.type ?? "EVENT").replaceAll("_", " ");

    row.append(time, code, type);
    list.appendChild(row);
  }
}

evaluateBtn.addEventListener("click", evaluate);
approveBtn.addEventListener("click", approve);
rejectBtn.addEventListener("click", reject);
refreshAuditBtn.addEventListener("click", () => refreshAudit().catch(() => {}));

renderScenarios();
renderProposal(activeScenario.proposal);
resetDecision();
refreshAudit().catch(() => {});
