import { useState } from "react";

import type { ActivityEvent } from "../../../src/core/types.js";

export function ActivityPanel({ activities }: { activities: ActivityEvent[] }) {
  return <aside className="activity-panel panel-card"><div className="panel-heading"><div><span className="eyebrow accent">LIVE TRACE</span><h3>Activity</h3></div><span className="count-badge">{activities.length}</span></div>{activities.length === 0 ? <div className="panel-empty"><span>◌</span><p>Tool activity will appear here as Pi works.</p></div> : <div className="activity-list">{activities.slice(-12).reverse().map((event) => <ActivityItem key={event.id} event={event} />)}</div>}</aside>;
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const details = activityDetails(event);
  return <div className={`activity-item ${expanded ? "expanded" : ""}`}><button className="activity-summary" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><span className={`activity-icon ${event.kind}`}>{iconFor(event.kind)}</span><span className="activity-copy"><strong>{event.title}</strong><p>{event.detail || event.target || ""}</p><time>{new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></span>{event.risk && <span className={`risk-mini ${event.risk.toLowerCase()}`}>{event.risk}</span>}<span className="activity-chevron" aria-hidden="true">⌄</span></button>{expanded && <div className="activity-details">{details.length === 0 ? <p className="activity-no-details">No additional payload was recorded for this step.</p> : details.map(([label, value]) => <div className="activity-detail" key={label}><span>{label}</span><pre>{formatValue(value)}</pre></div>)}</div>}</div>;
}
function iconFor(kind: ActivityEvent["kind"]): string { if (kind === "file-write" || kind === "diff") return "◇"; if (kind === "approval") return "!"; if (kind === "error" || kind === "rollback") return "×"; if (kind === "entity-lookup") return "⌕"; if (kind === "backup") return "↶"; return "·"; }

function activityDetails(event: ActivityEvent): Array<[string, unknown]> {
  const details: Array<[string, unknown]> = [];
  if (event.status) details.push(["Status", event.status]);
  if (event.target) details.push(["Target", event.target]);
  if (event.diff) details.push(["Diff", event.diff]);
  for (const [key, value] of Object.entries(event.metadata ?? {})) details.push([labelFor(key), value]);
  return details;
}

function labelFor(value: string): string { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()); }
function formatValue(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
