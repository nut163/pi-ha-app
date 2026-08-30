import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { ConfigPathPolicy } from "../core/path-policy.js";
import type { CapabilityManifest, HealthCheck, ToolDescriptor } from "../core/types.js";
import { HaMcpBridge, type McpTool } from "./mcp-client.js";
import { HomeAssistantCoreClient, type EntityState } from "./core-client.js";
import { AuthenticatedHttpClient, resolveCoreBaseUrl, resolveSupervisorBaseUrl, resolveToken } from "./http.js";
import { SupervisorClient, type SupervisorAddon, type SupervisorInfo } from "./supervisor-client.js";

export interface CapabilityLayerOptions {
  configDir: string;
  cacheFile: string;
  core?: HomeAssistantCoreClient;
  supervisor?: SupervisorClient;
  pathPolicy?: ConfigPathPolicy;
  mcp?: HaMcpBridge;
}

export const DIRECT_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  { name: "ha_get_overview", title: "Get Home Assistant overview", description: "Read Home Assistant version, entity counts, and capability status.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_get_state", title: "Get an entity state", description: "Read the current state and attributes for one Home Assistant entity.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_get_services", title: "List Home Assistant services", description: "Read the service registry exposed by Home Assistant.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_render_template", title: "Render a Home Assistant template", description: "Evaluate a template through Home Assistant without changing state.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_list_entities", title: "List entities", description: "Find Home Assistant entities by domain, state, or name.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_list_unavailable", title: "List unavailable entities", description: "Find entities that are unavailable or unknown and summarize their integration context.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_get_logs", title: "Read Home Assistant logs", description: "Read recent Home Assistant or App logs for troubleshooting.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_read_file", title: "Read configuration file", description: "Read an approved file under the Home Assistant configuration directory.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_list_files", title: "List configuration files", description: "List files in an approved Home Assistant configuration area.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_search_tools", title: "Search Home Assistant tools", description: "Search the lazy Home Assistant MCP tool catalog without loading every schema.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_get_skill_guide", title: "Load a Home Assistant skill guide", description: "Load domain-specific workflow guidance on demand.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_get_health", title: "Get agent health", description: "Inspect Pi runtime, provider, Home Assistant, Supervisor, filesystem, backup, and MCP health.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_list_apps", title: "List Home Assistant Apps", description: "List installed and available Home Assistant Apps through Supervisor.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_list_backups", title: "List Home Assistant backups", description: "List available Supervisor backups.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_call_service", title: "Call a Home Assistant service", description: "Call a Home Assistant service after deterministic risk and approval checks.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_write_file", title: "Write configuration file", description: "Make a scoped, checkpointed file change and validate it before success.", risk: "LOW", source: "direct", readOnly: false },
  { name: "ha_apply_patch", title: "Apply a configuration patch", description: "Apply a narrow unified diff to an approved configuration file.", risk: "LOW", source: "direct", readOnly: false },
  { name: "ha_create_automation", title: "Create an automation", description: "Create a validated YAML automation in automations.yaml.", risk: "LOW", source: "direct", readOnly: false },
  { name: "ha_reload_automations", title: "Reload automations", description: "Reload Home Assistant automations after a validated change.", risk: "LOW", source: "direct", readOnly: false },
  { name: "ha_restart_core", title: "Restart Home Assistant Core", description: "Validate configuration, request a Core restart, and reconnect safely.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_create_backup", title: "Create a checkpoint backup", description: "Create a Supervisor partial backup before a meaningful change.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_app_logs", title: "Read App logs", description: "Read logs for an installed Home Assistant App.", risk: "READ", source: "direct", readOnly: true },
  { name: "ha_start_app", title: "Start an App", description: "Start an installed Home Assistant App.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_stop_app", title: "Stop an App", description: "Stop an installed Home Assistant App.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_restart_app", title: "Restart an App", description: "Restart an installed Home Assistant App.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_update_app", title: "Update an App", description: "Update an installed Home Assistant App, optionally creating a checkpoint.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_install_app", title: "Install an App", description: "Install a Home Assistant App from the Supervisor store.", risk: "MEDIUM", source: "direct", readOnly: false },
  { name: "ha_call_tool", title: "Call a discovered Home Assistant tool", description: "Call one tool returned by HA-MCP discovery after its risk and approval checks.", risk: "MEDIUM", source: "direct", readOnly: false },
];

export class HomeAssistantCapabilityLayer {
  public core: HomeAssistantCoreClient;
  public supervisor: SupervisorClient;
  public readonly pathPolicy: ConfigPathPolicy;
  private mcp?: HaMcpBridge;
  private mcpEndpointChecked = false;

  public constructor(private readonly options: CapabilityLayerOptions) {
    this.core = options.core ?? new HomeAssistantCoreClient();
    this.supervisor = options.supervisor ?? new SupervisorClient();
    this.pathPolicy = options.pathPolicy ?? new ConfigPathPolicy(options.configDir);
    this.mcp = options.mcp;
  }

  public configureConnections(homeAssistantUrl?: string, mcpUrl?: string, token?: string): void {
    if (homeAssistantUrl !== undefined) {
      const normalized = homeAssistantUrl.trim();
      if (normalized) process.env.HOMEASSISTANT_URL = normalized;
      else delete process.env.HOMEASSISTANT_URL;
    }
    if (token?.trim()) process.env.HOMEASSISTANT_TOKEN = token.trim();
    const effectiveToken = token?.trim() || resolveToken();
    this.core = new HomeAssistantCoreClient(new AuthenticatedHttpClient({
      baseUrl: resolveCoreBaseUrl(),
      token: effectiveToken,
    }));
    this.supervisor = new SupervisorClient(new AuthenticatedHttpClient({
      baseUrl: resolveSupervisorBaseUrl(),
      token: effectiveToken,
    }));
    this.mcp = mcpUrl === undefined ? undefined : mcpUrl.trim() ? new HaMcpBridge(this.options.cacheFile, mcpUrl.trim()) : undefined;
    this.mcpEndpointChecked = mcpUrl !== undefined;
  }

  public async getHealthChecks(): Promise<HealthCheck[]> {
    const checks = await Promise.all([
      this.check("core", "Home Assistant Core", async () => {
        const config = await this.core.getConfig();
        return `Connected to Home Assistant ${String(config.version ?? "(version unavailable)")}.`;
      }),
      this.check("supervisor", "Supervisor", async () => {
        const info = await this.supervisor.getInfo();
        return `Supervisor ${String(info.supervisor ?? "connected")} is ${String(info.state ?? "available")}.`;
      }),
      this.check("entities", "Entity access", async () => `${(await this.core.getStates()).length} entities are visible.`),
      this.check("filesystem", "Configuration filesystem", async () => {
        await access(this.options.configDir);
        await access(this.options.configDir, 2);
        return `${this.options.configDir} is readable and writable.`;
      }),
      this.check("apps", "Home Assistant Apps", async () => `${(await this.supervisor.getAddons()).length} Apps are visible.`),
      this.check("backups", "Backup API", async () => {
        await this.supervisor.getBackups();
        return "Supervisor backup API is available.";
      }),
      this.check("hacs", "HACS", async () => {
        const hacsPath = this.pathPolicy.resolve("custom_components/hacs/manifest.json");
        const manifest = JSON.parse(await readFile(hacsPath, "utf8")) as { version?: string };
        return `HACS ${String(manifest.version ?? "installed")} is detected.`;
      }),
      this.check("ha-mcp", "HA-MCP", async () => {
        const bridge = await this.getMcpBridge();
        const result = await bridge.health();
        if (result.status !== "connected") throw new Error(result.detail);
        return result.detail;
      }),
    ]);
    return checks;
  }

  public async getCapabilityManifest(): Promise<CapabilityManifest> {
    const [health, config, states, addons, supervisorInfo] = await Promise.all([
      this.getHealthChecks(),
      this.safe(() => this.core.getConfig(), {}),
      this.safe(() => this.core.getStates(), []),
      this.safe(() => this.supervisor.getAddons(), []),
      this.safe(() => this.supervisor.getInfo(), {}),
    ]);
    const installation = this.detectInstallation(supervisorInfo);
    return {
      generatedAt: new Date().toISOString(),
      installation,
      homeAssistantVersion: typeof config.version === "string" ? config.version : null,
      entityCount: states.length,
      automationCount: states.filter((state) => state.entity_id.startsWith("automation.")).length,
      deviceCount: null,
      areaCount: null,
      capabilities: health.map((item) => item.key === "apps" && addons.length === 0
        ? { ...item, detail: "Supervisor is reachable; no Apps are currently visible." }
        : item),
    };
  }

  public async getOverview(): Promise<Record<string, unknown>> {
    const [manifest, states, config] = await Promise.all([
      this.getCapabilityManifest(),
      this.core.getStates(),
      this.safe(() => this.core.getConfig(), {}),
    ]);
    return {
      version: config.version ?? null,
      location: config.location_name ?? null,
      entityCount: states.length,
      unavailableCount: states.filter((state) => state.state === "unavailable" || state.state === "unknown").length,
      automationCount: manifest.automationCount,
      capabilities: manifest.capabilities,
    };
  }

  public async listEntities(query = ""): Promise<EntityState[]> {
    const states = await this.core.getStates();
    const needle = query.trim().toLowerCase();
    if (!needle) return states;
    return states.filter((state) => {
      const attrs = Object.values(state.attributes ?? {}).join(" ");
      return `${state.entity_id} ${attrs}`.toLowerCase().includes(needle);
    });
  }

  public async listUnavailable(): Promise<EntityState[]> {
    return (await this.core.getStates()).filter((state) => state.state === "unavailable" || state.state === "unknown");
  }

  public async readFile(relativePath: string): Promise<string> {
    const target = this.pathPolicy.resolve(relativePath);
    await this.pathPolicy.assertNoSymlinkEscape(target);
    return readFile(target, "utf8");
  }

  public async listFiles(relativePath = "", recursive = false): Promise<string[]> {
    const targetPath = relativePath ? this.pathPolicy.resolve(relativePath) : this.options.configDir;
    if (!relativePath) await access(targetPath);
    await this.pathPolicy.assertNoSymlinkEscape(targetPath);
    const results: string[] = [];
    await this.walkFiles(targetPath, recursive, results);
    return results.slice(0, 500).map((item) => this.pathPolicy.relative(item));
  }

  public async logs(target: string, lines = 200): Promise<string> {
    if (target && target !== "core") return this.supervisor.getAddonLogs(target, lines);
    try {
      return await this.supervisor.getCoreLogs(lines);
    } catch {
      return this.core.getErrorLog();
    }
  }

  public async listApps(): Promise<SupervisorAddon[]> {
    return this.supervisor.getAddons();
  }

  public async listBackups(): Promise<Record<string, unknown>> {
    return this.supervisor.getBackups();
  }

  public async callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown> {
    return this.core.callService(domain, service, data);
  }

  public async checkConfig(): Promise<Record<string, unknown>> {
    try {
      return await this.supervisor.checkCore();
    } catch {
      return this.core.checkConfig();
    }
  }

  public async restartCore(): Promise<Record<string, unknown>> {
    return this.supervisor.restartCore();
  }

  public async createBackup(name: string): Promise<Record<string, unknown>> {
    return this.supervisor.createPartialBackup({ name, homeassistant: true, background: true });
  }

  public async appAction(
    slug: string,
    action: "start" | "stop" | "restart" | "update" | "uninstall",
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.supervisor.appAction(slug, action, body);
  }

  public async installApp(slug: string): Promise<Record<string, unknown>> {
    return this.supervisor.installApp(slug, true);
  }

  public async searchMcpTools(query: string, maxResults = 5): Promise<ToolDescriptor[]> {
    const bridge = await this.getMcpBridge();
    const tools = await bridge.discover();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return tools
      .map((tool) => ({ tool, score: this.scoreMcpTool(tool, terms) }))
      .filter((entry) => entry.score > 0 || terms.length === 0)
      .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
      .slice(0, Math.max(1, Math.min(maxResults, 10)))
      .map(({ tool }) => this.mcpDescriptor(tool));
  }

  public async callMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return (await this.getMcpBridge()).call(name, args);
  }

  public async getMcpHealth(): Promise<{ status: "connected" | "unavailable"; detail: string; toolCount: number }> {
    return (await this.getMcpBridge()).health();
  }

  public async directTools(): Promise<ToolDescriptor[]> {
    const bridge = await this.getMcpBridge();
    const mcpTools = this.mcp?.configured ? await bridge.discover().catch(() => []) : [];
    return [...DIRECT_TOOL_DESCRIPTORS, ...mcpTools.map((tool) => this.mcpDescriptor(tool))];
  }

  private async getMcpBridge(): Promise<HaMcpBridge> {
    if (this.mcp) return this.mcp;
    if (!this.mcpEndpointChecked) {
      this.mcpEndpointChecked = true;
      const endpoint = process.env.HA_MCP_URL || await this.detectMcpEndpoint();
      this.mcp = new HaMcpBridge(this.options.cacheFile, endpoint);
    }
    return this.mcp ?? new HaMcpBridge(this.options.cacheFile);
  }

  private async detectMcpEndpoint(): Promise<string | undefined> {
    try {
      const addons = await this.supervisor.getAddons();
      const addon = addons.find((item) => item.slug === "ha_mcp" || item.slug.endsWith("_ha_mcp") || item.name.toLowerCase().includes("mcp"));
      if (!addon) return undefined;
      const info = await this.supervisor.getAddonInfo(addon.slug);
      const ip = typeof info.ip_address === "string" ? info.ip_address : addon.slug.replaceAll("_", "-");
      const options = info.options;
      const secretPath = options && typeof options === "object" && "secret_path" in options && typeof options.secret_path === "string"
        ? options.secret_path
        : undefined;
      if (!secretPath) return undefined;
      return `http://${ip}:9583${secretPath.startsWith("/") ? secretPath : `/${secretPath}`}`;
    } catch {
      return undefined;
    }
  }

  private async walkFiles(directory: string, recursive: boolean, results: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && recursive) {
        await this.walkFiles(fullPath, recursive, results);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
      if (results.length >= 500) return;
    }
  }

  private async check(key: string, label: string, action: () => Promise<string>): Promise<HealthCheck> {
    try {
      return { key, label, status: "connected", detail: await action(), checkedAt: new Date().toISOString() };
    } catch (error) {
      return { key, label, status: "unavailable", detail: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() };
    }
  }

  private async safe<T>(action: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await action();
    } catch {
      return fallback;
    }
  }

  private detectInstallation(info: SupervisorInfo): CapabilityManifest["installation"] {
    const os = String(info.operating_system ?? "").toLowerCase();
    if (os.includes("home assistant os")) return "home-assistant-os";
    if (info.supervisor) return "supervised";
    if (process.env.SUPERVISOR_TOKEN) return "supervised";
    if (process.env.HOMEASSISTANT_URL) return "container";
    return "unknown";
  }

  private scoreMcpTool(tool: McpTool, terms: string[]): number {
    if (terms.length === 0) return 1;
    const name = tool.name.toLowerCase();
    const text = `${name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
    return terms.reduce((score, term) => score + (name.includes(term) ? 5 : text.includes(term) ? 2 : 0), 0);
  }

  private mcpDescriptor(tool: McpTool): ToolDescriptor {
    const destructive = tool.annotations?.destructiveHint === true;
    const readOnly = tool.annotations?.readOnlyHint === true;
    return {
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description ?? "Home Assistant MCP operation.",
      risk: destructive ? "HIGH" : readOnly ? "READ" : "MEDIUM",
      source: "ha-mcp",
      readOnly,
    };
  }
}
