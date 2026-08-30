import { useMemo, useState } from "react";

import type { AppBootstrap, HealthCheck, ProviderConfigWithSecret } from "../../../src/core/types.js";
import { api } from "../api";
import { ProviderModelField } from "./ProviderModelField";

interface OnboardingProps {
  bootstrap: AppBootstrap;
  onComplete: () => Promise<void>;
}

const steps = ["Welcome", "Connect Home Assistant", "Choose a provider", "Set guardrails", "Ready"];

export function Onboarding({ bootstrap, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [health, setHealth] = useState<HealthCheck[]>(bootstrap.health);
  const [haManifest, setHaManifest] = useState(bootstrap.capabilityManifest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerTest, setProviderTest] = useState<Awaited<ReturnType<typeof api.testProvider>>>();
  const [provider, setProvider] = useState<ProviderConfigWithSecret>({
    kind: bootstrap.settings.provider?.kind ?? "openai-compatible",
    model: bootstrap.settings.provider?.model ?? "llama3.2",
    baseUrl: bootstrap.settings.provider?.baseUrl ?? "http://localhost:11434/v1",
    displayName: bootstrap.settings.provider?.displayName ?? "",
    supportsReasoning: bootstrap.settings.provider?.supportsReasoning ?? false,
  });
  const [autonomy, setAutonomy] = useState(bootstrap.settings.autonomy);
  const [backups, setBackups] = useState(bootstrap.settings.automaticBackups);

  const connected = useMemo(() => health.filter((item) => item.status === "connected").length, [health]);

  const runHaCheck = async () => {
    setBusy(true); setError("");
    try {
      const result = await api.testHa();
      setHealth(result.health);
      setHaManifest(result.manifest);
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const runProviderTest = async () => {
    setBusy(true); setError("");
    try {
      const result = await api.testProvider(provider);
      setProviderTest(result);
      if (result.ok) {
        await api.saveProvider(provider);
        setStep(3);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const saveProvider = async () => {
    setBusy(true); setError("");
    try {
      await api.saveProvider(provider);
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError("");
    try {
      await api.updateSettings({ autonomy, automaticBackups: backups });
      await api.completeOnboarding();
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  return (
    <main className="onboarding-page">
      <div className="onboarding-orb orb-one" />
      <div className="onboarding-orb orb-two" />
      <section className="onboarding-card">
        <div className="brand-lockup">
          <div className="brand-mark">π</div>
          <div><span className="eyebrow">HOME ASSISTANT APP</span><h1>Pi Home Agent</h1></div>
        </div>
        <div className="wizard-steps" aria-label="Setup progress">
          {steps.map((label, index) => <div className={`wizard-step ${index === step ? "active" : ""} ${index < step ? "complete" : ""}`} key={label}><span>{index < step ? "✓" : index + 1}</span><small>{label}</small></div>)}
        </div>
        {error && <div className="callout error">{error}</div>}

        {step === 0 && <div className="wizard-content">
          <p className="eyebrow accent">A calmer control plane for Home Assistant</p>
          <h2>Make changes with context, guardrails, and a way back.</h2>
          <p className="lede">Pi Home Agent brings a coding-agent workflow to Home Assistant: inspect your system, propose a focused change, show the diff, validate it, and keep a checkpoint.</p>
          <div className="feature-grid">
            <Feature icon="⌁" title="Understand first" text="Entity-aware context, scoped files, and lazy tool discovery." />
            <Feature icon="◈" title="Ask before impact" text="Deterministic risk levels and clear approval cards." />
            <Feature icon="↶" title="Recover cleanly" text="Validation, audit history, checkpoints, and rollback." />
          </div>
          <button className="primary-button" onClick={() => setStep(1)}>Set up Pi Home Agent <span>→</span></button>
          <p className="muted tiny">Your Home Assistant identity stays in the local Ingress session. Provider keys are encrypted at rest and never sent to the browser.</p>
        </div>}

        {step === 1 && <div className="wizard-content">
          <p className="eyebrow accent">Step 1 / 4</p>
          <h2>Let’s meet your Home Assistant.</h2>
          <p className="lede">The App uses Home Assistant’s internal Core and Supervisor APIs when available. This check is read-only.</p>
          <HealthSnapshot health={health} />
          <div className="metric-strip"><Metric value={haManifest.entityCount ?? "—"} label="entities visible" /><Metric value={haManifest.automationCount ?? "—"} label="automations" /><Metric value={connected} label="checks connected" /></div>
          <div className="button-row"><button className="secondary-button" onClick={() => setStep(0)}>Back</button><button className="secondary-button" onClick={() => setStep(2)}>Continue with current status</button><button className="primary-button" onClick={runHaCheck} disabled={busy}>{busy ? "Checking…" : "Run read-only check"} <span>→</span></button></div>
          <p className="muted tiny">A development browser may show unavailable checks until the App is running inside Home Assistant. You can still configure the agent and revisit Health later.</p>
        </div>}

        {step === 2 && <div className="wizard-content">
          <p className="eyebrow accent">Step 2 / 4</p>
          <h2>Choose the model that thinks with you.</h2>
          <p className="lede">Pi keeps your provider boundary explicit. You can use a hosted provider, an OpenAI-compatible gateway, or a local model.</p>
          <div className="form-grid">
            <label>Provider<select value={provider.kind} onChange={(event) => setProvider({ ...provider, kind: event.target.value as ProviderConfigWithSecret["kind"], baseUrl: event.target.value === "anthropic" ? "https://api.anthropic.com" : event.target.value === "openai" ? "https://api.openai.com/v1" : "http://localhost:11434/v1" })}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI-compatible</option><option value="local">Local / Ollama</option></select></label>
            <ProviderModelField provider={provider} apiKey={provider.apiKey} onChange={(model) => setProvider({ ...provider, model })} />
            <label className="full">Base URL<input value={provider.baseUrl ?? ""} onChange={(event) => setProvider({ ...provider, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
            <label className="full">API key <span className="label-note">(stored encrypted; optional for local or keyless gateways)</span><input type="password" value={provider.apiKey ?? ""} onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })} placeholder={provider.kind === "local" || provider.kind === "openai-compatible" ? "Optional — leave blank if not required" : "Paste a key"} autoComplete="off" /></label>
            <label className="check-label full"><input type="checkbox" checked={provider.supportsReasoning === true} onChange={(event) => setProvider({ ...provider, supportsReasoning: event.target.checked })} /> Model supports extended reasoning</label>
          </div>
          {providerTest && <div className={`provider-result ${providerTest.ok ? "ok" : "bad"}`}><strong>{providerTest.ok ? "Provider ready" : "Provider needs attention"}</strong>{providerTest.checks.map((check) => <div key={check.key}><span>{check.ok ? "✓" : "!"}</span>{check.label}<small>{check.detail}</small></div>)}</div>}
          <div className="button-row"><button className="secondary-button" onClick={() => setStep(1)}>Back</button><button className="secondary-button" onClick={runProviderTest} disabled={busy}>{busy ? "Testing…" : "Test connection"}</button><button className="primary-button" onClick={saveProvider} disabled={busy}>{busy ? "Saving…" : "Save provider"} <span>→</span></button></div>
        </div>}

        {step === 3 && <div className="wizard-content">
          <p className="eyebrow accent">Step 3 / 4</p>
          <h2>Pick your pace of autonomy.</h2>
          <p className="lede">This setting is a starting point. High-impact and destructive operations always stop for confirmation.</p>
          <div className="choice-stack">{([["guided", "Guided", "Ask before every change. Best for first runs and unfamiliar systems."], ["balanced", "Balanced", "Read freely, allow low-risk changes, and ask before medium impact."], ["autonomous", "Autonomous", "Let low and medium operations proceed; always confirm destructive actions."]] as const).map(([value, title, text]) => <button key={value} className={`choice-card ${autonomy === value ? "selected" : ""}`} onClick={() => setAutonomy(value)}><span className="radio-dot" /><div><strong>{title}</strong><p>{text}</p></div><span className="risk-pill">{value === "guided" ? "most control" : value === "balanced" ? "recommended" : "fastest"}</span></button>)}</div>
          <label className="select-block">Automatic checkpoints<select value={backups} onChange={(event) => setBackups(event.target.value as typeof backups)}><option value="meaningful">Before meaningful changes</option><option value="every-change">Before every file change</option><option value="never">Local checkpoints only</option></select></label>
          <div className="button-row"><button className="secondary-button" onClick={() => setStep(2)}>Back</button><button className="primary-button" onClick={() => setStep(4)}>Review guardrails <span>→</span></button></div>
        </div>}

        {step === 4 && <div className="wizard-content">
          <div className="ready-icon">✓</div><p className="eyebrow accent">Ready when you are</p><h2>Pi Home Agent is configured.</h2><p className="lede">You can now ask for an explanation, an investigation, or a small change. Every operation will show its scope, risk, and validation result.</p>
          <div className="summary-card"><div><span className="summary-label">Provider</span><strong>{provider.displayName || provider.kind}</strong><small>{provider.model}</small></div><div><span className="summary-label">Autonomy</span><strong>{autonomy}</strong><small>high-impact actions still confirm</small></div><div><span className="summary-label">Checkpoints</span><strong>{backups === "every-change" ? "Every change" : backups === "never" ? "Local only" : "Meaningful changes"}</strong><small>recoverable activity history</small></div></div>
          <button className="primary-button wide" onClick={finish} disabled={busy}>{busy ? "Finishing setup…" : "Open Pi Home Agent"} <span>→</span></button>
        </div>}
      </section>
    </main>
  );
}

function Feature({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="feature"><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
function Metric({ value, label }: { value: number | string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function HealthSnapshot({ health }: { health: HealthCheck[] }) { return <div className="health-snapshot">{health.slice(0, 5).map((item) => <div key={item.key}><i className={`status-dot ${item.status}`} /><span>{item.label}</span><small>{item.status === "connected" ? "Connected" : item.status}</small></div>)}</div>; }
