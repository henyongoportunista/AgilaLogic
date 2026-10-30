import {
  EXTERNAL_AUTH_BOUNDARY_VERSION,
  createTestAuthVerifierRegistry,
  resolveVerifiedPrincipalContext,
  type AuthenticationAssurance,
  type VerifiedOperatorPrincipal,
} from "./external-auth.js";
import { weaveSignals } from "./gagamba.js";
import { compileNorthstarContext } from "./northstar.js";
import { bindProvenanceLedger } from "./provenance-integrity.js";
import { createInMemoryLifecycleRegistryStore, persistArchitectureState, persistEngineeringState } from "./replay-store.js";
import { proposalBinding, SAB_POLICY_VERSION, type ActionProposal, type ApprovalRecord } from "./sab.js";
import { ARCHITECT_ENGINEER_STRAND_VERSION, draftUntrustedSabProposal, htArchitect, mtEngineer } from "./strand.js";
import { TRUST_SPINE_VERSION, bindArchitectureLifecycle, bindEngineeringLifecycle, buildProvenanceLedger, type AdapterAttestation } from "./trust.js";
import { bindApprovalToNorthstar, createConsentOperationBinding, createResourceStateSnapshot } from "./execution.js";
import { createTestHumanConsentAuthority, type HumanConsentVerification } from "./human-consent.js";

export const APPROVED_AT = "2026-10-25T06:34:00.000Z";
export const PREPARED_AT = "2026-10-25T06:35:00.000Z";
export const CHECKED_AT = "2026-10-25T06:37:00.000Z";

/** Test-only source/state/auth/consent simulation; no canonical human governance policy. */
export async function executionSecurityFixture(options: {
  principal?: VerifiedOperatorPrincipal;
  sessionId?: string;
  assurance?: AuthenticationAssurance;
} = {}) {
  const principal = options.principal ?? "VERIFIED_SAL";
  const sessionId = options.sessionId ?? "execution-security-session-sal";
  const weave = weaveSignals({
    signals: [{
      id: "execution-security-fact", kind: "FACT", text: "The staging resource is available.",
      provenance: {
        sourceClass: "TOOL_OBSERVED", producer: "fixture-resource-observer",
        observedAt: "2026-10-25T06:15:00.000Z", sourceRef: "fixture://staging/customer",
        evidenceRef: "fixture://observed-customer/1",
      },
    }],
    candidates: [{
      id: "execution-security-candidate", value: 0.9, timing: 0.8, confidence: 0.9,
      cost: 0.1, risk: 0.2, reversibility: 0.9, informationGain: 0.5,
    }],
  });
  const architecture = htArchitect({
    packetId: "execution-security-architecture", objective: "Prepare a bounded staging write.",
    weave, successCriteria: ["No side effect is performed."], nonGoals: ["No production mutation."],
    intentEnvelope: {
      allowedActionTypes: ["WRITE"], allowedScopes: ["STAGING"], allowedDataSensitivities: ["SENSITIVE"],
      requireReversible: true, allowSecrets: false, maxAffectedRecords: 5, maxEstimatedCost: 1,
    },
  });
  const architectureState = bindArchitectureLifecycle(architecture, {
    lifecycleId: "execution-security-architecture-life", contextId: "execution-security-context",
    issuedAt: "2026-10-25T06:20:00.000Z", expiresAt: "2026-10-25T07:00:00.000Z", policyVersion: SAB_POLICY_VERSION,
  }, new Date("2026-10-25T06:25:00.000Z"));
  const { engineering } = mtEngineer(architecture,
    { autonomyLevel: 2, riskTolerance: 0.3, confidenceThreshold: 0.7 }, "execution-security-engineering");
  if (engineering.intent !== "PROPOSAL_ONLY") throw new Error("fixture_engineering_must_propose");
  const engineeringState = bindEngineeringLifecycle(engineering, {
    lifecycleId: "execution-security-engineering-life", contextId: "execution-security-context",
    issuedAt: "2026-10-25T06:26:00.000Z", expiresAt: "2026-10-25T06:55:00.000Z", policyVersion: SAB_POLICY_VERSION,
  }, architectureState, new Date("2026-10-25T06:27:00.000Z"));
  const expectation = draftUntrustedSabProposal(engineering, "execution-security-proposal", {
    type: "WRITE", scope: "STAGING", target: "staging.customer.42", reversible: true,
    dataSensitivity: "SENSITIVE", affectedRecords: 1, estimatedCost: 0, containsSecrets: false,
  });
  const registry = createTestAuthVerifierRegistry({
    providerId: "execution-security-auth",
    async verify() {
      return {
        verified: true, providerId: "execution-security-auth", principal, sessionId,
        subjectRef: `fixture-subject://${principal}`, assurance: options.assurance ?? "MFA",
        authenticatedAt: "2026-10-25T06:00:00.000Z", expiresAt: "2026-10-25T07:00:00.000Z", revoked: false,
      };
    },
  });
  const resolved = await resolveVerifiedPrincipalContext({
    version: EXTERNAL_AUTH_BOUNDARY_VERSION, providerId: "execution-security-auth", sessionHandle: sessionId,
    verificationRef: "fixture://auth/independent-session-result",
  }, registry, new Date("2026-10-25T06:25:00.000Z"), "test");
  const northstarContext = compileNorthstarContext({
    roleId: "MT", principalContext: resolved.principalContext, architectureVersion: ARCHITECT_ENGINEER_STRAND_VERSION,
    requestedKnowledgeClasses: ["PUBLIC", "INTERNAL"], now: new Date("2026-10-25T06:25:00.000Z"),
  });
  const attestation: AdapterAttestation = {
    version: TRUST_SPINE_VERSION, attestationId: "execution-security-attestation", requestId: engineering.packetId,
    proposalId: expectation.proposal.id, engineeringBinding: engineering.engineeringBinding,
    policyVersion: SAB_POLICY_VERSION, adapterId: "staging-adapter-contract",
    observedAt: "2026-10-25T06:30:00.000Z", expiresAt: "2026-10-25T06:50:00.000Z",
    operation: {
      type: "WRITE", scope: "STAGING", target: "staging.customer.42", reversible: true, dataSensitivity: "SENSITIVE",
      affectedRecords: 1, estimatedCost: { amount: 0, unit: "PROTOTYPE_SCALAR" }, containsSecrets: false,
    },
  };
  const provenanceLedger = buildProvenanceLedger(weave);
  const admission = {
    provenanceLedger, provenanceIntegrity: bindProvenanceLedger(provenanceLedger, architectureState),
    architectureState, engineeringState, northstarContext, expectation, attestation,
  };
  const resourceState = createResourceStateSnapshot({
    adapterId: attestation.adapterId, target: expectation.proposal.target, stateToken: "etag-customer-v7",
    observedAt: "2026-10-25T06:33:00.000Z", expiresAt: "2026-10-25T06:45:00.000Z",
  });
  const lifecycleStore = createInMemoryLifecycleRegistryStore();
  await persistArchitectureState(lifecycleStore, architectureState);
  await persistEngineeringState(lifecycleStore, engineeringState);
  const operationBinding = createConsentOperationBinding({ admission, resourceState });
  const responses = new Map<string, HumanConsentVerification>();
  const authority = createTestHumanConsentAuthority({
    providerId: "execution-security-consent",
    async verify(evidence) {
      const response = responses.get(evidence.verificationRef);
      if (!response) throw new Error("No independent fixture response exists");
      return response;
    },
  }, () => true);

  function rawApproval(proposal: ActionProposal = expectation.proposal): ApprovalRecord {
    return {
      proposalId: proposal.id, proposalBinding: proposalBinding(proposal), approved: true, approvedBy: principal,
      issuedAt: APPROVED_AT, expiresAt: "2026-10-25T06:39:00.000Z", policyVersion: SAB_POLICY_VERSION,
    };
  }
  async function approve() {
    const challenge = authority.issueChallenge({ proposal: expectation.proposal, operationBinding, policyVersion: SAB_POLICY_VERSION }, northstarContext, new Date(APPROVED_AT));
    const verificationRef = `fixture://independent-consent/${challenge.challengeId}`;
    responses.set(verificationRef, { decision: "APPROVED", challengeId: challenge.challengeId, principal, sessionId });
    const receipt = await authority.resolveConsent(challenge.challengeId, {
      providerId: "execution-security-consent", challengeId: challenge.challengeId, verificationRef,
    }, northstarContext, new Date(APPROVED_AT));
    const approval = rawApproval();
    const consent = { authority, receipt, operationBinding };
    const boundApproval = bindApprovalToNorthstar(expectation.proposal, approval, northstarContext, new Date(PREPARED_AT), consent, "test");
    return { consent, approval, boundApproval };
  }
  return { admission, resourceState, lifecycleStore, northstarContext, proposal: expectation.proposal, operationBinding, rawApproval, approve, authority };
}

export type ExecutionSecurityFixture = Awaited<ReturnType<typeof executionSecurityFixture>>;
