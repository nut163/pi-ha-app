import { useEffect, useState } from "react";

import type { ActivityEvent, AppBootstrap, SessionRecord, SessionSummary } from "../../../src/core/types.js";
import { api } from "../api";
import { ChangesPanel } from "./ChangesPanel";
import { ChatPanel } from "./ChatPanel";
import { HealthPanel } from "./HealthPanel";
import { SettingsPanel } from "./SettingsPanel";

type Page = "chat" | "changes" | "health" | "settings";

export function AppShell({ initial }: { initial: AppBootstrap }) {
  const [bootstrap, setBootstrap] = useState(initial);
  const [page, setPage] = useState<Page>("chat");
  const [session, setSession] = useState<SessionSummary | undefined>(initial.sessions[0]);
  const [record, setRecord] = useState<SessionRecord | undefined>();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);

  const refresh = async () => {
    const next = await api.bootstrap();
    setBootstrap(next);
    if (session) setSession(next.sessions.find((item) => item.id === session.id) ?? session);
  };
  useEffect(() => {
    if (!session) { setRecord(undefined); return; }
    setLoadingSession(true);
    void api.session(session.id).then((next) => { setRecord(next); setActivities(next.activity); }).finally(() => setLoadingSession(false));
  }, [session?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 20_000);
    return () => window.clearInterval(timer);
  }, [session?.id]);

  const createSession = async () => {
    const result = await api.createSession();
    setBootstrap((current) => ({ ...current, sessions: [result.session, ...current.sessions] }));
    setSession(result.session); setPage("chat"); setSidebarOpen(false);
  };
  const loadRecord = async () => { if (session) { const next = await api.session(session.id); setRecord(next); setActivities(next.activity); } await refresh(); };
  const health = bootstrap.health;
  const connectionLabel = health.some((item) => item.key === "provider" && item.status === "connected") ? "Agent ready" : "Setup needs attention";
  const pending = bootstrap.pendingApprovals;
  const displayMessages = record?.messages ?? [];

  const sessionApprovals = pending.filter((approval) => approval.sessionId === session?.id);
  return <div className="app-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation">☰</button><div className="top-brand"><span className="brand-mark small">π</span><div><strong>Pi Home Agent</strong><span>Home Assistant control plane</span></div></div><div className="top-status"><i className="status-dot connected" />{connectionLabel}<span className="top-divider" /><span className="user-chip">{bootstrap.user.displayName || bootstrap.user.name || "Home Assistant"}</span></div></header><div className="app-body"><aside className={`sidebar ${sidebarOpen ? "open" : ""}`}><div className="sidebar-context"><span className="eyebrow">WORKSPACE</span><strong>Home Assistant</strong><small>{bootstrap.capabilityManifest.homeAssistantVersion ? `v${bootstrap.capabilityManifest.homeAssistantVersion}` : "Capability discovery"}</small></div><nav><NavItem icon="⌂" label="Command center" active={page === "chat"} onClick={() => { setPage("chat"); setSidebarOpen(false); }} /><NavItem icon="◇" label="Changes & audit" active={page === "changes"} count={entriesCount(bootstrap)} onClick={() => { setPage("changes"); setSidebarOpen(false); }} /><NavItem icon="◉" label="Health & capabilities" active={page === "health"} onClick={() => { setPage("health"); setSidebarOpen(false); }} /><NavItem icon="⚙" label="Settings" active={page === "settings"} onClick={() => { setPage("settings"); setSidebarOpen(false); }} /></nav><div className="sidebar-divider" /><div className="sidebar-section-label"><span>SESSIONS</span><button onClick={() => void createSession()} aria-label="New session">＋</button></div><div className="session-list">{bootstrap.sessions.length === 0 && <p className="muted tiny">No sessions yet.</p>}{bootstrap.sessions.map((item) => <button className={`session-item ${item.id === session?.id ? "active" : ""}`} key={item.id} onClick={() => { setSession(item); setPage("chat"); setSidebarOpen(false); }}><i className={item.active ? "active-dot" : ""} /><span>{item.title}</span><small>{relativeTime(item.updatedAt)}</small></button>)}</div><div className="sidebar-footer"><div className="security-badge"><span>⌁</span><div><strong>Protected by Ingress</strong><small>Identity-aware access</small></div></div></div></aside><main className={`main-content ${page === "chat" ? "command-page" : ""}`}>{page === "chat" && <div className="command-layout"><ChatPanel session={session} messages={displayMessages} activities={activities} approvals={sessionApprovals} onRefresh={loadRecord} onApprovalResolved={async () => { await refresh(); await loadRecord(); }} onActivity={(event) => { setActivities((current) => [...current.filter((item) => item.id !== event.id), event].slice(-100)); }} /></div>}{page === "changes" && <ChangesPanel />}{page === "health" && <HealthPanel health={health} manifest={bootstrap.capabilityManifest} onRefresh={async () => { await refresh(); }} />}{page === "settings" && <SettingsPanel settings={bootstrap.settings} connections={bootstrap.connections} onSaved={async () => { await refresh(); }} />}</main></div></div>;
}

function NavItem({ icon, label, active, count, onClick }: { icon: string; label: string; active: boolean; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}><span>{icon}</span>{label}{count ? <b>{count}</b> : null}</button>; }
function entriesCount(bootstrap: AppBootstrap): number { return bootstrap.pendingApprovals.length; }
function relativeTime(value: string): string { const delta = Math.max(0, Date.now() - new Date(value).getTime()); if (delta < 60_000) return "now"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`; return `${Math.floor(delta / 86_400_000)}d`; }
