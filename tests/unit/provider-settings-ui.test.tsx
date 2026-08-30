// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppBootstrap, AppSettings } from "../../src/core/types.js";
import { Onboarding } from "../../web/src/components/Onboarding";
import { SettingsPanel } from "../../web/src/components/SettingsPanel";
import { api } from "../../web/src/api";

vi.mock("../../web/src/api", () => ({
  api: {
    testHa: vi.fn(),
    testProvider: vi.fn(),
    listModels: vi.fn(),
    saveProvider: vi.fn(),
    updateSettings: vi.fn(),
    updateConnections: vi.fn(),
    completeOnboarding: vi.fn(),
  },
}));

const settings: AppSettings = {
  autonomy: "guided",
  defaultWorkspace: "/config",
  retainSessionDays: 90,
  automaticBackups: "meaningful",
  restrictedCapabilities: [],
  theme: "system",
};

const bootstrap: AppBootstrap = {
  setupCompleted: false,
  settings,
  user: { id: null, name: null, displayName: null, isAdmin: true },
  capabilityManifest: {
    generatedAt: new Date().toISOString(),
    installation: "container",
    homeAssistantVersion: null,
    entityCount: null,
    automationCount: null,
    deviceCount: null,
    areaCount: null,
    capabilities: [],
  },
  health: [],
  connections: { tokenConfigured: false, mcpConfigured: false },
  sessions: [],
  pendingApprovals: [],
};

describe("provider configuration UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listModels).mockResolvedValue({ provider: "openai-compatible", models: [] });
  });
  afterEach(cleanup);

  it("loads provider models as model field suggestions", async () => {
    vi.mocked(api.listModels).mockResolvedValue({
      provider: "openai-compatible",
      models: [{ id: "qwen2.5", name: "Qwen 2.5" }],
    });

    const { container } = render(<SettingsPanel settings={settings} connections={{ tokenConfigured: false, mcpConfigured: false }} onSaved={vi.fn()} />);

    await waitFor(() => expect(api.listModels).toHaveBeenCalledWith(expect.objectContaining({
      kind: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
    })));
    await waitFor(() => expect(screen.getByLabelText("Model").tagName).toBe("SELECT"));
    await waitFor(() => expect(container.querySelector('select option[value="qwen2.5"]')).not.toBeNull());
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "qwen2.5" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("qwen2.5");
  });

  it("persists a provider after a successful onboarding connection test", async () => {
    vi.mocked(api.testProvider).mockResolvedValue({
      provider: "openai-compatible",
      model: "llama3.2",
      checks: [
        { key: "api", label: "API reachable", ok: true, detail: "Ready" },
        { key: "model", label: "Model accepted", ok: true, detail: "Ready" },
        { key: "streaming", label: "Streaming response", ok: true, detail: "Ready" },
      ],
      ok: true,
    });
    vi.mocked(api.saveProvider).mockResolvedValue({
      provider: { kind: "openai-compatible", model: "llama3.2", baseUrl: "http://localhost:11434/v1" },
      status: { configured: true, keyConfigured: false },
    });

    render(<Onboarding bootstrap={bootstrap} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Set up Pi Home Agent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with current status" }));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(api.saveProvider).toHaveBeenCalledWith(expect.objectContaining({
      kind: "openai-compatible",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
    })));
    expect(await screen.findByRole("heading", { name: "Pick your pace of autonomy." })).toBeTruthy();
  });

  it("configures every provider field directly from Settings", async () => {
    vi.mocked(api.updateConnections).mockResolvedValue({ connections: { tokenConfigured: false, mcpConfigured: false } });
    vi.mocked(api.updateSettings).mockResolvedValue({ settings });
    vi.mocked(api.saveProvider).mockResolvedValue({
      provider: { kind: "openai-compatible", model: "qwen", baseUrl: "http://gateway:4000/v1" },
      status: { configured: true, keyConfigured: true },
    });

    render(<SettingsPanel settings={settings} connections={{ tokenConfigured: false, mcpConfigured: false }} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Qwen gateway" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "qwen" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://gateway:4000/v1" } });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByLabelText("Model supports extended reasoning"));
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));

    await waitFor(() => expect(api.saveProvider).toHaveBeenCalledWith({
      kind: "openai-compatible",
      displayName: "Qwen gateway",
      model: "qwen",
      baseUrl: "http://gateway:4000/v1",
      supportsReasoning: true,
      apiKey: "new-secret",
    }));
  });
});
