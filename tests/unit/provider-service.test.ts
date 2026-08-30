import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";

import { getRuntimePaths } from "../../src/core/config.js";
import { JsonStore } from "../../src/core/json-store.js";
import { SecretStore } from "../../src/core/secrets.js";
import type { StoredState } from "../../src/core/types.js";
import { ProviderService } from "../../src/agent/provider-service.js";

describe("ProviderService", () => {
  it("tests streaming and never returns the provider key", async () => {
    const root = path.join(os.tmpdir(), `pi-provider-${Date.now()}`);
    const paths = getRuntimePaths({ dataDir: root, configDir: path.join(root, "config") });
    const state = new JsonStore<StoredState>(paths.stateFile, { setupCompleted: false, settings: { autonomy: "guided", defaultWorkspace: "/config", retainSessionDays: 90, automaticBackups: "meaningful", restrictedCapabilities: [], theme: "system" } });
    const secrets = new SecretStore(paths.secretKeyFile, paths.secretsFile);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\ndata: [DONE]\n\n", { status: 200 }));
    const service = new ProviderService({ paths, state, secrets, fetchImpl });
    const keyless = await service.test({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1" });
    expect(keyless.ok).toBe(true);
    const result = await service.test({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1", apiKey: "secret-value" });
    expect(result.ok).toBe(true);
    await service.save({ kind: "openai-compatible", model: "test-model", baseUrl: "http://localhost:1234/v1", apiKey: "secret-value" });
    expect(await service.getStatus()).toMatchObject({ configured: true, keyConfigured: true });
    const saved = await state.get();
    expect(saved.settings.provider).not.toHaveProperty("apiKey");
    expect(JSON.stringify(saved)).not.toContain("secret-value");
  });

  it("keeps an existing encrypted key when provider details are updated without a key field", async () => {
    const root = path.join(os.tmpdir(), `pi-provider-preserve-${Date.now()}`);
    const paths = getRuntimePaths({ dataDir: root, configDir: path.join(root, "config") });
    const state = new JsonStore<StoredState>(paths.stateFile, { setupCompleted: true, settings: { autonomy: "guided", defaultWorkspace: "/config", retainSessionDays: 90, automaticBackups: "meaningful", restrictedCapabilities: [], theme: "system" } });
    const secrets = new SecretStore(paths.secretKeyFile, paths.secretsFile);
    const service = new ProviderService({ paths, state, secrets });

    await service.save({ kind: "openai", model: "gpt-old", apiKey: "existing-secret" });
    await service.save({ kind: "openai", model: "gpt-new", baseUrl: "https://example.test/v1" });

    expect(await secrets.get("provider.apiKey")).toBe("existing-secret");
    expect((await service.getStatus()).provider).toMatchObject({ model: "gpt-new", baseUrl: "https://example.test/v1" });
  });

  it("lists model IDs from the provider models endpoint without returning secrets", async () => {
    const root = path.join(os.tmpdir(), `pi-provider-models-${Date.now()}`);
    const paths = getRuntimePaths({ dataDir: root, configDir: path.join(root, "config") });
    const state = new JsonStore<StoredState>(paths.stateFile, { setupCompleted: true, settings: { autonomy: "guided", defaultWorkspace: "/config", retainSessionDays: 90, automaticBackups: "meaningful", restrictedCapabilities: [], theme: "system" } });
    const secrets = new SecretStore(paths.secretKeyFile, paths.secretsFile);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe("http://gateway.test/v1/models");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-value");
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5", owned_by: "gateway" }, { id: "qwen2.5" }, { id: "" }] }), { status: 200 });
    });
    const service = new ProviderService({ paths, state, secrets, fetchImpl });

    const result = await service.listModels({ kind: "openai-compatible", model: "qwen2.5", baseUrl: "http://gateway.test/v1", apiKey: "secret-value" });

    expect(result).toEqual({ provider: "openai-compatible", models: [{ id: "qwen2.5" }] });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
