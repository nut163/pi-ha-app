import { useEffect, useId, useState } from "react";

import type { ProviderConfigWithSecret, ProviderModelOption } from "../../../src/core/types.js";
import { api } from "../api";

interface ProviderModelFieldProps {
  provider: ProviderConfigWithSecret;
  apiKey?: string;
  onChange: (model: string) => void;
}

type DiscoveryStatus = "idle" | "loading" | "ready" | "empty" | "error";

function modelLabel(model: ProviderModelOption): string {
  return model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id;
}

export function ProviderModelField({ provider, apiKey, onChange }: ProviderModelFieldProps) {
  const [models, setModels] = useState<ProviderModelOption[]>([]);
  const [status, setStatus] = useState<DiscoveryStatus>("idle");
  const listId = `provider-models-${useId().replace(/:/g, "")}`;
  const normalizedApiKey = apiKey?.trim() ?? "";
  const baseUrl = provider.baseUrl?.trim() ?? "";

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setStatus(baseUrl ? "loading" : "idle");
    if (!baseUrl) return () => { cancelled = true; };

    const timer = window.setTimeout(() => {
      const requestConfig: ProviderConfigWithSecret = {
        ...provider,
        apiKey: normalizedApiKey || undefined,
      };
      void api.listModels(requestConfig)
        .then((result) => {
          if (cancelled) return;
          setModels(result.models);
          setStatus(result.models.length > 0 ? "ready" : "empty");
        })
        .catch(() => {
          if (cancelled) return;
          setModels([]);
          setStatus("error");
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [provider.kind, provider.baseUrl, normalizedApiKey]);

  const inputId = `${listId}-input`;
  const statusId = `${listId}-status`;
  const currentModelOption = provider.model && !models.some((model) => model.id === provider.model)
    ? [{ id: provider.model, name: "Current model" }]
    : [];
  const modelOptions = [...currentModelOption, ...models];
  const showModelSelect = status === "ready" && modelOptions.length > 0;

  return (
    <div className="model-field">
      <label htmlFor={inputId}>Model</label>
      {showModelSelect ? (
        <select
          id={inputId}
          value={provider.model}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={statusId}
        >
          {!provider.model && <option value="" disabled>Select a model…</option>}
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {modelLabel(model)}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={inputId}
          value={provider.model}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Model ID"
          autoComplete="off"
          aria-describedby={statusId}
        />
      )}
      <span className="label-note model-discovery-status" id={statusId}>
        {status === "loading" && "Loading available models…"}
        {status === "ready" && `${models.length} available model${models.length === 1 ? "" : "s"}`}
        {status === "empty" && "No models returned; enter a model ID manually."}
        {status === "error" && "Could not load models; enter a model ID manually."}
        {status === "idle" && "Enter a model ID or configure a provider URL."}
      </span>
    </div>
  );
}
