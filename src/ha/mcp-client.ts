import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveToken } from "./http.js";

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
}

export class McpClientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "McpClientError";
  }
}

export class StreamableHttpMcpClient {
  private requestId = 0;
  private sessionId?: string;
  private initialized = false;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;

  public constructor(
    private readonly endpoint: string,
    options: { fetchImpl?: typeof fetch; token?: string } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token ?? resolveToken();
  }

  public async initialize(): Promise<Record<string, unknown>> {
    if (this.initialized) return {};
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi-home-agent", version: "0.1.0" },
    });
    this.initialized = true;
    await this.notification("notifications/initialized");
    return result;
  }

  public async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = await this.request("tools/list", {});
    return Array.isArray(result.tools) ? (result.tools as McpTool[]) : [];
  }

  public async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    await this.initialize();
    return this.request("tools/call", { name, arguments: arguments_ });
  }

  private async notification(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }, false);
  }

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = ++this.requestId;
    const response = await this.send({ jsonrpc: "2.0", id, method, params });
    if (response.error) {
      throw new McpClientError(response.error.message ?? `MCP request '${method}' failed.`);
    }
    return response.result ?? {};
  }

  private async send(payload: Record<string, unknown>, expectResponse = true): Promise<JsonRpcResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new McpClientError(`Could not reach HA-MCP: ${error instanceof Error ? error.message : String(error)}`);
    }

    const returnedSessionId = response.headers.get("Mcp-Session-Id");
    if (returnedSessionId) this.sessionId = returnedSessionId;
    const body = await response.text();
    if (!response.ok) {
      throw new McpClientError(`HA-MCP returned HTTP ${response.status}: ${body || response.statusText}`);
    }
    const parsed = this.parseResponse(body);
    if (!parsed) {
      if (!expectResponse) return {};
      throw new McpClientError("HA-MCP returned an empty protocol response.");
    }
    return parsed;
  }

  private parseResponse(body: string): JsonRpcResponse | undefined {
    try {
      return JSON.parse(body) as JsonRpcResponse;
    } catch {
      const messages = body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== "[DONE]")
        .map((line) => {
          try {
            return JSON.parse(line) as JsonRpcResponse;
          } catch {
            return undefined;
          }
        })
        .filter((value): value is JsonRpcResponse => value !== undefined);
      return messages.at(-1);
    }
  }
}

export interface CachedMcpCatalog {
  endpoint: string;
  fetchedAt: string;
  tools: McpTool[];
}

export class HaMcpBridge {
  private client?: StreamableHttpMcpClient;
  private cached?: CachedMcpCatalog;

  public constructor(
    private readonly cacheFile: string,
    private readonly endpoint?: string,
    private readonly clientFactory: (endpoint: string) => StreamableHttpMcpClient = (url) =>
      new StreamableHttpMcpClient(url),
  ) {}

  public get configured(): boolean {
    return Boolean(this.endpoint);
  }

  public async discover(force = false): Promise<McpTool[]> {
    if (!this.endpoint) return [];
    if (!force && this.cached?.endpoint === this.endpoint) return this.cached.tools;
    if (!force) {
      const disk = await this.readCache();
      if (disk?.endpoint === this.endpoint) {
        this.cached = disk;
        return disk.tools;
      }
    }
    this.client ??= this.clientFactory(this.endpoint);
    const tools = await this.client.listTools();
    this.cached = { endpoint: this.endpoint, fetchedAt: new Date().toISOString(), tools };
    await this.writeCache(this.cached);
    return tools;
  }

  public async call(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    if (!this.endpoint) throw new McpClientError("HA-MCP is not configured.");
    this.client ??= this.clientFactory(this.endpoint);
    return this.client.callTool(name, arguments_);
  }

  public async health(): Promise<{ status: "connected" | "unavailable"; detail: string; toolCount: number }> {
    if (!this.endpoint) return { status: "unavailable", detail: "No HA-MCP endpoint configured or detected.", toolCount: 0 };
    try {
      const tools = await this.discover();
      return { status: "connected", detail: `${tools.length} tools available through HA-MCP.`, toolCount: tools.length };
    } catch (error) {
      return {
        status: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
        toolCount: 0,
      };
    }
  }

  private async readCache(): Promise<CachedMcpCatalog | undefined> {
    try {
      return JSON.parse(await readFile(this.cacheFile, "utf8")) as CachedMcpCatalog;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return undefined;
      return undefined;
    }
  }

  private async writeCache(value: CachedMcpCatalog): Promise<void> {
    await mkdir(path.dirname(this.cacheFile), { recursive: true });
    await writeFile(this.cacheFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export function mcpSearch(tools: McpTool[], query: string, maxResults = 5): McpTool[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tools.slice(0, maxResults);
  return tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
      const score = terms.reduce((total, term) => {
        if (tool.name.toLowerCase().includes(term)) return total + 5;
        if (haystack.includes(term)) return total + 2;
        return total;
      }, 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, maxResults)
    .map((entry) => entry.tool);
}
