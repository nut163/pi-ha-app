import {
  AuthenticatedHttpClient,
  resolveSupervisorBaseUrl,
  resolveToken,
} from "./http.js";

export interface SupervisorInfo {
  supervisor?: string;
  homeassistant?: string;
  hassos?: string;
  operating_system?: string;
  arch?: string;
  machine?: string;
  state?: string;
  supported?: boolean;
  [key: string]: unknown;
}

export interface SupervisorAddon {
  name: string;
  slug: string;
  description?: string;
  installed?: string | boolean;
  state?: string | null;
  version?: string | null;
  version_latest?: string | null;
  update_available?: boolean;
  repository?: string;
  [key: string]: unknown;
}

export class SupervisorClient {
  public readonly http: AuthenticatedHttpClient;

  public constructor(
    http = new AuthenticatedHttpClient({
      baseUrl: resolveSupervisorBaseUrl(),
      token: resolveToken(),
    }),
  ) {
    this.http = http;
  }

  public async getInfo(): Promise<SupervisorInfo> {
    return this.http.json({ path: "/info" });
  }

  public async getAddons(): Promise<SupervisorAddon[]> {
    const value = await this.http.json<{ addons?: SupervisorAddon[] }>({ path: "/addons" });
    return value.addons ?? [];
  }

  public async getAddonInfo(slug: string): Promise<Record<string, unknown>> {
    return this.http.json({ path: `/addons/${encodeURIComponent(slug)}/info` });
  }

  public async getAddonLogs(slug: string, lines = 200): Promise<string> {
    return this.http.text({
      path: `/addons/${encodeURIComponent(slug)}/logs?lines=${Math.max(1, Math.min(lines, 20_000))}`,
      headers: { Accept: "text/plain" },
    });
  }

  public async getCoreLogs(lines = 200): Promise<string> {
    return this.http.text({
      path: `/core/logs?lines=${Math.max(1, Math.min(lines, 20_000))}`,
      headers: { Accept: "text/plain" },
    });
  }

  public async checkCore(): Promise<Record<string, unknown>> {
    return this.http.json({ method: "POST", path: "/core/check", body: {} });
  }

  public async restartCore(): Promise<Record<string, unknown>> {
    return this.http.json({ method: "POST", path: "/core/restart", body: {} });
  }

  public async getBackups(): Promise<Record<string, unknown>> {
    return this.http.json({ path: "/backups" });
  }

  public async createPartialBackup(options: {
    name: string;
    homeassistant?: boolean;
    addons?: string[];
    folders?: string[];
    compressed?: boolean;
    background?: boolean;
  }): Promise<Record<string, unknown>> {
    return this.http.json({ method: "POST", path: "/backups/new/partial", body: options });
  }

  public async appAction(
    slug: string,
    action: "start" | "stop" | "restart" | "update" | "uninstall",
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.http.json({
      method: "POST",
      path: `/addons/${encodeURIComponent(slug)}/${action}`,
      body,
    });
  }

  public async installApp(slug: string, background = true): Promise<Record<string, unknown>> {
    return this.http.json({
      method: "POST",
      path: `/store/addons/${encodeURIComponent(slug)}/install`,
      body: { background },
    });
  }

  public async getStoreApps(): Promise<SupervisorAddon[]> {
    const value = await this.http.json<unknown>({ path: "/store/addons" });
    return Array.isArray(value) ? (value as SupervisorAddon[]) : [];
  }

  public async getAppRepositories(): Promise<unknown[]> {
    const value = await this.http.json<unknown>({ path: "/store/repositories" });
    return Array.isArray(value) ? value : [];
  }
}
