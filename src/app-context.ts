import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { IncomingHttpHeaders } from "node:http";

import { ActivityHub } from "./core/activity-hub.js";
import { ApprovalStore } from "./core/approvals.js";
import { AuditLog } from "./core/audit.js";
import { DEFAULT_STATE, getRuntimePaths, mergeState, type RuntimePaths } from "./core/config.js";
import { JsonStore, JsonlStore } from "./core/json-store.js";
import { RiskPolicy } from "./core/risk-policy.js";
import { SecretStore } from "./core/secrets.js";
import type {
  AppBootstrap,
  AppSettings,
  ApprovalRequest,
  ConnectionStatus,
  HealthCheck,
  HomeAssistantUser,
  StoredState,
} from "./core/types.js";
import { HomeAssistantCapabilityLayer } from "./ha/capability-layer.js";
import { PiAgentService } from "./agent/pi-runtime.js";
import { ProviderService } from "./agent/provider-service.js";
import { ToolDispatcher } from "./agent/tool-dispatcher.js";
import { ChangeTransactionRunner } from "./core/transaction.js";

export interface ConnectionUpdate {
  homeAssistantUrl?: string;
  mcpUrl?: string;
  token?: string;
}

export class AppContext {
  public readonly paths: RuntimePaths;
  public readonly stateStore: JsonStore<StoredState>;
  public readonly activity: ActivityHub;
  public readonly approvals: ApprovalStore;
  public readonly audit: AuditLog;
  public readonly capabilities: HomeAssistantCapabilityLayer;
  public readonly providers: ProviderService;
  public readonly dispatcher: ToolDispatcher;
  public readonly pi: PiAgentService;
  public readonly transaction: ChangeTransactionRunner;

  private constructor(paths: RuntimePaths, private readonly secrets: SecretStore) {
    this.paths = paths;
    this.stateStore = new JsonStore(paths.stateFile, DEFAULT_STATE);
    this.activity = new ActivityHub();
    this.approvals = new ApprovalStore(new JsonStore(paths.approvalsFile, []));
    this.audit = new AuditLog(new JsonlStore(paths.auditFile));
    this.capabilities = new HomeAssistantCapabilityLayer({
      configDir: paths.configDir,
      cacheFile: path.join(paths.dataDir, "ha-mcp-tools.json"),
    });
    this.providers = new ProviderService({
      paths,
      state: this.stateStore,
      secrets: this.secrets,
    });
    const riskPolicy = new RiskPolicy();
    this.transaction = new ChangeTransactionRunner({
      pathPolicy: this.capabilities.pathPolicy,
      riskPolicy,
      approvals: this.approvals,
      audit: this.audit,
      supervisor: this.capabilities.supervisor,
      checkpointsDir: paths.checkpointsDir,
      automaticBackups: DEFAULT_STATE.settings.automaticBackups,
      emit: (event) => { this.activity.emit(event); },
    });
    this.dispatcher = new ToolDispatcher(
      this.capabilities,
      this.transaction,
      this.approvals,
      this.audit,
      riskPolicy,
      this.activity,
      process.env.PI_HOME_AGENT_SKILLS_DIR ?? path.resolve("skills"),
    );
    this.pi = new PiAgentService(
      paths,
      this.stateStore,
      this.providers,
      this.dispatcher,
      this.activity,
      process.env.PI_HOME_AGENT_SKILLS_DIR ?? path.resolve("skills"),
    );
    this.activity.setObserver((event) => this.pi.persistActivity(event));
  }

  public static async create(overrides: Partial<RuntimePaths> = {}): Promise<AppContext> {
    const paths = getRuntimePaths(overrides);
    await Promise.all([
      mkdir(paths.dataDir, { recursive: true }),
      mkdir(paths.sessionsDir, { recursive: true }),
      mkdir(paths.checkpointsDir, { recursive: true }),
      mkdir(paths.agentDir, { recursive: true }),
      mkdir(paths.configDir, { recursive: true }),
    ]);
    const secrets = new SecretStore(paths.secretKeyFile, paths.secretsFile);
    const context = new AppContext(paths, secrets);
    const state = await context.getState();
    context.capabilities.configureConnections(
      state.settings.homeAssistantUrl,
      await secrets.get("haMcp.url"),
      await secrets.get("homeAssistant.token"),
    );
    context.transaction.setAutomaticBackups(state.settings.automaticBackups);
    return context;
  }

  public async getState(): Promise<StoredState> {
    return mergeState(await this.stateStore.get());
  }

  public async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const state = await this.stateStore.update((current) => {
      const merged = mergeState(current);
      const settings: AppSettings = {
        ...merged.settings,
        ...patch,
        homeAssistantUrl: patch.homeAssistantUrl ?? merged.settings.homeAssistantUrl,
        autonomy: patch.autonomy ?? merged.settings.autonomy,
        defaultWorkspace: patch.defaultWorkspace ?? merged.settings.defaultWorkspace,
        retainSessionDays: patch.retainSessionDays ?? merged.settings.retainSessionDays,
        automaticBackups: patch.automaticBackups ?? merged.settings.automaticBackups,
        restrictedCapabilities: patch.restrictedCapabilities ?? merged.settings.restrictedCapabilities,
        theme: patch.theme ?? merged.settings.theme,
        provider: patch.provider ?? merged.settings.provider,
      };
      return { ...merged, settings };
    });
    this.transaction.setAutomaticBackups(state.settings.automaticBackups);
    return state.settings;
  }

  public async updateConnections(input: ConnectionUpdate): Promise<ConnectionStatus> {
    const hasHomeAssistantUrl = Object.prototype.hasOwnProperty.call(input, "homeAssistantUrl");
    const hasMcpUrl = Object.prototype.hasOwnProperty.call(input, "mcpUrl");
    const homeAssistantUrl = hasHomeAssistantUrl
      ? normalizeEndpoint(input.homeAssistantUrl, "Home Assistant URL")
      : undefined;
    const mcpUrl = hasMcpUrl ? normalizeEndpoint(input.mcpUrl, "MCP endpoint") : undefined;

    if (input.token?.trim()) await this.secrets.set("homeAssistant.token", input.token.trim());
    if (hasMcpUrl) {
      if (mcpUrl) await this.secrets.set("haMcp.url", mcpUrl);
      else await this.secrets.delete("haMcp.url");
    }
    if (hasHomeAssistantUrl) {
      await this.stateStore.update((current) => ({
        ...mergeState(current),
        settings: { ...mergeState(current).settings, homeAssistantUrl },
      }));
    }

    const state = await this.getState();
    const [token, storedMcpUrl] = await Promise.all([
      this.secrets.get("homeAssistant.token"),
      this.secrets.get("haMcp.url"),
    ]);
    this.capabilities.configureConnections(state.settings.homeAssistantUrl, storedMcpUrl, token);
    return this.getConnectionStatus(state);
  }

  public async getConnectionStatus(state?: StoredState): Promise<ConnectionStatus> {
    const current = state ?? await this.getState();
    const [storedToken, storedMcpUrl] = await Promise.all([
      this.secrets.has("homeAssistant.token"),
      this.secrets.has("haMcp.url"),
    ]);
    return {
      homeAssistantUrl: current.settings.homeAssistantUrl ?? process.env.HOMEASSISTANT_URL,
      tokenConfigured: storedToken || Boolean(process.env.HOMEASSISTANT_TOKEN || process.env.SUPERVISOR_TOKEN),
      mcpConfigured: storedMcpUrl || Boolean(process.env.HA_MCP_URL),
    };
  }

  public async completeSetup(): Promise<void> {
    await this.stateStore.update((current) => ({ ...mergeState(current), setupCompleted: true }));
  }

  public async resetSetup(): Promise<void> {
    await this.stateStore.update((current) => ({ ...mergeState(current), setupCompleted: false }));
  }

  public async bootstrap(user: HomeAssistantUser): Promise<AppBootstrap> {
    const state = await this.getState();
    const [manifest, health, sessions, pendingApprovals, providerStatus, connections] = await Promise.all([
      this.capabilities.getCapabilityManifest(),
      this.capabilities.getHealthChecks(),
      this.pi.listSessions(),
      this.approvals.listPending(),
      this.providers.getStatus(),
      this.getConnectionStatus(state),
    ]);
    const agentHealth: HealthCheck = {
      key: "provider",
      label: "AI provider",
      status: providerStatus.configured && providerStatus.keyConfigured ? "connected" : "unavailable",
      detail: providerStatus.configured
        ? providerStatus.keyConfigured ? `Provider ${state.settings.provider?.model ?? "configured"} is ready.` : "Provider is saved but its API key is missing."
        : "No AI provider configured yet.",
      checkedAt: new Date().toISOString(),
    };
    return {
      setupCompleted: state.setupCompleted,
      settings: state.settings,
      user,
      capabilityManifest: manifest,
      health: [agentHealth, ...health],
      connections,
      sessions,
      pendingApprovals: pendingApprovals.map(publicApproval),
    };
  }

  public async getAudit(limit = 500) {
    return this.audit.list(Math.max(1, Math.min(limit, 1_000)));
  }

  public userFromHeaders(headers: IncomingHttpHeaders): HomeAssistantUser {
    const id = headerValue(headers, "x-remote-user-id");
    const name = headerValue(headers, "x-remote-user-name");
    const displayName = headerValue(headers, "x-remote-user-display-name") || name;
    const explicitAdmin = headerValue(headers, "x-remote-user-is-admin");
    const isAdmin = explicitAdmin === "1" || explicitAdmin?.toLowerCase() === "true" || (!id && process.env.NODE_ENV !== "production");
    return { id: id || null, name: name || null, displayName: displayName || null, isAdmin };
  }
}

function normalizeEndpoint(value: string | undefined, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid http:// or https:// URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://.`);
  }
  return normalized.replace(/\/$/, "");
}

function publicApproval(approval: ApprovalRequest): ApprovalRequest {
  return {
    ...approval,
    arguments: redact(approval.arguments) as Record<string, unknown>,
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /(api[_-]?key|token|secret|password|credential|authorization)/i.test(key)
      ? "[redacted]"
      : redact(item);
  }
  return output;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
