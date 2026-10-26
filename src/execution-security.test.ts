import {
  assertExecutionPreconditionsUnchanged,
  bindApprovalToNorthstar,
  createConsentOperationBinding,
  createResourceStateSnapshot,
  preparePreExecution,
  verifyPreExecutionRequest,
  verifySessionBoundApproval,
  type PreExecutionRequest,
} from "./execution.js";
import { executionSecurityFixture, PREPARED_AT, CHECKED_AT, type ExecutionSecurityFixture } from "./execution-security.fixture.js";
import { SAB_POLICY_VERSION } from "./sab.js";
import { bindProvenanceLedger } from "./provenance-integrity.js";
import { bindArchitectureLifecycle, bindEngineeringLifecycle } from "./trust.js";
import { persistArchitectureState, persistEngineeringState } from "./replay-store.js";
import type { HumanConsentAuthority } from "./human-consent.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejectsWith(fn: () => Promise<unknown>, expected: string): Promise<void> {
  let matched = false;
  try { await fn(); } catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `Expected ${expected}`);
}
function throwsWith(fn: () => unknown, expected: string): void {
  let matched = false;
  try { fn(); } catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, `Expected ${expected}`);
}
let cases = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); cases++; console.log(`PASS execution security: ${name}`);
}
function preparation(fixture: ExecutionSecurityFixture, sessionBoundApproval?: Awaited<ReturnType<ExecutionSecurityFixture["approve"]>>["boundApproval"]) {
  return { admission: fixture.admission, lifecycleStore: fixture.lifecycleStore, resourceState: fixture.resourceState,
    sessionBoundApproval, now: new Date(PREPARED_AT) };
}
function finalCheck(fixture: ExecutionSecurityFixture, request: PreExecutionRequest) {
  return { request, lifecycleStore: fixture.lifecycleStore, architectureState: fixture.admission.architectureState,
    engineeringState: fixture.admission.engineeringState, currentResourceState: fixture.resourceState, now: new Date(CHECKED_AT) };
}

await test("verified session plus approved:true without independent consent is rejected", async () => {
  const f = await executionSecurityFixture();
  throwsWith(() => bindApprovalToNorthstar(f.proposal, f.rawApproval(), f.northstarContext, new Date(PREPARED_AT), undefined, "test"), "human_consent_receipt_required");
});

await test("default production rejects fixture auth despite an otherwise valid consent", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  throwsWith(() => bindApprovalToNorthstar(f.proposal, approved.approval, f.northstarContext, new Date(PREPARED_AT), approved.consent), "human_approval_runtime_mode_mismatch");
  await rejectsWith(() => preparePreExecution(preparation(f, approved.boundApproval)), "human_approval_runtime_mode_mismatch");
  const callerSuppliedMode = { ...preparation(f, approved.boundApproval), runtimeMode: "test", mode: "test" };
  await rejectsWith(() => preparePreExecution(callerSuppliedMode), "human_approval_runtime_mode_mismatch");
});

await test("MFA may reach consent and prepare a medium-consequence operation", async () => {
  const f = await executionSecurityFixture({ assurance: "MFA" }); const approved = await f.approve();
  const prepared = await preparePreExecution(preparation(f, approved.boundApproval), "test");
  assert(verifyPreExecutionRequest(prepared), "properly composed preparation must verify");
  assert(prepared.trust === "PRE_EXECUTION_STRUCTURALLY_READY_UNAUTHENTICATED", "no execution/authentication claim may be added");
});

await test("SINGLE_FACTOR cannot satisfy medium or high-impact human-approval routes", async () => {
  const f = await executionSecurityFixture({ assurance: "SINGLE_FACTOR" });
  throwsWith(() => bindApprovalToNorthstar(f.proposal, f.rawApproval(), f.northstarContext, new Date(PREPARED_AT), undefined, "test"), "authentication_assurance_insufficient");
  const highImpact = { ...f.proposal, type: "DELETE" as const };
  throwsWith(() => bindApprovalToNorthstar(highImpact, f.rawApproval(highImpact), f.northstarContext, new Date(PREPARED_AT), undefined, "test"), "authentication_assurance_insufficient");
});

await test("MFA cannot satisfy high-impact approval while phishing-resistant MFA only reaches consent", async () => {
  const mfa = await executionSecurityFixture({ assurance: "MFA" });
  const highImpact = { ...mfa.proposal, type: "DELETE" as const };
  throwsWith(() => bindApprovalToNorthstar(highImpact, mfa.rawApproval(highImpact), mfa.northstarContext, new Date(PREPARED_AT), undefined, "test"), "authentication_assurance_insufficient");
  const strong = await executionSecurityFixture({ assurance: "PHISHING_RESISTANT_MFA" });
  throwsWith(() => bindApprovalToNorthstar(highImpact, strong.rawApproval(highImpact), strong.northstarContext, new Date(PREPARED_AT), undefined, "test"), "human_consent_receipt_required");
});

await test("raw consent window cannot drift from the independently issued receipt", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  throwsWith(() => bindApprovalToNorthstar(f.proposal, { ...approved.approval, expiresAt: "2026-10-25T06:40:00.000Z" }, f.northstarContext, new Date(PREPARED_AT), approved.consent, "test"), "approval_consent_window_mismatch");
});

await test("copied authority and fabricated receipts cannot replace the private server boundary", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  throwsWith(() => bindApprovalToNorthstar(f.proposal, approved.approval, f.northstarContext, new Date(PREPARED_AT), {
    ...approved.consent, authority: { ...f.authority, verifyReceipt() { return true; } } as HumanConsentAuthority,
  }, "test"), "human_consent_authority_mode_mismatch");
  throwsWith(() => bindApprovalToNorthstar(f.proposal, approved.approval, f.northstarContext, new Date(PREPARED_AT), {
    ...approved.consent, receipt: { ...approved.consent.receipt },
  }, "test"), "human_consent_receipt_invalid");
});

await test("a valid receipt and bound approval can prepare only once", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const input = preparation(f, approved.boundApproval);
  await preparePreExecution(input, "test");
  await rejectsWith(() => preparePreExecution(input, "test"), "session_bound_approval_invalid");
});

await test("two concurrent preparations cannot consume one consent twice", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const input = preparation(f, approved.boundApproval);
  const results = await Promise.allSettled([preparePreExecution(input, "test"), preparePreExecution(input, "test")]);
  assert(results.filter((result) => result.status === "fulfilled").length === 1, "exactly one preparation may succeed");
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(rejected?.reason instanceof Error && ["session_bound_approval_invalid", "human_consent_receipt_invalid_or_consumed"].includes(rejected.reason.message), "the other preparation must fail at consent replay protection");
});

await test("bound approval inspection is non-consuming, but copied/deserialized approvals are rejected", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const verify = (approval: typeof approved.boundApproval) => verifySessionBoundApproval(f.proposal, approval, f.northstarContext, new Date(PREPARED_AT), f.operationBinding, "test");
  assert(verify(approved.boundApproval) && verify(approved.boundApproval), "pure inspection must not consume consent");
  assert(!verify({ ...approved.boundApproval }), "copied bound approval must lose private provenance");
  assert(!verify(JSON.parse(JSON.stringify(approved.boundApproval))), "deserialized approval must require fresh trusted composition");
  await preparePreExecution(preparation(f, approved.boundApproval), "test");
});

await test("consent for proposal A cannot authorize proposal B", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  assert(!verifySessionBoundApproval({ ...f.proposal, id: "execution-security-proposal-b" }, approved.boundApproval, f.northstarContext, new Date(PREPARED_AT), f.operationBinding, "test"), "proposal binding mismatch must fail");
});

await test("consent cannot transfer to a different session or human principal", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const otherSession = await executionSecurityFixture({ sessionId: "execution-security-session-other" });
  const bjorn = await executionSecurityFixture({ principal: "VERIFIED_BJORN", sessionId: "execution-security-session-bjorn" });
  for (const other of [otherSession, bjorn]) {
    assert(!verifySessionBoundApproval(f.proposal, approved.boundApproval, other.northstarContext, new Date(PREPARED_AT), f.operationBinding, "test"), "session/principal substitution must fail");
    await rejectsWith(() => preparePreExecution({ ...preparation(f, approved.boundApproval), admission: { ...f.admission, northstarContext: other.northstarContext } }, "test"), "session_bound_approval_invalid");
  }
});

await test("changed resource state invalidates the transaction-specific consent", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const changed = createResourceStateSnapshot({ ...f.resourceState, stateToken: "etag-customer-v8" });
  await rejectsWith(() => preparePreExecution({ ...preparation(f, approved.boundApproval), resourceState: changed }, "test"), "session_bound_approval_invalid");
});

await test("changed adapter invalidates consent even when attestation and resource agree with each other", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const adapterId = "different-contract-adapter";
  const admission = { ...f.admission, attestation: { ...f.admission.attestation, adapterId } };
  const resourceState = createResourceStateSnapshot({ ...f.resourceState, adapterId });
  await rejectsWith(() => preparePreExecution({ ...preparation(f, approved.boundApproval), admission, resourceState }, "test"), "session_bound_approval_invalid");
});

await test("fresh but superseding lifecycle states require fresh transaction consent", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const architectureState = bindArchitectureLifecycle(f.admission.architectureState.architecture, {
    ...f.admission.architectureState.lifecycle, lifecycleId: "execution-security-architecture-life-2",
    issuedAt: "2026-10-25T06:34:00.000Z", supersedesLifecycleId: f.admission.architectureState.lifecycle.lifecycleId,
  }, new Date(PREPARED_AT));
  const engineeringState = bindEngineeringLifecycle(f.admission.engineeringState.engineering, {
    ...f.admission.engineeringState.lifecycle, lifecycleId: "execution-security-engineering-life-2",
    issuedAt: "2026-10-25T06:34:30.000Z", supersedesLifecycleId: f.admission.engineeringState.lifecycle.lifecycleId,
  }, architectureState, new Date(PREPARED_AT));
  await persistArchitectureState(f.lifecycleStore, architectureState);
  await persistEngineeringState(f.lifecycleStore, engineeringState);
  const admission = { ...f.admission, architectureState, engineeringState,
    provenanceIntegrity: bindProvenanceLedger(f.admission.provenanceLedger, architectureState) };
  assert(createConsentOperationBinding({ admission, resourceState: f.resourceState }) !== f.operationBinding, "state replacement must change the consent operation binding");
  await rejectsWith(() => preparePreExecution({ ...preparation(f, approved.boundApproval), admission }, "test"), "session_bound_approval_invalid");
});

await test("expired consent cannot prepare at its exact expiry", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  await rejectsWith(() => preparePreExecution({ ...preparation(f, approved.boundApproval), now: new Date(approved.consent.receipt.expiresAt) }, "test"), "session_bound_approval_invalid");
});

await test("copied prepared requests and forged route labels cannot grant authority", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const prepared = await preparePreExecution(preparation(f, approved.boundApproval), "test");
  assert(!verifyPreExecutionRequest({ ...prepared }), "copied consequential preparation must lose its server issuance stamp");
  assert(!verifyPreExecutionRequest(JSON.parse(JSON.stringify(prepared))), "deserialized preparation must be rejected");
  await rejectsWith(() => assertExecutionPreconditionsUnchanged(finalCheck(f, { ...prepared }), "test"), "pre_execution_binding_mismatch");
  const { binding: _binding, ...payload } = prepared;
  const forgedPayload = { ...payload, sabRoute: "ALLOW" as const };
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)]));
  }
  const forged = { ...forgedPayload, binding: JSON.stringify(canonical(forgedPayload)) };
  assert(!verifyPreExecutionRequest(forged), "recomputed noncryptographic binding must not let a caller downgrade the actual SAB route");
  assert(!verifyPreExecutionRequest({ ...prepared, policyVersion: "changed-active-policy" as typeof SAB_POLICY_VERSION }), "policy-version drift must fail");
});

await test("final checkpoint rejects production misuse and can be consumed only once", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const prepared = await preparePreExecution(preparation(f, approved.boundApproval), "test");
  await rejectsWith(() => assertExecutionPreconditionsUnchanged(finalCheck(f, prepared)), "pre_execution_runtime_mode_mismatch");
  await assertExecutionPreconditionsUnchanged(finalCheck(f, prepared), "test");
  await rejectsWith(() => assertExecutionPreconditionsUnchanged(finalCheck(f, prepared), "test"), "pre_execution_already_consumed");
});

await test("failed final resource checks do not consume the preparation before validation", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const prepared = await preparePreExecution(preparation(f, approved.boundApproval), "test");
  const changed = createResourceStateSnapshot({ ...f.resourceState, stateToken: "etag-customer-v8" });
  await rejectsWith(() => assertExecutionPreconditionsUnchanged({ ...finalCheck(f, prepared), currentResourceState: changed }, "test"), "resource_state_changed_since_preparation");
  await assertExecutionPreconditionsUnchanged(finalCheck(f, prepared), "test");
});

await test("concurrent final checkpoints permit exactly one process-local continuation", async () => {
  const f = await executionSecurityFixture(); const approved = await f.approve();
  const prepared = await preparePreExecution(preparation(f, approved.boundApproval), "test");
  const results = await Promise.allSettled([
    assertExecutionPreconditionsUnchanged(finalCheck(f, prepared), "test"),
    assertExecutionPreconditionsUnchanged(finalCheck(f, prepared), "test"),
  ]);
  assert(results.filter((result) => result.status === "fulfilled").length === 1, "exactly one final checkpoint may continue");
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert(rejected?.reason instanceof Error && rejected.reason.message === "pre_execution_already_consumed", "the second checkpoint must reject consumed preparation");
});

await test("strong verified identity and caller approval cannot override a hard DENY", async () => {
  const f = await executionSecurityFixture({ assurance: "PHISHING_RESISTANT_MFA" });
  const denied = { ...f.proposal, scope: "EXTERNAL" as const, dataSensitivity: "SECRET" as const, containsSecrets: true };
  throwsWith(() => bindApprovalToNorthstar(denied, f.rawApproval(denied), f.northstarContext, new Date(PREPARED_AT), undefined, "test"), "sab_approval_not_authorized");
});

console.log(`execution security integration tests passed (${cases} cases)`);
