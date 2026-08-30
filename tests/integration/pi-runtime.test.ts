import http from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AppContext } from "../../src/app-context.js";
import type { HomeAssistantUser } from "../../src/core/types.js";

describe("Pi runtime integration", () => {
  it("streams an assistant response through a persisted session", async () => {
    const provider = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end([
        'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
        'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello from the local model."},"finish_reason":null}]}',
        'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"));
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Provider did not bind.");
    const root = path.join(os.tmpdir(), `pi-runtime-${Date.now()}`);
    const context = await AppContext.create({ dataDir: path.join(root, "data"), configDir: path.join(root, "config") });
    const user: HomeAssistantUser = { id: "tester", name: "tester", displayName: "Tester", isAdmin: true };
    try {
      await context.providers.save({ kind: "local", model: "test-model", baseUrl: `http://127.0.0.1:${address.port}/v1` });
      const summary = await context.pi.createSession(user, "Integration session");
      const events: string[] = [];
      await context.pi.sendPrompt(summary.id, "Say hello", user, (event) => { if (event.type === "assistant_delta") events.push(event.delta); });
      const record = await context.pi.getSession(summary.id);
      expect(events.join("")).toContain("Hello from the local model.");
      expect(record?.messages.some((message) => message.content.includes("Hello from the local model."))).toBe(true);
      expect(record?.piSessionFile).toBeTruthy();
    } finally {
      await context.pi.closeAll();
      provider.close();
    }
  }, 30_000);
});
