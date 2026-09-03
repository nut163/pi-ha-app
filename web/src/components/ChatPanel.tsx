import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ActivityEvent, ApprovalRequest, ChatMessage, SessionSummary } from "../../../src/core/types.js";
import { api, type StreamEvent } from "../api";
import { ActivityItem } from "./ActivityPanel";
import { ApprovalCard } from "./ApprovalsPanel";

interface ChatPanelProps {
  session: SessionSummary | undefined;
  messages: ChatMessage[];
  activities: ActivityEvent[];
  approvals: ApprovalRequest[];
  onRefresh: () => Promise<void>;
  onApprovalResolved: () => Promise<void>;
  onActivity: (event: ActivityEvent) => void;
}

export function ChatPanel({ session, messages, activities, approvals, onRefresh, onApprovalResolved, onActivity }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [pendingMessage, setPendingMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, activities, pendingMessage, approvals]);

  const send = async () => {
    if (!session || !draft.trim() || sending) return;
    const message = draft.trim();
    setDraft(""); setSending(true); setPendingMessage(message); setStreaming(""); setError("");
    try {
      await api.streamMessage(session.id, message, (event: StreamEvent) => {
        if (event.type === "assistant_delta") setStreaming((current) => current + event.delta);
        if (event.type === "activity") onActivity(event.event);
        if (event.type === "done" && event.message) setStreaming(event.message);
        if (event.type === "error") setError(event.error);
      });
      setPendingMessage("");
      await onRefresh();
      setStreaming("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSending(false); }
  };

  if (!session) return <section className="empty-state"><div className="empty-icon">✦</div><h2>Start a workspace conversation</h2><p>Create a session to investigate your Home Assistant, plan a change, or ask Pi to explain what it sees.</p></section>;
  const timeline = buildTimeline(messages, activities);
  const timelineApprovalIds = new Set(timeline
    .filter((item): item is Extract<TimelineItem, { type: "activity" }> => item.type === "activity")
    .map((item) => approvalForEvent(item.event, approvals)?.id)
    .filter((id): id is string => Boolean(id)));
  const unplacedApprovals = approvals.filter((approval) => !timelineApprovalIds.has(approval.id));
  return <section className="chat-panel">
    <div className="chat-header"><div><span className="eyebrow accent">ACTIVE WORKSPACE</span><h2>{session.title}</h2><p>Scoped to Home Assistant · activity is checkpointed</p></div><div className="live-indicator"><i /> {sending ? "Working" : "Ready"}</div></div>
    <div className="message-scroll">
      <div className="conversation-content">
        {messages.length === 0 && activities.length === 0 && !pendingMessage && !streaming && <div className="chat-intro"><div className="intro-mark">π</div><h3>Good systems start with a clear question.</h3><p>Try a read-only request first. Pi will show the tools it uses and pause before anything that could change your home.</p></div>}
        {pendingMessage && <Message message={{ id: "pending-user-message", role: "user", content: pendingMessage, createdAt: new Date().toISOString() }} />}
        {timeline.map((item) => item.type === "message"
          ? <Message key={`message-${item.message.id}`} message={item.message} />
          : <ConversationActivity key={`activity-${item.event.id}`} event={item.event} approvals={approvals} onApprovalResolved={onApprovalResolved} />)}
        {unplacedApprovals.map((approval) => <div className="conversation-event approval-event" key={`approval-${approval.id}`}><ApprovalCard approval={approval} onResolved={onApprovalResolved} /></div>)}
        {streaming && <div className="message assistant"><div className="avatar pi-avatar">π</div><div className="message-body"><span className="message-label">PI HOME AGENT</span><MarkdownContent content={streaming} streaming /></div></div>}
        {sending && !streaming && <div className="message assistant"><div className="avatar pi-avatar">π</div><div className="message-body"><span className="message-label">PI HOME AGENT</span><div className="thinking-dots"><i /><i /><i /></div></div></div>}
        {error && <div className="callout error compact">{error}</div>}
        <div ref={endRef} />
      </div>
    </div>
    <div className="starter-chips">{["What is happening right now?", "Find unavailable entities", "Explain my automations"].map((chip) => <button key={chip} onClick={() => setDraft(chip)}>{chip}</button>)}</div>
    <div className="composer-wrap"><div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask Pi to inspect, explain, or propose a change…" rows={1} disabled={sending} /><button className="send-button" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send message">↑</button></div><div className="composer-hint"><span>Enter to send · Shift + Enter for a new line</span><span className="secure-note">⌁ Ingress session protected</span></div></div>
  </section>;
}

function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  const system = message.role === "system";
  return <div className={`message ${assistant ? "assistant" : message.role}`}><div className={`avatar ${assistant ? "pi-avatar" : system ? "system-avatar" : "user-avatar"}`}>{assistant ? "π" : system ? "·" : "you"}</div><div className="message-body"><span className="message-label">{assistant ? "PI HOME AGENT" : system ? "SYSTEM" : "YOU"}</span>{assistant ? <MarkdownContent content={message.content} /> : <p className="message-content">{message.content}</p>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>;
}

function ConversationActivity({ event, approvals, onApprovalResolved }: { event: ActivityEvent; approvals: ApprovalRequest[]; onApprovalResolved: () => Promise<void> }) {
  const approval = approvalForEvent(event, approvals);
  if (approval) return <div className="conversation-event approval-event"><ApprovalCard approval={approval} onResolved={onApprovalResolved} /></div>;
  return <div className="conversation-event"><ActivityItem event={event} /></div>;
}

function approvalForEvent(event: ActivityEvent, approvals: ApprovalRequest[]): ApprovalRequest | undefined {
  if (event.kind !== "approval" || event.status !== "pending") return undefined;
  const approvalId = event.metadata?.approvalId;
  return typeof approvalId === "string" ? approvals.find((approval) => approval.id === approvalId) : undefined;
}

type TimelineItem =
  | { type: "message"; message: ChatMessage; createdAt: number; order: number }
  | { type: "activity"; event: ActivityEvent; createdAt: number; order: number };

function buildTimeline(messages: ChatMessage[], activities: ActivityEvent[]): TimelineItem[] {
  return [
    ...messages.map((message, order) => ({ type: "message" as const, message, createdAt: timestamp(message.createdAt), order })),
    ...activities.map((event, order) => ({ type: "activity" as const, event, createdAt: timestamp(event.createdAt), order: messages.length + order })),
  ].sort((left, right) => left.createdAt - right.createdAt || left.order - right.order);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return <div className="message-content markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{content}</ReactMarkdown>{streaming && <span className="cursor" />}</div>;
}
