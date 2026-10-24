import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProposal, isExecutionAuthorized } from "../dist/sab.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const audit = [];

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("request_too_large");
  }
  return raw ? JSON.parse(raw) : {};
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

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(__dirname, safePath);

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(fullPath);
    res.writeHead(200, { "content-type": contentType(fullPath) });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true, service: "sovereign-assurance-boundary-demo" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      json(res, 200, { entries: audit });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/evaluate") {
      const { proposal } = await readJson(req);
      if (!proposal?.id || !proposal?.type || !proposal?.scope || !proposal?.target) {
        json(res, 400, { error: "invalid_proposal" });
        return;
      }

      const decision = evaluateProposal(proposal);
      const entry = record("SAB_EVALUATION", {
        proposalId: proposal.id,
        type: proposal.type,
        target: proposal.target,
        route: decision.route,
        consequence: decision.consequence,
        reasons: decision.reasons,
      });

      json(res, 200, { proposal, decision, audit: entry });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/authorize") {
      const { proposal, decision, approval } = await readJson(req);
      if (!proposal || !decision) {
        json(res, 400, { error: "proposal_and_decision_required" });
        return;
      }

      const authorized = isExecutionAuthorized(proposal, decision, approval);
      const entry = record(authorized ? "EXECUTION_AUTHORIZED" : "EXECUTION_BLOCKED", {
        proposalId: proposal.id,
        actionType: proposal.type,
        target: proposal.target,
        authorized,
        approvedBy: approval?.approvedBy ?? null,
      });

      json(res, 200, {
        authorized,
        status: authorized ? "AUTHORIZED_FOR_SANDBOX_EXECUTION" : "BLOCKED",
        audit: entry,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reject") {
      const { proposal, reason = "human_veto" } = await readJson(req);
      if (!proposal?.id) {
        json(res, 400, { error: "proposal_required" });
        return;
      }
      const entry = record("HUMAN_VETO", { proposalId: proposal.id, reason });
      json(res, 200, { rejected: true, audit: entry });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    json(res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(`Sovereign Scaffold demo: http://localhost:${port}`);
});
