import { useState } from "react";

import type { CapabilityManifest, HealthCheck } from "../../../src/core/types.js";
import { api } from "../api";

export function HealthPanel({ health, manifest, onRefresh }: { health: HealthCheck[]; manifest: CapabilityManifest; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } };
  const connected = health.filter((item) => item.status === "connected").length;
  return <section className="content-page"><div className="page-title-row"><div><span className="eyebrow accent">SYSTEM VISIBILITY</span><h2>Health & capabilities</h2><p>Pi checks the boundaries it depends on and keeps degradation visible.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={busy}>↻ {busy ? "Refreshing…" : "Refresh checks"}</button></div><div className="health-hero"><div className="health-score"><span className="score-ring">{connected}<small>/{health.length}</small></span><div><strong>{connected === health.length ? "All systems go" : connected ? "Partially connected" : "Needs attention"}</strong><p>{connected} of {health.length} checks are connected.</p></div></div><div className="hero-metrics"><Metric value={manifest.homeAssistantVersion ?? "—"} label="Home Assistant" /><Metric value={manifest.entityCount ?? "—"} label="entities" /><Metric value={manifest.automationCount ?? "—"} label="automations" /></div></div><div className="health-list panel-card" role="list">{health.map((item) => <HealthCard key={item.key} item={item} />)}</div><div className="panel-card capability-note"><span className="quiet-icon">⌁</span><div><strong>Capability manifest</strong><p>Installation: <code>{manifest.installation}</code>. Pi can refresh this view without changing your system.</p><small>Generated {new Date(manifest.generatedAt).toLocaleString()}</small></div></div></section>;
}
function HealthCard({ item }: { item: HealthCheck }) { return <div className="health-row" role="listitem"><div className="health-row-status"><i className={`status-dot ${item.status}`} /><span className="health-status">{item.status}</span></div><h3>{item.label}</h3><p>{item.detail}</p><time>Checked {new Date(item.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>; }
function Metric({ value, label }: { value: number | string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
