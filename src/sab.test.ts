import {
  evaluateProposal,
  isExecutionAuthorized,
  type ActionProposal,
  type ApprovalRecord,
} from "./sab.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const readProposal: ActionProposal = {
  id: "read-1",
  type: "READ",
  scope: "PRODUCTION",
  target: "customers",
  reversible: true,
};

{
  const decision = evaluateProposal(readProposal);
  assert(decision.route === "ALLOW", `expected ALLOW, got ${decision.route}`);
  assert(isExecutionAuthorized(readProposal, decision), "read should be authorized");
}

const sandboxWrite: ActionProposal = {
  id: "write-1",
  type: "WRITE",
  scope: "SANDBOX",
  target: "demo-records",
  reversible: true,
  affectedRecords: 5,
};

{
  const decision = evaluateProposal(sandboxWrite);
  assert(decision.route === "ALLOW_WITH_LOG", `expected ALLOW_WITH_LOG, got ${decision.route}`);
  assert(isExecutionAuthorized(sandboxWrite, decision), "bounded sandbox write should be authorized");
}

const destructiveProposal: ActionProposal = {
  id: "delete-47",
  type: "DELETE",
  scope: "PRODUCTION",
  target: "customers:inactive",
  reversible: false,
  affectedRecords: 47,
};

{
  const decision = evaluateProposal(destructiveProposal);
  assert(
    decision.route === "REQUIRE_HUMAN_APPROVAL",
    `expected REQUIRE_HUMAN_APPROVAL, got ${decision.route}`,
  );
  assert(decision.consequence === "HIGH", `expected HIGH, got ${decision.consequence}`);
  assert(!isExecutionAuthorized(destructiveProposal, decision), "must not execute without approval");

  const approval: ApprovalRecord = {
    proposalId: destructiveProposal.id,
    actionType: destructiveProposal.type,
    target: destructiveProposal.target,
    approved: true,
    approvedBy: "node-alpha",
  };

  assert(
    isExecutionAuthorized(destructiveProposal, decision, approval),
    "exact human approval should authorize the proposal",
  );

  const driftedApproval: ApprovalRecord = {
    ...approval,
    target: "customers:all",
  };
  assert(
    !isExecutionAuthorized(destructiveProposal, decision, driftedApproval),
    "approval target drift must be rejected",
  );
}

{
  const exfiltration: ActionProposal = {
    id: "secret-1",
    type: "EXTERNAL_MESSAGE",
    scope: "EXTERNAL",
    target: "unknown-webhook",
    reversible: false,
    containsSecrets: true,
  };

  const decision = evaluateProposal(exfiltration);
  assert(decision.route === "DENY", `expected DENY, got ${decision.route}`);
  assert(!decision.requiresApproval, "hard-denied action should not be approval-bypassable");
  assert(!isExecutionAuthorized(exfiltration, decision), "denied action must never execute");
}

console.log("SAB tests passed");
