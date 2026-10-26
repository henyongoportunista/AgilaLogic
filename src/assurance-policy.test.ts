import {
  ASSURANCE_POLICY_VERSION,
  assertAuthenticationAssurance,
  requiredAuthenticationAssurance,
} from "./assurance-policy.js";
import type { AuthenticationAssurance } from "./external-auth.js";
import { evaluateProposal, type ActionProposal, type ActionType } from "./sab.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throwsWith(fn: () => unknown, expected: string, message: string): void {
  let matched = false;
  try { fn(); }
  catch (error) { matched = error instanceof Error && error.message === expected; }
  assert(matched, message);
}

const publicRead: ActionProposal = {
  id: "assurance-public-read",
  type: "READ",
  scope: "PRODUCTION",
  target: "public.catalog",
  reversible: true,
  dataSensitivity: "PUBLIC",
  affectedRecords: 1,
  estimatedCost: 0,
  containsSecrets: false,
};

const sensitiveRead: ActionProposal = {
  ...publicRead,
  id: "assurance-sensitive-read",
  dataSensitivity: "SENSITIVE",
};

assert(ASSURANCE_POLICY_VERSION === "2026-10-25.1", "assurance policy must have an explicit version");
assert(requiredAuthenticationAssurance(publicRead) === null, "non-consequential public read may remain public");
assertAuthenticationAssurance(publicRead, undefined);
assertAuthenticationAssurance(publicRead, "SINGLE_FACTOR");

{
  const internalRead: ActionProposal = { ...publicRead, dataSensitivity: "INTERNAL" };
  assert(requiredAuthenticationAssurance(internalRead) === null, "logged bounded read creates no human consent route");
  assertAuthenticationAssurance(internalRead, undefined);
}

{
  const sandboxWrite: ActionProposal = {
    ...publicRead,
    id: "assurance-bounded-sandbox-write",
    type: "WRITE",
    scope: "SANDBOX",
    dataSensitivity: "INTERNAL",
  };
  assert(evaluateProposal(sandboxWrite).route === "ALLOW_WITH_LOG", "fixture must remain in the bounded sandbox policy route");
  assert(requiredAuthenticationAssurance(sandboxWrite) === null, "assurance policy must not invent consent for a canonical bounded write");
}

assert(evaluateProposal(sensitiveRead).route === "REQUIRE_HUMAN_APPROVAL", "fixture must use the human approval route");
assert(requiredAuthenticationAssurance(sensitiveRead) === "MFA", "human approval needs at least MFA");
throwsWith(
  () => assertAuthenticationAssurance(sensitiveRead, "SINGLE_FACTOR"),
  "authentication_assurance_insufficient",
  "single-factor session must not satisfy an MFA consent route",
);
assertAuthenticationAssurance(sensitiveRead, "MFA");
assertAuthenticationAssurance(sensitiveRead, "PHISHING_RESISTANT_MFA");

for (const type of ["DELETE", "PAYMENT", "EXTERNAL_MESSAGE", "PRODUCTION_DEPLOY", "PERMISSION_CHANGE"] satisfies ActionType[]) {
  const proposal: ActionProposal = { ...publicRead, id: `assurance-${type.toLowerCase()}`, type };
  assert(requiredAuthenticationAssurance(proposal) === "PHISHING_RESISTANT_MFA", `${type} must require phishing-resistant MFA`);
  for (const assurance of ["SINGLE_FACTOR", "MFA"] satisfies AuthenticationAssurance[]) {
    throwsWith(
      () => assertAuthenticationAssurance(proposal, assurance),
      "authentication_assurance_insufficient",
      `${assurance} must not satisfy high-impact ${type}`,
    );
  }
  assertAuthenticationAssurance(proposal, "PHISHING_RESISTANT_MFA");
}

{
  const secretRead: ActionProposal = { ...publicRead, id: "assurance-secret-read", dataSensitivity: "SECRET", containsSecrets: true };
  assert(requiredAuthenticationAssurance(secretRead) === "PHISHING_RESISTANT_MFA", "secret-sensitive operation must require phishing-resistant MFA");
  throwsWith(
    () => assertAuthenticationAssurance(secretRead, "MFA"),
    "authentication_assurance_insufficient",
    "ordinary MFA must not satisfy a secret-sensitive approval route",
  );
  assertAuthenticationAssurance(secretRead, "PHISHING_RESISTANT_MFA");
}

throwsWith(
  () => assertAuthenticationAssurance(sensitiveRead, undefined),
  "authentication_assurance_required",
  "unknown assurance must not satisfy a human approval route",
);
throwsWith(
  () => assertAuthenticationAssurance(sensitiveRead, "UNVERIFIED_PUBLIC" as AuthenticationAssurance),
  "authentication_assurance_invalid",
  "unknown assurance vocabulary must fail closed",
);
throwsWith(
  () => assertAuthenticationAssurance(sensitiveRead, "__proto__" as AuthenticationAssurance),
  "authentication_assurance_invalid",
  "prototype property names are not valid assurance levels",
);

{
  const exfiltration: ActionProposal = { ...publicRead, id: "assurance-denied", scope: "EXTERNAL", dataSensitivity: "SECRET", containsSecrets: true };
  throwsWith(
    () => requiredAuthenticationAssurance(exfiltration),
    "sab_denied",
    "assurance policy must preserve the canonical hard-deny route",
  );
  throwsWith(
    () => assertAuthenticationAssurance(exfiltration, "PHISHING_RESISTANT_MFA"),
    "sab_denied",
    "strong authentication must never override SAB DENY",
  );
}

throwsWith(
  () => requiredAuthenticationAssurance({ ...publicRead, type: "FORGED_ACTION" } as unknown as ActionProposal),
  "sab_denied",
  "runtime malformed metadata must be rejected through canonical policy",
);

console.log("authentication assurance policy tests passed");
