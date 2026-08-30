import { useEffect, useState } from "react";

import type { AuditEntry } from "../../../src/core/types.js";
import { api } from "../api";

export function ChangesPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => { void api.audit().then((result) => setEntries(result.entries)).finally(() => setBusy(false)); }, []);
  return <section className="content-page"><div className="page-title-row"><div><span className="eyebrow accent">ACCOUNTABILITY</span><h2>Changes & audit</h2><p>A durable record of requested intent, scope, risk, approval, validation, and rollback.</p></div><span className="count-badge large">{entries.length} events</span></div>{busy ? <div className="loading-line">Loading audit history…</div> : entries.length === 0 ? <div className="empty-state slim"><div className="empty-icon">◌</div><h3>No changes yet</h3><p>When Pi performs or proposes an operation, it will appear here.</p></div> : <div className="audit-list">{entries.map((entry) => <AuditRow key={entry.id} entry={entry} />)}</div>}</section>;
}
function AuditRow({ entry }: { entry: AuditEntry }) { return <article className="audit-row"><div className={`audit-marker ${entry.result}`} /> <div className="audit-main"><div className="audit-heading"><strong>{entry.operation}</strong><span className={`audit-result ${entry.result}`}>{entry.result.replace("-", " ")}</span><time>{new Date(entry.timestamp).toLocaleString()}</time></div><p>{entry.requestedIntent}</p><div className="audit-meta"><code>{entry.target}</code><span>{entry.tool}</span><span className={`risk-mini ${entry.risk.toLowerCase()}`}>{entry.risk}</span><span>approval: {entry.approval}</span>{entry.rollbackStatus !== "not-needed" && <span>rollback: {entry.rollbackStatus}</span>}</div>{entry.error && <div className="audit-error">{entry.error}</div>}</div></article>; }
