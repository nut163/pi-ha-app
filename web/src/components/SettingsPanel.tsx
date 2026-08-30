import { useEffect, useState } from "react";

import type { AppSettings, ConnectionStatus, ProviderConfigWithSecret } from "../../../src/core/types.js";
import { api } from "../api";

interface ConnectionDraft {
  homeAssistantUrl: string;
  mcpUrl: string;
  token: string;
}

export function SettingsPanel({
  settings,
  connections,
  onSaved,
}: {
  settings: AppSettings;
  connections: ConnectionStatus;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>({
    homeAssistantUrl: connections.homeAssistantUrl ?? "",
    mcpUrl: "",
    token: "",
  });
  const [providerKey, setProviderKey] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    setConnectionDraft((current) => ({
      ...current,
      homeAssistantUrl: connections.homeAssistantUrl ?? "",
    }));
  }, [connections.homeAssistantUrl]);

  const save = async () => {
    setBusy(true);
    setStatusMessage("");
    try {
      await api.updateConnections({
        homeAssistantUrl: connectionDraft.homeAssistantUrl,
        ...(connectionDraft.mcpUrl.trim() ? { mcpUrl: connectionDraft.mcpUrl.trim() } : {}),
        ...(connectionDraft.token.trim() ? { token: connectionDraft.token } : {}),
      });
      await api.updateSettings({
        autonomy: draft.autonomy,
        automaticBackups: draft.automaticBackups,
        retainSessionDays: draft.retainSessionDays,
        theme: draft.theme,
      });
      if (draft.provider && providerKey) {
        const config: ProviderConfigWithSecret = { ...draft.provider, apiKey: providerKey };
        await api.saveProvider(config);
      }
      setProviderKey("");
      setConnectionDraft((current) => ({ ...current, mcpUrl: "", token: "" }));
      await onSaved();
      setStatusMessage("Settings saved securely.");
    } catch (cause) {
      setStatusMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="content-page settings-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow accent">CONTROL PLANE</span>
          <h2>Settings</h2>
          <p>Adjust the agent’s working style and Home Assistant connections.</p>
        </div>
        <button className="primary-button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save settings"} <span>→</span>
        </button>
      </div>

      {statusMessage && <div className={`callout ${statusMessage.includes("saved") ? "success" : "error"}`}>{statusMessage}</div>}

      <div className="settings-grid">
        <div className="panel-card settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow accent">HOME ASSISTANT ACCESS</span>
              <h3>Core & MCP connection</h3>
            </div>
            <span className={`connection-pill ${connections.tokenConfigured ? "connected" : ""}`}>
              {connections.tokenConfigured ? "Token configured" : "Token needed"}
            </span>
          </div>
          <label>
            Home Assistant URL
            <input
              type="url"
              value={connectionDraft.homeAssistantUrl}
              onChange={(event) => setConnectionDraft((current) => ({ ...current, homeAssistantUrl: event.target.value }))}
              placeholder="https://homeassistant.example.com"
              autoComplete="url"
            />
          </label>
          <label>
            Long-lived access token <span className="label-note">(encrypted; leave blank to keep current)</span>
            <input
              type="password"
              value={connectionDraft.token}
              onChange={(event) => setConnectionDraft((current) => ({ ...current, token: event.target.value }))}
              placeholder={connections.tokenConfigured ? "Leave blank to keep current token" : "Paste token here"}
              autoComplete="new-password"
            />
          </label>
          <label>
            MCP endpoint <span className="label-note">(encrypted; leave blank to keep current)</span>
            <input
              type="url"
              value={connectionDraft.mcpUrl}
              onChange={(event) => setConnectionDraft((current) => ({ ...current, mcpUrl: event.target.value }))}
              placeholder={connections.mcpConfigured ? "Configured — enter a new endpoint to replace it" : "https://homeassistant.example.com/api/mcp"}
              autoComplete="url"
            />
          </label>
          <p className="muted tiny">The native Home Assistant MCP endpoint uses the same Bearer token. Supervisor-only APIs become available when Pi runs inside Home Assistant.</p>
        </div>

        <div className="panel-card settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow accent">AI PROVIDER</span>
              <h3>Model connection</h3>
            </div>
            <span className={`connection-pill ${draft.provider ? "connected" : ""}`}>
              {draft.provider ? "Configured" : "Not configured"}
            </span>
          </div>
          {draft.provider ? (
            <>
              <div className="provider-summary">
                <strong>{draft.provider.displayName || draft.provider.kind}</strong>
                <span>{draft.provider.model}</span>
                <small>{draft.provider.baseUrl}</small>
              </div>
              <label>
                Replace API key <span className="label-note">(optional)</span>
                <input
                  type="password"
                  value={providerKey}
                  onChange={(event) => setProviderKey(event.target.value)}
                  placeholder="Leave blank to keep current key"
                  autoComplete="off"
                />
              </label>
            </>
          ) : <p className="muted">Return to onboarding to configure an AI provider.</p>}
        </div>

        <div className="panel-card settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow accent">AUTONOMY</span>
              <h3>How Pi proceeds</h3>
            </div>
          </div>
          <label>
            Default mode
            <select value={draft.autonomy} onChange={(event) => setDraft({ ...draft, autonomy: event.target.value as AppSettings["autonomy"] })}>
              <option value="guided">Guided — ask before changes</option>
              <option value="balanced">Balanced — ask before medium impact</option>
              <option value="autonomous">Autonomous — confirm destructive actions</option>
            </select>
          </label>
          <div className="settings-note"><span>!</span><p>High-risk and destructive operations always require explicit confirmation.</p></div>
        </div>

        <div className="panel-card settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow accent">RECOVERY</span>
              <h3>Checkpoints & retention</h3>
            </div>
          </div>
          <label>
            Automatic checkpoints
            <select value={draft.automaticBackups} onChange={(event) => setDraft({ ...draft, automaticBackups: event.target.value as AppSettings["automaticBackups"] })}>
              <option value="meaningful">Before meaningful changes</option>
              <option value="every-change">Before every file change</option>
              <option value="never">Local checkpoints only</option>
            </select>
          </label>
          <label>
            Keep session history
            <select value={draft.retainSessionDays} onChange={(event) => setDraft({ ...draft, retainSessionDays: Number(event.target.value) })}>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
              <option value={0}>Keep until deleted</option>
            </select>
          </label>
        </div>

        <div className="panel-card settings-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow accent">APPEARANCE</span>
              <h3>Interface</h3>
            </div>
          </div>
          <label>
            Theme
            <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as AppSettings["theme"] })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <p className="muted tiny">The UI is served through Home Assistant Ingress and never returns provider or Home Assistant credentials to the browser.</p>
        </div>
      </div>
    </section>
  );
}
