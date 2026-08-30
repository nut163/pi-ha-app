import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppContext } from "./app-context.js";
import type { ProviderConfigWithSecret } from "./core/types.js";

const port = Number(process.env.PORT ?? process.env.PI_HOME_AGENT_PORT ?? 8099);
const webRoot = path.resolve(process.env.PI_HOME_AGENT_WEB_DIR ?? "dist-web");
const MAX_BODY_BYTES = 1_000_000;

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

const app = await AppContext.create();

const server = http.createServer(async (request, response) => {
  try {
    if (!authorizedIngress(request)) {
      writeJson(response, 403, { error: "Pi Home Agent is available through Home Assistant Ingress only." });
      return;
    }
    if (!csrfSafe(request)) {
      writeJson(response, 403, { error: "The request origin is not allowed." });
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const user = app.userFromHeaders(request.headers);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url, user);
      return;
    }
    await serveWeb(url.pathname, response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) writeJson(response, 500, { error: detail });
    else response.end();
  }
});

server.on("error", (error) => {
  console.error("Pi Home Agent server error", error);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Pi Home Agent listening on ${port}`);
});

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  user: ReturnType<AppContext["userFromHeaders"]>,
): Promise<void> {
  const method = request.method ?? "GET";
  const pathName = url.pathname;

  if (method === "GET" && pathName === "/api/bootstrap") {
    writeJson(response, 200, await app.bootstrap(user));
    return;
  }
  if (method === "GET" && pathName === "/api/health") {
    const health = await app.capabilities.getHealthChecks();
    writeJson(response, 200, { status: health.some((item) => item.status === "connected") ? "ok" : "degraded", health });
    return;
  }
  if (method === "GET" && pathName === "/api/capabilities") {
    const [manifest, tools] = await Promise.all([
      app.capabilities.getCapabilityManifest(),
      app.dispatcher.getToolDescriptors(),
    ]);
    writeJson(response, 200, { manifest, tools });
    return;
  }
  if (method === "GET" && pathName === "/api/tools") {
    const query = url.searchParams.get("query") ?? "";
    const tools = query
      ? await app.capabilities.searchMcpTools(query, 10).catch(() => [])
      : app.dispatcher.getDirectDescriptors();
    writeJson(response, 200, { tools });
    return;
  }
  if (method === "GET" && pathName === "/api/audit") {
    writeJson(response, 200, { entries: await app.getAudit(Number(url.searchParams.get("limit") ?? 500)) });
    return;
  }
  if (method === "GET" && pathName === "/api/approvals") {
    writeJson(response, 200, { approvals: (await app.approvals.listPending()).map(publicApproval) });
    return;
  }
  if (method === "GET" && pathName === "/api/settings") {
    const state = await app.getState();
    writeJson(response, 200, {
      settings: state.settings,
      provider: await app.providers.getStatus(),
      connections: await app.getConnectionStatus(state),
    });
    return;
  }
  if (method === "POST" && pathName === "/api/settings") {
    const body = await readJsonBody(request);
    writeJson(response, 200, { settings: await app.updateSettings(normalizeSettingsPatch(body)) });
    return;
  }
  if (method === "POST" && pathName === "/api/connections") {
    const body = await readJsonBody(request);
    const update: import("./app-context.js").ConnectionUpdate = {};
    if (Object.prototype.hasOwnProperty.call(body, "homeAssistantUrl")) {
      update.homeAssistantUrl = typeof body.homeAssistantUrl === "string" ? body.homeAssistantUrl : "";
    }
    if (Object.prototype.hasOwnProperty.call(body, "mcpUrl")) {
      update.mcpUrl = typeof body.mcpUrl === "string" ? body.mcpUrl : "";
    }
    if (typeof body.token === "string" && body.token.trim()) update.token = body.token;
    writeJson(response, 200, { connections: await app.updateConnections(update) });
    return;
  }
  if (method === "POST" && pathName === "/api/onboarding/test-ha") {
    const [health, manifest] = await Promise.all([
      app.capabilities.getHealthChecks(),
      app.capabilities.getCapabilityManifest(),
    ]);
    writeJson(response, 200, { health, manifest });
    return;
  }
  if (method === "POST" && pathName === "/api/onboarding/test-provider") {
    const config = normalizeProviderBody(await readJsonBody(request));
    writeJson(response, 200, await app.providers.test(config));
    return;
  }
  if (method === "POST" && pathName === "/api/onboarding/provider") {
    const config = normalizeProviderBody(await readJsonBody(request));
    const provider = await app.providers.save(config);
    writeJson(response, 200, { provider, status: await app.providers.getStatus() });
    return;
  }
  if (method === "POST" && pathName === "/api/onboarding/complete") {
    await app.completeSetup();
    writeJson(response, 200, { setupCompleted: true });
    return;
  }
  if (method === "POST" && pathName === "/api/onboarding/reset") {
    if (!user.isAdmin) {
      writeJson(response, 403, { error: "Only a Home Assistant administrator can reset onboarding." });
      return;
    }
    await app.resetSetup();
    writeJson(response, 200, { setupCompleted: false });
    return;
  }

  if (method === "GET" && pathName === "/api/sessions") {
    writeJson(response, 200, { sessions: await app.pi.listSessions() });
    return;
  }
  if (method === "POST" && pathName === "/api/sessions") {
    const body = await readJsonBody(request);
    writeJson(response, 201, { session: await app.pi.createSession(user, typeof body.title === "string" ? body.title : undefined) });
    return;
  }

  const sessionMatch = pathName.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "GET") {
    const session = await app.pi.getSession(sessionMatch[1]);
    if (!session) {
      writeJson(response, 404, { error: "Session not found." });
      return;
    }
    writeJson(response, 200, session);
    return;
  }
  const messageMatch = pathName.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messageMatch && method === "POST") {
    await streamMessage(request, response, messageMatch[1], user);
    return;
  }

  const approvalMatch = pathName.match(/^\/api\/approvals\/([^/]+)$/);
  if (approvalMatch && method === "POST") {
    const body = await readJsonBody(request);
    const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : undefined;
    if (!decision) {
      writeJson(response, 400, { error: "decision must be approved or rejected." });
      return;
    }
    const result = await app.pi.resolveApproval(approvalMatch[1], decision, user);
    writeJson(response, 200, { result: publicToolResult(result) });
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

async function streamMessage(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string,
  user: ReturnType<AppContext["userFromHeaders"]>,
): Promise<void> {
  const body = await readJsonBody(request);
  if (typeof body.message !== "string" || !body.message.trim()) {
    writeJson(response, 400, { error: "message is required." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  let closed = false;
  request.on("close", () => { closed = true; });
  const send = (event: unknown) => {
    if (!closed) response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!closed) response.write(": heartbeat\n\n");
  }, 15_000);
  try {
    await app.pi.sendPrompt(sessionId, body.message, user, send);
    send({ type: "complete" });
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(heartbeat);
    if (!closed) response.end();
  }
}

async function serveWeb(requestedPath: string, response: ServerResponse): Promise<void> {
  const normalized = requestedPath === "/" ? "/index.html" : requestedPath;
  const candidate = path.resolve(webRoot, `.${normalized}`);
  if (!candidate.startsWith(`${webRoot}${path.sep}`)) {
    writeJson(response, 400, { error: "Invalid path." });
    return;
  }
  const file = await existingFile(candidate);
  const fallback = await existingFile(path.join(webRoot, "index.html"));
  if (!file && !fallback) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Pi Home Agent web assets are not built. Run npm run build:web.");
    return;
  }
  const target = file ?? fallback;
  if (!target) return;
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(target)] ?? "application/octet-stream",
    "Cache-Control": target.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(target).pipe(response);
}

async function existingFile(filePath: string): Promise<string | undefined> {
  try {
    const details = await stat(filePath);
    return details.isFile() ? filePath : undefined;
  } catch {
    return undefined;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object.");
  return value as Record<string, any>;
}

function normalizeProviderBody(body: Record<string, any>): ProviderConfigWithSecret {
  const kind = body.kind;
  if (kind !== "anthropic" && kind !== "openai" && kind !== "openai-compatible" && kind !== "local") {
    throw new Error("kind must be anthropic, openai, openai-compatible, or local.");
  }
  return {
    kind,
    model: typeof body.model === "string" ? body.model : "",
    baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    supportsReasoning: body.supportsReasoning === true,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
  };
}

function normalizeSettingsPatch(body: Record<string, any>) {
  const patch: Record<string, unknown> = {};
  if (body.autonomy === "guided" || body.autonomy === "balanced" || body.autonomy === "autonomous") patch.autonomy = body.autonomy;
  if (body.defaultWorkspace === "/config" || body.defaultWorkspace === "/config/www") patch.defaultWorkspace = body.defaultWorkspace;
  if (body.retainSessionDays === 0 || (typeof body.retainSessionDays === "number" && body.retainSessionDays >= 1 && body.retainSessionDays <= 3_650)) patch.retainSessionDays = Math.trunc(body.retainSessionDays);
  if (body.automaticBackups === "meaningful" || body.automaticBackups === "every-change" || body.automaticBackups === "never") patch.automaticBackups = body.automaticBackups;
  if (body.theme === "system" || body.theme === "light" || body.theme === "dark") patch.theme = body.theme;
  if (Array.isArray(body.restrictedCapabilities)) patch.restrictedCapabilities = body.restrictedCapabilities.filter((item): item is string => typeof item === "string").slice(0, 100);
  return patch;
}

function publicApproval(approval: import("./core/types.js").ApprovalRequest) {
  return {
    ...approval,
    arguments: redact(approval.arguments),
  };
}

function publicToolResult(result: import("./core/types.js").ToolExecutionResult) {
  if ("approvalRequired" in result) return {
    approvalRequired: true,
    approval: publicApproval(result.approval),
  };
  return { content: result.content, structured: redact(result.structured), diff: result.diff, activity: result.activity };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(api[_-]?key|token|secret|password|credential|authorization)/i.test(key)) output[key] = "[redacted]";
    else output[key] = redact(item);
  }
  return output;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function authorizedIngress(request: IncomingMessage): boolean {
  if (process.env.NODE_ENV !== "production" && process.env.PI_HOME_AGENT_INGRESS_ONLY !== "true") return true;
  const remote = request.socket.remoteAddress?.replace(/^::ffff:/, "");
  if (remote === "172.30.32.2") return true;
  return process.env.PI_HOME_AGENT_ALLOW_LOCAL === "true" && (remote === "127.0.0.1" || remote === "::1");
}

function csrfSafe(request: IncomingMessage): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
