import { useState } from "react";

import type { ApprovalRequest } from "../../../src/core/types.js";
import { api } from "../api";

export function ApprovalsPanel({ approvals, onResolved }: { approvals: ApprovalRequest[]; onResolved: () => Promise<void> }) {
  if (approvals.length === 0) return <div className="panel-card quiet-card"><span className="quiet-icon">✓</span><div><strong>No pending approvals</strong><p>Pi will pause here before any action that needs your decision.</p></div></div>;
  return <div className="approval-stack">{approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} onResolved={onResolved} />)}</div>;
}

export function ApprovalCard({ approval, onResolved }: { approval: ApprovalRequest; onResolved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const resolve = async (decision: "approved" | "rejected") => { setBusy(true); try { await api.resolveApproval(approval.id, decision); await onResolved(); } finally { setBusy(false); } };
  return <article className={`approval-card ${approval.risk.toLowerCase()}`}><div className="approval-top"><span className="approval-badge">{approval.risk} RISK</span><time>{new Date(approval.createdAt).toLocaleString()}</time></div><h3>{approval.title}</h3><p>{approval.explanation}</p><div className="approval-target"><span>Target</span><code>{approval.target}</code></div><div className="button-row"><button className="secondary-button" onClick={() => void resolve("rejected")} disabled={busy}>Reject</button><button className="primary-button" onClick={() => void resolve("approved")} disabled={busy}>{busy ? "Applying…" : "Approve change"} <span>→</span></button></div></article>;
}
