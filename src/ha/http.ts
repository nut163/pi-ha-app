export interface HttpRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class HaHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "HaHttpError";
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class AuthenticatedHttpClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    const configuredTimeout = Number(process.env.HA_REQUEST_TIMEOUT_MS ?? 3_000);
    this.timeoutMs = options.timeoutMs ?? (Number.isFinite(configuredTimeout) ? Math.max(500, configuredTimeout) : 3_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async json<T>(options: HttpRequestOptions): Promise<T> {
    const response = await this.raw(options);
    const text = await response.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HaHttpError("Home Assistant returned a non-JSON response.", response.status, text);
    }
  }

  public async text(options: HttpRequestOptions): Promise<string> {
    return (await this.raw(options)).text();
  }

  private async raw(options: HttpRequestOptions): Promise<Response> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers ?? {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: options.signal ?? controller.signal,
        });
      } catch (error) {
        if (error instanceof HaHttpError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new HaHttpError(`Could not reach Home Assistant: ${message}`);
      }
      if (!response.ok) {
        let body: unknown;
        const text = await response.text();
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = text;
        }
        const detail =
          body && typeof body === "object" && "message" in body
            ? String(body.message)
            : text || response.statusText;
        throw new HaHttpError(`Home Assistant request failed (${response.status}): ${detail}`, response.status, body);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function resolveToken(): string | undefined {
  return process.env.SUPERVISOR_TOKEN || process.env.HOMEASSISTANT_TOKEN || undefined;
}

export function resolveCoreBaseUrl(configured = process.env.HOMEASSISTANT_URL): string {
  if (!configured) return "http://supervisor/core/api";
  const base = configured.replace(/\/$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function resolveSupervisorBaseUrl(configured = process.env.SUPERVISOR_URL): string {
  return (configured || "http://supervisor").replace(/\/$/, "");
}
