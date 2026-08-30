import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { AppBootstrap } from "../../src/core/types.js";
import { api } from "./api";
import { AppShell } from "./components/AppShell";
import { Onboarding } from "./components/Onboarding";
import "./styles.css";

function App() {
  const [bootstrap, setBootstrap] = useState<AppBootstrap>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setBootstrap(await api.bootstrap()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => { void refresh().finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { if (bootstrap?.settings.theme) document.documentElement.dataset.theme = bootstrap.settings.theme; }, [bootstrap?.settings.theme]);
  if (loading) return <LoadingScreen />;
  if (!bootstrap) return <ErrorScreen message={error} onRetry={() => void refresh()} />;
  if (!bootstrap.setupCompleted) return <Onboarding bootstrap={bootstrap} onComplete={async () => { await refresh(); }} />;
  return <AppShell initial={bootstrap} />;
}

function LoadingScreen() { return <main className="loading-screen"><div className="brand-mark">π</div><div className="loading-spinner" /><p>Preparing your Home Assistant workspace…</p></main>; }
function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) { return <main className="loading-screen"><div className="brand-mark">π</div><h2>Pi Home Agent is offline</h2><p>{message || "Could not reach the local App server."}</p><button className="primary-button" onClick={onRetry}>Try again <span>→</span></button></main>; }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
