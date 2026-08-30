import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ModelRuntime,
  type ProviderConfig as PiProviderConfig,
} from "@earendil-works/pi-coding-agent";

import { JsonStore } from "../core/json-store.js";
import { SecretStore } from "../core/secrets.js";
import type {
  AppSettings,
  ProviderConfig,
  ProviderConfigWithSecret,
  ProviderKind,
  ProviderModelsResult,
  ProviderTestResult,
  StoredState,
} from "../core/types.js";
import type { RuntimePaths } from "../core/config.js";

const RUNTIME_PROVIDER_ID = "pi-home-agent";
const DEFAULT_MODEL = "local-model";

interface ProviderServiceOptions {
  paths: RuntimePaths;
  state: JsonStore<StoredState>;
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
}

export interface ProviderStatus {
  configured: boolean;
  provider?: ProviderConfig;
  keyConfigured: boolean;
}

export class ProviderService {
  private readonly fetchImpl: typeof fetch;
  private runtime?: ModelRuntime;
  private runtimeSignature?: string;

  public constructor(private readonly options: ProviderServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async getStatus(): Promise<ProviderStatus> {
    const state = await this.options.state.get();
    const provider = state.settings.provider;
    return {
      configured: provider !== undefined,
      provider,
      keyConfigured: provider?.kind === "local"
        ? true
        : Boolean(provider && await this.options.secrets.has("provider.apiKey")),
    };
  }

  public async save(config: ProviderConfigWithSecret): Promise<ProviderConfig> {
    const normalized = normalizeProvider(config);
    const existingSecret = config.apiKey === undefined
      ? await this.options.secrets.get("provider.apiKey")
      : undefined;
    const effectiveSecret = config.apiKey?.trim() || existingSecret;
    validateProvider(normalized, effectiveSecret);
    if (config.apiKey?.trim()) {
      await this.options.secrets.set("provider.apiKey", config.apiKey.trim());
    } else if (config.apiKey !== undefined) {
      await this.options.secrets.delete("provider.apiKey");
    }
    await this.options.state.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        provider: normalized,
      },
    }));
    this.runtime = undefined;
    this.runtimeSignature = undefined;
    return normalized;
  }

  public async clear(): Promise<void> {
    await this.options.secrets.delete("provider.apiKey");
    await this.options.state.update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        provider: undefined,
      },
    }));
    this.runtime = undefined;
    this.runtimeSignature = undefined;
  }

  public async test(config: ProviderConfigWithSecret): Promise<ProviderTestResult> {
    const normalized = normalizeProvider(config);
    const apiKey = config.apiKey === undefined
      ? await this.options.secrets.get("provider.apiKey")
      : config.apiKey;
    const checks: ProviderTestResult["checks"] = [];
    try {
      validateProvider(normalized, apiKey);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        provider: normalized.kind,
        model: normalized.model,
        checks: [
          { key: "api", label: "API reachable", ok: false, detail },
          { key: "model", label: "Model accepted", ok: false, detail: "Skipped until the provider configuration is valid." },
          { key: "streaming", label: "Streaming response", ok: false, detail: "Skipped until the provider configuration is valid." },
        ],
        ok: false,
      };
    }

    const endpoint = providerEndpoint(normalized);
    const headers = providerHeaders(normalized, apiKey);
    const body = providerBody(normalized);
    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      const apiOk = response.status !== 404 && response.status < 500;
      const modelOk = response.ok;
      const streamingOk = response.ok && text.trim().length > 0;
      const errorDetail = response.ok
        ? "The provider accepted the test request."
        : describeProviderError(response.status, text);
      checks.push({
        key: "api",
        label: "API reachable",
        ok: apiOk,
        detail: apiOk ? "The provider endpoint responded." : errorDetail,
      });
      checks.push({
        key: "model",
        label: "Model accepted",
        ok: modelOk,
        detail: modelOk ? `${normalized.model} was accepted.` : errorDetail,
      });
      checks.push({
        key: "streaming",
        label: "Streaming response",
        ok: streamingOk,
        detail: streamingOk ? "Received a non-empty streamed response." : response.ok ? "The provider returned an empty response." : errorDetail,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checks.push(
        { key: "api", label: "API reachable", ok: false, detail },
        { key: "model", label: "Model accepted", ok: false, detail: "No model request was completed." },
        { key: "streaming", label: "Streaming response", ok: false, detail: "No streaming response was received." },
      );
    }
    return {
      provider: normalized.kind,
      model: normalized.model,
      checks,
      ok: checks.every((check) => check.ok),
    };
  }

  public async listModels(config: ProviderConfigWithSecret): Promise<ProviderModelsResult> {
    const normalized = normalizeProvider(config);
    const apiKey = config.apiKey === undefined
      ? await this.options.secrets.get("provider.apiKey")
      : config.apiKey;
    validateProvider(normalized, apiKey);

    let response: Response;
    try {
      response = await this.fetchImpl(providerModelsEndpoint(normalized), {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...providerHeaders(normalized, apiKey),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }

    const body = await response.text();
    if (!response.ok) throw new Error(describeProviderError(response.status, body));
    return {
      provider: normalized.kind,
      models: parseProviderModels(body),
    };
  }

  public async createRuntime(): Promise<ModelRuntime> {
    const status = await this.getStatus();
    if (!status.provider) throw new Error("Configure an AI provider before starting a session.");
    const secret = await this.options.secrets.get("provider.apiKey");
    const config = status.provider;
    const signature = JSON.stringify({ ...config, keyConfigured: Boolean(secret) });
    if (this.runtime && this.runtimeSignature === signature) return this.runtime;

    // The provider key is exposed only to this server process through Pi's
    // standard environment interpolation. It is never sent to the browser or
    // written into the provider profile in state.json.
    process.env.PI_HOME_AGENT_API_KEY = secret ?? "local";
    const runtime = await ModelRuntime.create({
      authPath: path.join(this.options.paths.agentDir, "auth.json"),
      modelsPath: null,
      modelsStorePath: path.join(this.options.paths.agentDir, "models-cache.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    runtime.registerProvider(RUNTIME_PROVIDER_ID, providerRuntimeConfig(config));
    const model = runtime.getModel(RUNTIME_PROVIDER_ID, config.model);
    if (!model) throw new Error(`Pi could not register model '${config.model}'.`);
    this.runtime = runtime;
    this.runtimeSignature = signature;
    return runtime;
  }

  public async getModel(): Promise<ReturnType<ModelRuntime["getModel"]>> {
    const runtime = await this.createRuntime();
    const status = await this.getStatus();
    if (!status.provider) return undefined;
    return runtime.getModel(RUNTIME_PROVIDER_ID, status.provider.model);
  }

  public static get runtimeProviderId(): string {
    return RUNTIME_PROVIDER_ID;
  }
}

function normalizeProvider(config: ProviderConfigWithSecret): ProviderConfig {
  const defaults: Record<ProviderKind, string> = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com/v1",
    "openai-compatible": "http://localhost:11434/v1",
    local: "http://localhost:11434/v1",
  };
  return {
    kind: config.kind,
    model: config.model.trim() || DEFAULT_MODEL,
    baseUrl: (config.baseUrl?.trim() || defaults[config.kind]).replace(/\/$/, ""),
    displayName: config.displayName?.trim() || undefined,
    supportsReasoning: config.supportsReasoning ?? false,
    temperature: config.temperature,
  };
}

function validateProvider(config: ProviderConfig, apiKey: string | undefined): void {
  if (!config.model || config.model.length > 200) throw new Error("Choose a model name between 1 and 200 characters.");
  if (!/^https?:\/\//i.test(config.baseUrl ?? "")) throw new Error("The provider URL must start with http:// or https://.");
  if (config.kind !== "local" && config.kind !== "openai-compatible" && !apiKey?.trim()) {
    throw new Error("An API key is required for this provider.");
  }
}

function providerEndpoint(config: ProviderConfig): string {
  if (config.kind === "anthropic") return `${config.baseUrl?.replace(/\/$/, "")}/v1/messages`;
  return `${config.baseUrl?.replace(/\/$/, "")}/chat/completions`;
}

function providerModelsEndpoint(config: ProviderConfig): string {
  const baseUrl = config.baseUrl?.replace(/\/$/, "") ?? "";
  if (config.kind === "anthropic" && !baseUrl.endsWith("/v1")) return `${baseUrl}/v1/models`;
  return `${baseUrl}/models`;
}

function providerHeaders(config: ProviderConfig, apiKey: string | undefined): Record<string, string> {
  if (config.kind === "anthropic") {
    return {
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    };
  }
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function providerBody(config: ProviderConfig): Record<string, unknown> {
  if (config.kind === "anthropic") {
    return {
      model: config.model,
      max_tokens: 8,
      stream: true,
      messages: [{ role: "user", content: "Reply with OK." }],
    };
  }
  return {
    model: config.model,
    max_tokens: 8,
    stream: true,
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    messages: [{ role: "user", content: "Reply with OK." }],
  };
}

function describeProviderError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const value = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const error = value.error;
    detail = typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(value.message ?? detail);
  } catch {
    // Keep the text body when it is not JSON.
  }
  if (detail.length > 240) detail = `${detail.slice(0, 237)}...`;
  return `Provider request failed (${status})${detail ? `: ${detail}` : "."}`;
}

function parseProviderModels(body: string): ProviderModelsResult["models"] {
  if (!body.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("The provider returned invalid JSON from /models.");
  }

  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : isRecord(value) && Array.isArray(value.models)
        ? value.models
        : [];
  const models = new Map<string, ProviderModelsResult["models"][number]>();
  for (const entry of entries) {
    const model = normalizeModelOption(entry);
    if (model && !models.has(model.id)) models.set(model.id, model);
  }
  return [...models.values()];
}

function normalizeModelOption(value: unknown): ProviderModelsResult["models"][number] | undefined {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const idValue = typeof value.id === "string" ? value.id : typeof value.name === "string" ? value.name : undefined;
  const id = idValue?.trim();
  if (!id) return undefined;
  const nameValue = typeof value.name === "string"
    ? value.name
    : typeof value.display_name === "string"
      ? value.display_name
      : undefined;
  const name = nameValue?.trim();
  return name && name !== id ? { id, name } : { id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerRuntimeConfig(config: ProviderConfig): PiProviderConfig {
  const api = config.kind === "anthropic" ? "anthropic-messages" : "openai-completions";
  return {
    name: config.displayName ?? `Pi Home Agent (${config.kind})`,
    baseUrl: config.baseUrl,
    apiKey: "$PI_HOME_AGENT_API_KEY",
    api,
    models: [
      {
        id: config.model,
        name: config.model,
        api,
        reasoning: config.supportsReasoning ?? false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
        compat: config.kind === "local"
          ? { supportsDeveloperRole: false, supportsReasoningEffort: false }
          : undefined,
      },
    ],
  };
}

export function providerPublicConfig(settings: AppSettings): ProviderConfig | undefined {
  return settings.provider;
}

export async function readProviderProfile(filePath: string): Promise<ProviderConfig | undefined> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { settings?: { provider?: ProviderConfig } };
    return value.settings?.provider;
  } catch {
    return undefined;
  }
}
