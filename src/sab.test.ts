import {
  SAB_POLICY_VERSION,
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
  affectedRecords: 250,
  estimatedCost: 0,
  containsSecrets: false,
};

{
  const result = evaluateProposal(publicRead);
  assert(result.route === "ALLOW", `expected ALLOW, got ${result.route}`);
  assert(result.consequence === "LOW", `expected LOW, got ${result.consequence}`);
  assert(result.policyVersion === SAB_POLICY_VERSION, "decision must expose active policy version");
  assert(isExecutionAuthorized(publicRead, undefined, now), "bounded public read should be authorized");
}

const internalRead: ActionProposal = {
  ...publicRead,
  id: "read-internal-1",
  target: "internal.metrics",
  dataSensitivity: "INTERNAL",
};

{
  const result = evaluateProposal(internalRead);
  assert(result.route === "ALLOW_WITH_LOG", `expected ALLOW_WITH_LOG, got ${result.route}`);
  assert(result.consequence === "MEDIUM", `expected MEDIUM, got ${result.consequence}`);
}

const sensitiveRead: ActionProposal = {
  ...publicRead,
  id: "read-sensitive-1",
  target: "hr.payroll",
  dataSensitivity: "SENSITIVE",
};

for (const read of [publicRead, internalRead]) {
  const { estimatedCost: _cost, ...unknownCostRead } = read;
  const unknownCost = evaluateProposal(unknownCostRead);
  assert(unknownCost.route === "REQUIRE_HUMAN_APPROVAL", "unknown READ cost must not become zero");
  assert(unknownCost.reasons.includes("unknown_financial_cost"), "unknown READ cost requires a fixed reason");
  assert(!isExecutionAuthorized(unknownCostRead, undefined, now), "unknown READ cost must stop at authority gate");

  const paidRead = { ...read, estimatedCost: 0.01 };
  const paid = evaluateProposal(paidRead);
  assert(paid.route === "REQUIRE_HUMAN_APPROVAL", "paid READ must not inherit a read-only allow route");
  assert(paid.reasons.includes("financial_consequence"), "paid READ consequence must be explicit");
  assert(!isExecutionAuthorized(paidRead, undefined, now), "paid READ must stop at authority gate");

  const { containsSecrets: _secrets, ...unknownSecretsRead } = read;
  const unknownSecrets = evaluateProposal(unknownSecretsRead);
  assert(unknownSecrets.route === "REQUIRE_HUMAN_APPROVAL", "unknown READ secret status must not become false");
  assert(unknownSecrets.reasons.includes("unknown_secret_status"), "unknown READ secret status requires a fixed reason");
  assert(!isExecutionAuthorized(unknownSecretsRead, undefined, now), "unknown READ secret status must stop at authority gate");
}

{
  const externalSecretRead = {
    ...publicRead, scope: "EXTERNAL", dataSensitivity: "SECRET",
    estimatedCost: undefined, containsSecrets: undefined,
  };
  const result = evaluateProposal(externalSecretRead);
  assert(result.route === "DENY", "external SECRET READ must remain hard-denied before READ allows");
  assert(result.reasons.includes("secret_exfiltration_blocked"), "external secret deny must remain first");
}

{
  const result = evaluateProposal(sensitiveRead);
  assert(
    result.route === "REQUIRE_HUMAN_APPROVAL",
    `sensitive read should require approval, got ${result.route}`,
  );
  assert(!isExecutionAuthorized(sensitiveRead, undefined, now), "sensitive read must stop at gate");
}

{
  const unknownReadScope: ActionProposal = {
    ...publicRead,
    id: "read-unknown-size",
    affectedRecords: undefined,
  };
  const result = evaluateProposal(unknownReadScope);
  assert(
    result.route === "REQUIRE_HUMAN_APPROVAL",
    "unknown read blast radius must not be treated as zero",
  );
  assert(result.reasons.includes("unknown_read_blast_radius"), "unknown read size reason must be explicit");
}

{
  const bulkPublicRead: ActionProposal = {
    ...publicRead,
    id: "read-bulk-public",
    affectedRecords: 50_000,
  };
  const result = evaluateProposal(bulkPublicRead);
  assert(result.route === "REQUIRE_HUMAN_APPROVAL", "bulk public reads must be authority-gated");
  assert(result.reasons.includes("bulk_read_requires_authority"), "bulk read reason must be explicit");
}

const sandboxWrite: ActionProposal = {
  id: "write-1",
  type: "WRITE",
  scope: "SANDBOX",
  target: "demo-records",
  reversible: true,
  dataSensitivity: "INTERNAL",
  affectedRecords: 5,
  estimatedCost: 0,
  containsSecrets: false,
};

{
  const result = evaluateProposal(sandboxWrite);
  assert(result.route === "ALLOW_WITH_LOG", `expected ALLOW_WITH_LOG, got ${result.route}`);
  assert(
    isExecutionAuthorized(sandboxWrite, undefined, now),
    "fully bounded internal sandbox write should be authorized",
  );
}

{
  const incompleteSandboxWrite: ActionProposal = {
    ...sandboxWrite,
    id: "write-incomplete-1",
    affectedRecords: undefined,
    estimatedCost: undefined,
    containsSecrets: undefined,
  };
  const result = evaluateProposal(incompleteSandboxWrite);
  assert(
    result.route === "REQUIRE_HUMAN_APPROVAL",
    "missing low-risk metadata must not inherit harmless defaults",
  );
  assert(result.reasons.includes("unknown_blast_radius"), "unknown blast radius must be explicit");
  assert(result.reasons.includes("unknown_cost"), "unknown cost must be explicit");
  assert(result.reasons.includes("unknown_secret_status"), "unknown secret status must be explicit");
}

const sensitiveSandboxWrite: ActionProposal = {
  ...sandboxWrite,
  id: "write-sensitive-1",
  dataSensitivity: "SENSITIVE",
};

{
  const result = evaluateProposal(sensitiveSandboxWrite);
  assert(
    result.route === "REQUIRE_HUMAN_APPROVAL",
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
  estimatedCost: 0,
  containsSecrets: false,
};

{
  const result = evaluateProposal(destructiveProposal);
  assert(
    result.route === "REQUIRE_HUMAN_APPROVAL",
    `expected REQUIRE_HUMAN_APPROVAL, got ${result.route}`,
  );
  assert(result.consequence === "HIGH", `expected HIGH, got ${result.consequence}`);
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
    policyVersion: SAB_POLICY_VERSION,
  };

  assert(
    isExecutionAuthorized(destructiveProposal, approval, now),
    "exact short-lived approval should authorize the proposal",
  );

  for (const forgedFlag of ["true", 1, {}, []]) {
    const forgedApproval = { ...approval, approved: forgedFlag } as unknown as ApprovalRecord;
    assert(!isExecutionAuthorized(destructiveProposal, forgedApproval, now),
      "truthy non-boolean approval flags must not authorize");
  }

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
  assert(!isExecutionAuthorized(scopeDrift, approval, now), "approval must fail when scope changes");

  const sensitivityDrift: ActionProposal = {
    ...destructiveProposal,
    dataSensitivity: "SECRET",
  };
  assert(
    !isExecutionAuthorized(sensitivityDrift, approval, now),
    "approval must fail when data sensitivity changes",
  );

  const stalePolicyApproval: ApprovalRecord = {
    ...approval,
    policyVersion: "2026-10-25.2",
  };
  assert(
    !isExecutionAuthorized(destructiveProposal, stalePolicyApproval, now),
    "approval issued under another policy version must fail",
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
    affectedRecords: 1,
    estimatedCost: 0,
    containsSecrets: true,
  };

  const result = evaluateProposal(exfiltration);
  assert(result.route === "DENY", `expected DENY, got ${result.route}`);
  assert(!result.requiresApproval, "hard-denied action should not be approval-bypassable");

  const fakeApproval: ApprovalRecord = {
    proposalId: exfiltration.id,
    proposalBinding: proposalBinding(exfiltration),
    approved: true,
    approvedBy: "demo-operator",
    issuedAt: "2026-10-24T23:59:00.000Z",
    expiresAt: "2026-10-25T00:05:00.000Z",
    policyVersion: SAB_POLICY_VERSION,
  };
  assert(
    !isExecutionAuthorized(exfiltration, fakeApproval, now),
    "DENY must remain non-bypassable even with an exact approval",
  );
}

{
  const contradictorySecretFlag = {
    ...sandboxWrite,
    id: "contradiction-secret-1",
    dataSensitivity: "PUBLIC",
    containsSecrets: true,
  };
  const result = evaluateProposal(contradictorySecretFlag);
  assert(result.route === "DENY", "contradictory secret metadata must fail closed");
  assert(
    result.reasons.includes("secret_flag_requires_secret_sensitivity"),
    "secret/sensitivity contradiction must be explicit",
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

  const result = evaluateProposal(malformed);
  assert(result.route === "DENY", "invalid metadata must fail closed");
  assert(
    result.reasons.includes("invalid_proposal_metadata"),
    "invalid metadata reason must be explicit",
  );
  assert(!isExecutionAuthorized(malformed, undefined, now), "malformed action must never authorize");
}

{
  const unexpectedField = {
    ...sandboxWrite,
    hiddenPrivilegeEscalation: true,
  };
  const result = evaluateProposal(unexpectedField);
  assert(result.route === "DENY", "unexpected policy fields must fail closed");
}

console.log("SAB round-2 adversarial tests passed");
