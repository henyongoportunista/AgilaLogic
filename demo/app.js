const scenarios = [
  {
    name: "Read customer list",
    note: "Read-only query, no state mutation.",
    proposal: {
      id: "demo-read-customers",
      type: "READ",
      scope: "PRODUCTION",
      target: "crm.customers",
      reversible: true,
      affectedRecords: 250,
    },
  },
  {
    name: "Update 47 records",
    note: "High-blast-radius production mutation.",
    proposal: {
      id: "demo-update-47",
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
      id: "demo-sandbox-draft",
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
      id: "demo-secret-exfiltration",
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

function proposalWithNonce(proposal) {
  return {
    ...proposal,
    id: `${proposal.id}-${Date.now()}`,
  };
}

function renderScenarios() {
  scenarioGrid.innerHTML = "";
  scenarios.forEach((scenario) => {
    const button = document.createElement("button");
    button.className = `scenario-btn${scenario === activeScenario ? " selected" : ""}`;
    button.innerHTML = `<strong>${scenario.name}</strong><small>${scenario.note}</small>`;
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
  $("#reasons").innerHTML = "<li>Run a scenario to inspect deterministic routing.</li>";
  humanGate.hidden = true;
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
  $("#reasons").innerHTML = decision.reasons.map((reason) => `<li>${reason}</li>`).join("");
  humanGate.hidden = !decision.requiresApproval;

  if (decision.route === "ALLOW" || decision.route === "ALLOW_WITH_LOG") {
    $("#executionStatus").textContent = "ADMITTED BY POLICY";
    $("#executionNote").textContent = "The proposal is authorized only for this sandbox demonstration; no external adapter is connected.";
  } else if (decision.route === "DENY") {
    $("#executionStatus").textContent = "HARD BLOCK";
    $("#executionNote").textContent = "This proposal cannot be rescued by ordinary human approval in the demo policy.";
  } else {
    $("#executionStatus").textContent = "AWAITING NODE ALPHA";
    $("#executionNote").textContent = "The AI proposal stops here until an exact human authorization is presented.";
  }
}

async function evaluate() {
  evaluateBtn.disabled = true;
  evaluateBtn.textContent = "Evaluating…";
  try {
    const proposal = proposalWithNonce(activeScenario.proposal);
    activeDecision = await post("/api/evaluate", { proposal });
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
  if (!activeDecision) return;
  const { proposal, decision } = activeDecision;
  const approval = {
    proposalId: proposal.id,
    actionType: proposal.type,
    target: proposal.target,
    approved: true,
    approvedBy: "Node Alpha / Demo Operator",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };

  const result = await post("/api/authorize", { proposal, decision, approval });
  $("#executionStatus").textContent = result.status;
  $("#executionNote").textContent = result.authorized
    ? "Exact approval matched. The action is authorized for sandbox execution; this demo intentionally has no real external adapter."
    : "Approval mismatch or policy block prevented authorization.";
  humanGate.hidden = true;
  await refreshAudit();
}

async function reject() {
  if (!activeDecision) return;
  await post("/api/reject", { proposal: activeDecision.proposal, reason: "node_alpha_veto" });
  $("#executionStatus").textContent = "BLOCKED BY HUMAN VETO";
  $("#executionNote").textContent = "Node Alpha rejected the proposed mutation. No execution authority was granted.";
  humanGate.hidden = true;
  await refreshAudit();
}

async function refreshAudit() {
  const response = await fetch("/api/audit", { cache: "no-store" });
  const { entries } = await response.json();
  const list = $("#auditList");

  if (!entries?.length) {
    list.innerHTML = '<p class="empty">No events yet.</p>';
    return;
  }

  list.innerHTML = entries.slice(0, 12).map((entry) => {
    const detail = entry.detail ?? {};
    const summary = [detail.proposalId, detail.route, detail.authorized === false ? "blocked" : null]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="audit-entry">
        <time>${new Date(entry.at).toLocaleTimeString()}</time>
        <code>${summary || entry.id}</code>
        <strong>${entry.type.replaceAll("_", " ")}</strong>
      </div>
    `;
  }).join("");
}

evaluateBtn.addEventListener("click", evaluate);
approveBtn.addEventListener("click", approve);
rejectBtn.addEventListener("click", reject);
refreshAuditBtn.addEventListener("click", refreshAudit);

renderScenarios();
renderProposal(activeScenario.proposal);
resetDecision();
refreshAudit().catch(() => {});
