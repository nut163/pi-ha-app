import { describe, expect, it, vi } from "vitest";

import { StreamableHttpMcpClient } from "../../src/ha/mcp-client.js";

describe("StreamableHttpMcpClient", () => {
  it("sends the Home Assistant bearer token during MCP initialization and discovery", async () => {
    const requests: RequestInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requests.push(init ?? {});
      const payload = JSON.parse(String(init?.body)) as { id?: number; method?: string };
      if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result: payload.method === "tools/list" ? { tools: [] } : {},
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const client = new StreamableHttpMcpClient("https://ha.example/api/mcp", { fetchImpl, token: "ha-secret" });
    await client.listTools();

    expect(requests).toHaveLength(3);
    expect(requests.every((request) => (request.headers as Record<string, string>).Authorization === "Bearer ha-secret")).toBe(true);
  });
});
