import {
  evaluateProposal,
  isExecutionAuthorized,
  proposalBinding,
  type ActionProposal,
  type ApprovalRecord,
} from "./sab.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-10-25T00:00:00.000Z");

const publicRead: ActionProposal = {
  id: "read-public-1",
  type: "READ",
  scope: "PRODUCTION",
  target: "public.catalog",
  reversible: true,
  dataSensitivity: "PUBLIC",
};

{
  const decision = evaluateProposal(publicRead);
  assert(decision.route === "ALLOW", `expected ALLOW, got ${decision.route}`);
  assert(decision.consequence === "LOW", `expected LOW, got ${decision.consequence}`);
  assert(isExecutionAuthorized(publicRead, undefined, now), "public read should be authorized");
}

const internalRead: ActionProposal = {
  ...publicRead,
  id: "read-internal-1",
  target: "internal.metrics",
  dataSensitivity: "INTERNAL",
};

{
  const decision = evaluateProposal(internalRead);
  assert(decision.route === "ALLOW_WITH_LOG", `expected ALLOW_WITH_LOG, got ${decision.route}`);
  assert(decision.consequence === "MEDIUM", `expected MEDIUM, got ${decision.consequence}`);
}

const sensitiveRead: ActionProposal = {
  ...publicRead,
  id: "read-sensitive-1",
  target: "hr.payroll",
  dataSensitivity: "SENSITIVE",
};

{
  const decision = evaluateProposal(sensitiveRead);
  assert(
    decision.route === "REQUIRE_HUMAN_APPROVAL",
    `sensitive read should require approval, got ${decision.route}`,
  );
  assert(!isExecutionAuthorized(sensitiveRead, undefined, now), "sensitive read must stop at gate");
}

const sandboxWrite: ActionProposal = {
  id: "write-1",
  type: "WRITE",
  scope: "SANDBOX",
  target: "demo-records",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 5,
};

{
  const decision = evaluateProposal(sandboxWrite);
  assert(decision.route === "ALLOW_WITH_LOG", `expected ALLOW_WITH_LOG, got ${decision.route}`);
  assert(
    isExecutionAuthorized(sandboxWrite, undefined, now),
    "bounded internal sandbox write should be authorized",
  );
}

const sensitiveSandboxWrite: ActionProposal = {
  ...sandboxWrite,
  id: "write-sensitive-1",
  dataSensitivity: "SENSITIVE",
};

{
  const decision = evaluateProposal(sensitiveSandboxWrite);
  assert(
    decision.route === "REQUIRE_HUMAN_APPROVAL",
    "sensitive sandbox data should not inherit low-risk auto-admission",
  );
}

const destructiveProposal: ActionProposal = {
  id: "delete-47",
  type: "DELETE",
  scope: "PRODUCTION",
  target: "customers:inactive",
  reversible: false,
  dataSensitivity: "SENSITIVE",
  affectedRecords: 47,
};

{
  const decision = evaluateProposal(destructiveProposal);
  assert(
    decision.route === "REQUIRE_HUMAN_APPROVAL",
    `expected REQUIRE_HUMAN_APPROVAL, got ${decision.route}`,
  );
  assert(decision.consequence === "HIGH", `expected HIGH, got ${decision.consequence}`);
  assert(
    !isExecutionAuthorized(destructiveProposal, undefined, now),
    "must not execute without approval",
  );

  const approval: ApprovalRecord = {
    proposalId: destructiveProposal.id,
    proposalBinding: proposalBinding(destructiveProposal),
    approved: true,
    approvedBy: "demo-operator",
    issuedAt: "2026-10-24T23:59:00.000Z",
    expiresAt: "2026-10-25T00:05:00.000Z",
  };

  assert(
    isExecutionAuthorized(destructiveProposal, approval, now),
    "exact short-lived approval should authorize the proposal",
  );

  const blastRadiusDrift: ActionProposal = {
    ...destructiveProposal,
    affectedRecords: 4700,
  };
  assert(
    !isExecutionAuthorized(blastRadiusDrift, approval, now),
    "approval must fail when blast radius changes without changing ID/type/target",
  );

  const scopeDrift: ActionProposal = {
    ...destructiveProposal,
    scope: "EXTERNAL",
  };
  assert(
    !isExecutionAuthorized(scopeDrift, approval, now),
    "approval must fail when scope changes",
  );

  const sensitivityDrift: ActionProposal = {
    ...destructiveProposal,
    dataSensitivity: "SECRET",
  };
  assert(
    !isExecutionAuthorized(sensitivityDrift, approval, now),
    "approval must fail when data sensitivity changes",
  );

  const expiredApproval: ApprovalRecord = {
    ...approval,
    issuedAt: "2026-10-24T23:40:00.000Z",
    expiresAt: "2026-10-24T23:55:00.000Z",
  };
  assert(
    !isExecutionAuthorized(destructiveProposal, expiredApproval, now),
    "expired approval must fail closed",
  );

  const excessiveTtlApproval: ApprovalRecord = {
    ...approval,
    issuedAt: "2026-10-24T23:59:00.000Z",
    expiresAt: "2026-10-25T00:30:00.000Z",
  };
  assert(
    !isExecutionAuthorized(destructiveProposal, excessiveTtlApproval, now),
    "approval TTL above policy maximum must be rejected",
  );
}

{
  const exfiltration: ActionProposal = {
    id: "secret-1",
    type: "EXTERNAL_MESSAGE",
    scope: "EXTERNAL",
    target: "unknown-webhook",
    reversible: false,
    dataSensitivity: "SECRET",
    containsSecrets: true,
  };

  const decision = evaluateProposal(exfiltration);
  assert(decision.route === "DENY", `expected DENY, got ${decision.route}`);
  assert(!decision.requiresApproval, "hard-denied action should not be approval-bypassable");

  const fakeApproval: ApprovalRecord = {
    proposalId: exfiltration.id,
    proposalBinding: proposalBinding(exfiltration),
    approved: true,
    approvedBy: "demo-operator",
    issuedAt: "2026-10-24T23:59:00.000Z",
    expiresAt: "2026-10-25T00:05:00.000Z",
  };
  assert(
    !isExecutionAuthorized(exfiltration, fakeApproval, now),
    "DENY must remain non-bypassable even with an exact approval",
  );
}

{
  const malformed = {
    id: "malformed-1",
    type: "READ_AND_DELETE",
    scope: "PRODUCTION",
    target: "customers",
    reversible: "yes",
    dataSensitivity: "TOTALLY_FINE",
    affectedRecords: -10,
  };

  const decision = evaluateProposal(malformed);
  assert(decision.route === "DENY", "invalid metadata must fail closed");
  assert(
    decision.reasons.includes("invalid_proposal_metadata"),
    "invalid metadata reason must be explicit",
  );
  assert(!isExecutionAuthorized(malformed, undefined, now), "malformed action must never authorize");
}

{
  const unexpectedField = {
    ...sandboxWrite,
    hiddenPrivilegeEscalation: true,
  };
  const decision = evaluateProposal(unexpectedField);
  assert(decision.route === "DENY", "unexpected policy fields must fail closed");
}

console.log("SAB adversarial tests passed");
