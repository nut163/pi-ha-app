import type {
  AppBootstrap,
  AppSettings,
  ApprovalRequest,
  AuditEntry,
  CapabilityManifest,
  ConnectionStatus,
  HealthCheck,
  ProviderConfigWithSecret,
  ProviderModelsResult,
  ProviderTestResult,
  SessionRecord,
  SessionSummary,
  ToolDescriptor,
  ToolExecutionResult,
} from "../../src/core/types.js";

export interface BootstrapResponse extends AppBootstrap {}

export type StreamEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "activity"; event: import("../../src/core/types.js").ActivityEvent }
  | { type: "done"; message: string }
  | { type: "error"; error: string }
  | { type: "complete" };

function relativeUrl(url: string): string {
  return url.startsWith("/") ? `.${url}` : url;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(relativeUrl(url), {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body = await response.text();
  let value: unknown;
  try {
    value = body ? JSON.parse(body) : undefined;
  } catch {
    value = body;
  }
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value ? String(value.error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return value as T;
}

export const api = {
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  health: () => request<{ health: HealthCheck[] }>("/api/health"),
  capabilities: () => request<{ manifest: CapabilityManifest; tools: ToolDescriptor[] }>("/api/capabilities"),
  testHa: () => request<{ health: HealthCheck[]; manifest: CapabilityManifest }>("/api/onboarding/test-ha", { method: "POST", body: "{}" }),
  testProvider: (config: ProviderConfigWithSecret) => request<ProviderTestResult>("/api/onboarding/test-provider", { method: "POST", body: JSON.stringify(config) }),
  listModels: (config: ProviderConfigWithSecret) => request<ProviderModelsResult>("/api/provider/models", { method: "POST", body: JSON.stringify(config) }),
  saveProvider: (config: ProviderConfigWithSecret) => request<{ provider: Omit<ProviderConfigWithSecret, "apiKey">; status: { configured: boolean; keyConfigured: boolean } }>("/api/onboarding/provider", { method: "POST", body: JSON.stringify(config) }),
  completeOnboarding: () => request<{ setupCompleted: boolean }>("/api/onboarding/complete", { method: "POST", body: "{}" }),
  updateSettings: (patch: Partial<AppSettings>) => request<{ settings: AppSettings }>("/api/settings", { method: "POST", body: JSON.stringify(patch) }),
  updateConnections: (input: { homeAssistantUrl?: string; mcpUrl?: string; token?: string }) => request<{ connections: ConnectionStatus }>("/api/connections", { method: "POST", body: JSON.stringify(input) }),
  sessions: () => request<{ sessions: SessionSummary[] }>("/api/sessions"),
  createSession: (title?: string) => request<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: JSON.stringify({ title }) }),
  session: (id: string) => request<SessionRecord>(`/api/sessions/${encodeURIComponent(id)}`),
  approvals: () => request<{ approvals: ApprovalRequest[] }>("/api/approvals"),
  resolveApproval: (id: string, decision: "approved" | "rejected") => request<{ result: ToolExecutionResult }>(`/api/approvals/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ decision }) }),
  audit: (limit = 200) => request<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`),
  tools: (query = "") => request<{ tools: ToolDescriptor[] }>(`/api/tools${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  streamMessage: async (id: string, message: string, onEvent: (event: StreamEvent) => void): Promise<void> => {
    const response = await fetch(relativeUrl(`/api/sessions/${encodeURIComponent(id)}/messages`), {
      method: "POST",
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const value = await response.text();
      throw new Error(value || `Message failed (${response.status})`);
    }
    if (!response.body) throw new Error("The server did not provide a stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        try { onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent); } catch { /* ignore malformed heartbeat */ }
      }
    }
    if (buffer.trim()) {
      const line = buffer.split("\n").find((item) => item.startsWith("data:"));
      if (line) onEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
    }
  },
};
