import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ActivityEvent, ChatMessage, SessionSummary } from "../../../src/core/types.js";
import { api, type StreamEvent } from "../api";

interface ChatPanelProps {
  session: SessionSummary | undefined;
  messages: ChatMessage[];
  activities: ActivityEvent[];
  onRefresh: () => Promise<void>;
  onActivity: (event: ActivityEvent) => void;
}

export function ChatPanel({ session, messages, activities, onRefresh, onActivity }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming, activities]);

  const send = async () => {
    if (!session || !draft.trim() || sending) return;
    const message = draft.trim();
    setDraft(""); setSending(true); setStreaming(""); setError("");
    try {
      await api.streamMessage(session.id, message, (event: StreamEvent) => {
        if (event.type === "assistant_delta") setStreaming((current) => current + event.delta);
        if (event.type === "activity") onActivity(event.event);
        if (event.type === "done" && event.message) setStreaming(event.message);
        if (event.type === "error") setError(event.error);
      });
      await onRefresh();
      setStreaming("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setSending(false); }
  };

  if (!session) return <section className="empty-state"><div className="empty-icon">✦</div><h2>Start a workspace conversation</h2><p>Create a session to investigate your Home Assistant, plan a change, or ask Pi to explain what it sees.</p></section>;
  return <section className="chat-panel">
    <div className="chat-header"><div><span className="eyebrow accent">ACTIVE WORKSPACE</span><h2>{session.title}</h2><p>Scoped to Home Assistant · activity is checkpointed</p></div><div className="live-indicator"><i /> {sending ? "Working" : "Ready"}</div></div>
    <div className="starter-chips">{["What is happening right now?", "Find unavailable entities", "Explain my automations"].map((chip) => <button key={chip} onClick={() => setDraft(chip)}>{chip}</button>)}</div>
    <div className="message-scroll">
      {messages.length === 0 && !streaming && <div className="chat-intro"><div className="intro-mark">π</div><h3>Good systems start with a clear question.</h3><p>Try a read-only request first. Pi will show the tools it uses and pause before anything that could change your home.</p></div>}
      {messages.map((message) => <Message key={message.id} message={message} />)}
      {streaming && <div className="message assistant"><div className="avatar pi-avatar">π</div><div className="message-body"><span className="message-label">PI HOME AGENT</span><MarkdownContent content={streaming} streaming /></div></div>}
      {sending && !streaming && <div className="message assistant"><div className="avatar pi-avatar">π</div><div className="message-body"><span className="message-label">PI HOME AGENT</span><div className="thinking-dots"><i /><i /><i /></div></div></div>}
      {error && <div className="callout error compact">{error}</div>}
      <div ref={endRef} />
    </div>
    <div className="composer-wrap"><div className="composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask Pi to inspect, explain, or propose a change…" rows={1} disabled={sending} /><button className="send-button" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send message">↑</button></div><div className="composer-hint"><span>Enter to send · Shift + Enter for a new line</span><span className="secure-note">⌁ Ingress session protected</span></div></div>
  </section>;
}

function Message({ message }: { message: ChatMessage }) {
  const assistant = message.role === "assistant";
  return <div className={`message ${assistant ? "assistant" : message.role}`}><div className={`avatar ${assistant ? "pi-avatar" : "user-avatar"}`}>{assistant ? "π" : "you"}</div><div className="message-body"><span className="message-label">{assistant ? "PI HOME AGENT" : "YOU"}</span>{assistant ? <MarkdownContent content={message.content} /> : <p className="message-content">{message.content}</p>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div></div>;
}

function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return <div className="message-content markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{content}</ReactMarkdown>{streaming && <span className="cursor" />}</div>;
}
