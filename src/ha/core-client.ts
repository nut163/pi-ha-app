import { AuthenticatedHttpClient, resolveCoreBaseUrl, resolveToken } from "./http.js";

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  context?: Record<string, unknown>;
}

export interface HomeAssistantConfig {
  version?: string;
  location_name?: string;
  time_zone?: string;
  components?: string[];
  config_dir?: string;
  [key: string]: unknown;
}

export class HomeAssistantCoreClient {
  public readonly http: AuthenticatedHttpClient;

  public constructor(
    http = new AuthenticatedHttpClient({
      baseUrl: resolveCoreBaseUrl(),
      token: resolveToken(),
    }),
  ) {
    this.http = http;
  }

  public async getApiStatus(): Promise<Record<string, unknown>> {
    return this.http.json({ path: "/" });
  }

  public async getConfig(): Promise<HomeAssistantConfig> {
    return this.http.json({ path: "/config" });
  }

  public async getStates(): Promise<EntityState[]> {
    const value = await this.http.json<unknown>({ path: "/states" });
    return Array.isArray(value) ? (value as EntityState[]) : [];
  }

  public async getState(entityId: string): Promise<EntityState> {
    return this.http.json({ path: `/states/${encodeURIComponent(entityId)}` });
  }

  public async getServices(): Promise<Record<string, unknown>> {
    return this.http.json({ path: "/services" });
  }

  public async callService(
    domain: string,
    service: string,
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.http.json({
      method: "POST",
      path: `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      body: data,
    });
  }

  public async renderTemplate(template: string): Promise<string> {
    const value = await this.http.json<{ result?: unknown }>({
      method: "POST",
      path: "/template",
      body: { template },
    });
    return String(value.result ?? "");
  }

  public async checkConfig(): Promise<Record<string, unknown>> {
    return this.http.json({
      method: "POST",
      path: "/config/core/check_config",
      body: {},
    });
  }

  public async getErrorLog(): Promise<string> {
    return this.http.text({ path: "/error_log", headers: { Accept: "text/plain" } });
  }
}
