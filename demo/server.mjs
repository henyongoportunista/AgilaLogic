import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAB_POLICY_VERSION,
  evaluateProposal,
  isExecutionAuthorized,
  proposalBinding,
  validateProposal,
} from "../dist/sab.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const staticRoot = resolve(__dirname);
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const audit = [];
const pending = new Map();
const MAX_BODY_BYTES = 64 * 1024;
const APPROVAL_WINDOW_MS = 5 * 60_000;
const MAX_PENDING = 100;
const STATIC_FILES = new Set(["/", "/index.html", "/app.js", "/styles.css"]);

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function assertApiRequestBoundary(req) {
  const contentType = String(req.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "application_json_required");
  }

  if (req.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "cross_site_request_blocked");
  }

  const origin = req.headers.origin;
  const requestHost = req.headers.host;
  if (typeof origin === "string" && typeof requestHost === "string") {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== requestHost) {
        throw new HttpError(403, "origin_mismatch");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(403, "invalid_origin");
    }
  }
}

async function readJson(req) {
  assertApiRequestBoundary(req);

  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "request_too_large");
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_BODY_BYTES) throw new HttpError(413, "request_too_large");
    chunks.push(bytes);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function record(type, detail) {
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    type,
    detail,
  };
  audit.unshift(entry);
  if (audit.length > 100) audit.length = 100;
  return entry;
}

function prunePending(now = Date.now()) {
  for (const [id, entry] of pending.entries()) {
    if (entry.expiresAtMs <= now) pending.delete(id);
  }

  while (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (!oldest) break;
    pending.delete(oldest);
  }
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    default: return "application/octet-stream";
  }
}

async function serveStatic(pathname, res) {
  if (!STATIC_FILES.has(pathname)) {
    res.writeHead(404, BASE_HEADERS);
    res.end("Not found");
    return;
  }

  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fullPath = resolve(staticRoot, requested);
  if (fullPath !== staticRoot && !fullPath.startsWith(`${staticRoot}${sep}`)) {
    res.writeHead(403, BASE_HEADERS);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(fullPath);
    res.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": contentType(fullPath),
      "content-length": data.length,
    });
    res.end(data);
  } catch {
    res.writeHead(404, BASE_HEADERS);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        service: "sovereign-assurance-boundary-demo",
        policyVersion: SAB_POLICY_VERSION,
        executionAdapterConnected: false,
        nodeAlphaIdentityVerified: false,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      json(res, 200, { entries: audit });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const body = await readJson(req);
      if (!body?.proposal || typeof body.proposal !== "object" || Array.isArray(body.proposal)) {
        throw new HttpError(400, "invalid_proposal");
      }

      // The server, not the browser, owns proposal identity for the approval lifecycle.
      const proposal = {
        ...body.proposal,
        id: crypto.randomUUID(),
      };

      const validationErrors = validateProposal(proposal);
      if (validationErrors.length > 0) {
        record("INVALID_PROPOSAL_BLOCKED", {
          policyVersion: SAB_POLICY_VERSION,
          reasons: validationErrors.slice(0, 4),
        });
        json(res, 400, { error: "invalid_proposal", reasons: validationErrors.slice(0, 4) });
        return;
      }

      const result = evaluateProposal(proposal);
      const entry = record("SAB_EVALUATION", {
        proposalId: proposal.id,
        actionType: proposal.type,
        route: result.route,
        consequence: result.consequence,
        reasons: result.reasons,
        policyVersion: result.policyVersion,
      });

      if (result.requiresApproval) {
        const expiresAtMs = Date.now() + APPROVAL_WINDOW_MS;
        pending.set(proposal.id, {
          proposal,
          binding: proposalBinding(proposal),
          policyVersion: result.policyVersion,
          expiresAtMs,
        });
        prunePending();
      }

      json(res, 200, {
        proposal,
        decision: result,
        approvalWindowSeconds: result.requiresApproval ? APPROVAL_WINDOW_MS / 1000 : 0,
        audit: entry,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/authorize") {
      const { proposalId } = await readJson(req);
      if (typeof proposalId !== "string" || proposalId.length === 0 || proposalId.length > 160) {
        throw new HttpError(400, "proposal_id_required");
      }

      prunePending();
      const pendingEntry = pending.get(proposalId);
      if (!pendingEntry) {
        json(res, 404, { error: "pending_proposal_not_found_or_expired" });
        return;
      }

      if (pendingEntry.policyVersion !== SAB_POLICY_VERSION) {
        pending.delete(proposalId);
        json(res, 409, { error: "policy_version_changed_re_evaluation_required" });
        return;
      }

      const issuedAt = new Date();
      const approval = {
        proposalId,
        proposalBinding: pendingEntry.binding,
        approved: true,
        approvedBy: "demo-operator-unverified",
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + APPROVAL_WINDOW_MS).toISOString(),
        policyVersion: SAB_POLICY_VERSION,
      };

      const authorized = isExecutionAuthorized(pendingEntry.proposal, approval, issuedAt);
      if (authorized) pending.delete(proposalId); // one-time demo authorization; blocks replay

      const entry = record(authorized ? "SANDBOX_AUTHORIZATION_GRANTED" : "EXECUTION_BLOCKED", {
        proposalId,
        actionType: pendingEntry.proposal.type,
        authorized,
        policyVersion: SAB_POLICY_VERSION,
        operatorIdentityVerified: false,
      });

      json(res, authorized ? 200 : 403, {
        authorized,
        status: authorized ? "AUTHORIZED_FOR_SANDBOX_DEMO_ONLY" : "BLOCKED",
        policyVersion: SAB_POLICY_VERSION,
        identityVerified: false,
        executionAdapterConnected: false,
        audit: entry,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reject") {
      const { proposalId } = await readJson(req);
      if (typeof proposalId !== "string" || proposalId.length === 0 || proposalId.length > 160) {
        throw new HttpError(400, "proposal_id_required");
      }

      prunePending();
      const pendingEntry = pending.get(proposalId);
      if (!pendingEntry) {
        json(res, 404, { error: "pending_proposal_not_found_or_expired" });
        return;
      }

      pending.delete(proposalId);
      const entry = record("HUMAN_VETO", {
        proposalId,
        actionType: pendingEntry.proposal.type,
        reason: "demo_operator_veto",
        policyVersion: SAB_POLICY_VERSION,
        operatorIdentityVerified: false,
      });
      json(res, 200, {
        rejected: true,
        policyVersion: SAB_POLICY_VERSION,
        identityVerified: false,
        audit: entry,
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.code });
      return;
    }

    console.error("demo_server_error", error);
    json(res, 500, { error: "internal_error" });
  }
});

// Bound request resources even for a local demo. Public deployment needs stronger rate limiting.
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.on("clientError", (_error, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  }
});

server.listen(port, host, () => {
  console.log(`Sovereign Scaffold demo: http://${host}:${port}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.warn("Demo server is listening beyond loopback. Do not connect a real execution adapter without authentication.");
  }
});
