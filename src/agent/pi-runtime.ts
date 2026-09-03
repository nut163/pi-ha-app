import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import { ActivityHub } from "../core/activity-hub.js";
import { JsonStore, readJson } from "../core/json-store.js";
import type { RuntimePaths } from "../core/config.js";
import type {
  ActivityEvent,
  AutonomyMode,
  ChatMessage,
  HomeAssistantUser,
  SessionRecord,
  SessionSummary,
  StoredState,
  ToolExecutionResult,
} from "../core/types.js";
import { ProviderService } from "./provider-service.js";
import { createPiTools } from "./pi-tools.js";
import { ToolDispatcher, type ToolExecutionContext } from "./tool-dispatcher.js";

export type AgentStreamEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "activity"; event: ActivityEvent }
  | { type: "done"; message: string }
  | { type: "error"; error: string };

export type AgentStreamListener = (event: AgentStreamEvent) => void;

interface ManagedSession {
  record: SessionRecord;
  session: AgentSession;
  toolContext: ToolExecutionContext;
  lock: Promise<void>;
}

const SESSION_ID_PATTERN = /^[a-f0-9-]{20,80}$/i;

export class PiAgentService {
  private readonly managed = new Map<string, ManagedSession>();
  private readonly recordStores = new Map<string, JsonStore<SessionRecord>>();

  public constructor(
    private readonly paths: RuntimePaths,
    private readonly state: JsonStore<StoredState>,
    private readonly providers: ProviderService,
    private readonly dispatcher: ToolDispatcher,
    private readonly activity: ActivityHub,
    private readonly skillsDir = path.resolve("skills"),
  ) {}

  public async listSessions(): Promise<SessionSummary[]> {
    await mkdir(this.paths.sessionsDir, { recursive: true });
    const names = await readdir(this.paths.sessionsDir);
    const records: SessionRecord[] = [];
    for (const name of names.filter((item) => item.endsWith(".record.json"))) {
      const record = await readJson<SessionRecord>(path.join(this.paths.sessionsDir, name), undefined as never);
      if (record?.summary) records.push(record);
    }
    return records
      .map((record) => ({ ...record.summary, active: this.managed.has(record.summary.id) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async createSession(user: HomeAssistantUser, title = "New Home Assistant session"): Promise<SessionSummary> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const summary: SessionSummary = {
      id,
      title: title.trim().slice(0, 120) || "New Home Assistant session",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      active: false,
    };
    const record: SessionRecord = { summary, messages: [], activity: [] };
    await this.saveRecord(record);
    return summary;
  }

  public async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    if (!SESSION_ID_PATTERN.test(sessionId)) return undefined;
    const managed = this.managed.get(sessionId);
    if (managed) return managed.record;
    return readJson(this.recordPath(sessionId), undefined as never);
  }

  public async persistActivity(event: ActivityEvent): Promise<void> {
    const record = await this.getSession(event.sessionId);
    if (!record) return;
    if (!record.activity.some((item) => item.id === event.id)) record.activity.push(event);
    if (record.activity.length > 500) record.activity.splice(0, record.activity.length - 500);
    record.summary.updatedAt = event.createdAt;
    await this.saveRecord(record);
  }

  public async sendPrompt(
    sessionId: string,
    text: string,
    user: HomeAssistantUser,
    listener?: AgentStreamListener,
  ): Promise<void> {
    const managed = await this.ensureManaged(sessionId, user);
    await this.withLock(managed, async () => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("Message cannot be empty.");
      const settings = (await this.state.get()).settings;
      Object.assign(managed.toolContext, {
        sessionId,
        user,
        intent: trimmed,
        autonomy: settings.autonomy,
      });
      await this.appendMessage(managed, "user", trimmed);
      const unsubscribeActivity = this.activity.subscribe(sessionId, (event) => {
        this.emit(managed, { type: "activity", event }, listener);
      });
      this.activity.emit({
        sessionId,
        kind: "status",
        title: "Thinking",
        detail: "Pi is interpreting the request.",
        status: "running",
      });

      let responseText = "";
      const unsubscribe = managed.session.subscribe((event) => {
        responseText = this.handleSessionEvent(managed, event, responseText, listener);
      });
      try {
        await managed.session.prompt(trimmed);
        if (!responseText) responseText = this.lastAssistantText(managed.session);
        if (responseText) await this.appendMessage(managed, "assistant", responseText);
        this.emit(managed, { type: "done", message: responseText }, listener);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await this.appendMessage(managed, "system", `Agent error: ${detail}`);
        this.emit(managed, { type: "error", error: detail }, listener);
        this.activity.emit({
          sessionId,
          kind: "error",
          title: "Agent request failed",
          detail,
          status: "error",
        });
        throw error;
      } finally {
        unsubscribe();
        unsubscribeActivity();
        await this.saveRecord(managed.record);
      }
    });
  }

  public async resolveApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    user: HomeAssistantUser,
  ): Promise<ToolExecutionResult> {
    const settings = (await this.state.get()).settings;
    const result = await this.dispatcher.resolveApproval(approvalId, decision, user, settings.autonomy);
    if ("approvalRequired" in result) return result;
    const approvalSession = await this.findApprovalSession(approvalId);
    if (approvalSession) {
      try {
        const managed = await this.ensureManaged(approvalSession, user);
        await this.withLock(managed, async () => {
          const message = result.content;
          await this.appendMessage(managed, "system", message);
          try {
            await managed.session.sendCustomMessage({
              customType: "approval_result",
              content: message,
              display: true,
              details: { approvalId, decision },
            }, { triggerTurn: true });
          } catch {
            // The browser can still show the completed operation even if the
            // provider is offline while trying to continue the conversation.
          }
        });
      } catch {
        // The operation is already resolved and durable. Resuming the Pi
        // transcript is best effort when the provider is unavailable.
      }
    }
    return result;
  }

  public async closeAll(): Promise<void> {
    for (const managed of this.managed.values()) managed.session.dispose();
    this.managed.clear();
  }

  private async ensureManaged(sessionId: string, user: HomeAssistantUser): Promise<ManagedSession> {
    if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error("Invalid session id.");
    const existing = this.managed.get(sessionId);
    if (existing) {
      existing.toolContext.user = user;
      return existing;
    }
    const record = await this.getSession(sessionId);
    if (!record) throw new Error("Session not found.");
    const runtime = await this.providers.createRuntime();
    const model = await this.providers.getModel();
    if (!model) throw new Error("The configured provider model is unavailable.");
    const settingsManager = SettingsManager.create(this.paths.configDir, this.paths.agentDir, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.paths.configDir,
      agentDir: this.paths.agentDir,
      settingsManager,
      additionalSkillPaths: [this.skillsDir],
      noExtensions: true,
      systemPromptOverride: (base) => `${base ?? ""}\n\n${buildSystemPrompt()}`,
    });
    await resourceLoader.reload();
    let sessionManager: SessionManager;
    if (record.piSessionFile) {
      try {
        await access(record.piSessionFile);
        sessionManager = SessionManager.open(record.piSessionFile, this.paths.sessionsDir, this.paths.configDir);
      } catch {
        sessionManager = SessionManager.create(this.paths.configDir, this.paths.sessionsDir);
      }
    } else {
      sessionManager = SessionManager.create(this.paths.configDir, this.paths.sessionsDir);
    }
    const toolContext: ToolExecutionContext = {
      sessionId,
      user,
      intent: "Session request",
      autonomy: (await this.state.get()).settings.autonomy,
    };
    const tools = createPiTools(this.dispatcher, () => toolContext);
    const { session } = await createAgentSession({
      cwd: this.paths.configDir,
      agentDir: this.paths.agentDir,
      modelRuntime: runtime,
      model,
      thinkingLevel: "medium",
      noTools: "all",
      tools: tools.map((tool) => tool.name),
      customTools: tools,
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    record.piSessionFile = session.sessionFile;
    const managed: ManagedSession = { record, session, toolContext, lock: Promise.resolve() };
    this.managed.set(sessionId, managed);
    await this.saveRecord(record);
    return managed;
  }

  private async appendMessage(managed: ManagedSession, role: ChatMessage["role"], content: string): Promise<void> {
    const message: ChatMessage = { id: randomUUID(), role, content, createdAt: new Date().toISOString() };
    managed.record.messages.push(message);
    managed.record.summary.messageCount = managed.record.messages.length;
    managed.record.summary.updatedAt = message.createdAt;
    await this.saveRecord(managed.record);
  }

  private async saveRecord(record: SessionRecord): Promise<void> {
    const store = this.recordStores.get(record.summary.id) ?? new JsonStore<SessionRecord>(this.recordPath(record.summary.id), record);
    this.recordStores.set(record.summary.id, store);
    await store.set(record);
  }

  private recordPath(sessionId: string): string {
    return path.join(this.paths.sessionsDir, `${sessionId}.record.json`);
  }

  private async withLock<T>(managed: ManagedSession, work: () => Promise<T>): Promise<T> {
    const previous = managed.lock;
    let release!: () => void;
    managed.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  private handleSessionEvent(
    managed: ManagedSession,
    event: AgentSessionEvent,
    previousText: string,
    listener?: AgentStreamListener,
  ): string {
    const sessionId = managed.record.summary.id;
    if (event.type === "message_update") {
      const messageText = messageTextFrom(event.message);
      const delta = messageText.startsWith(previousText) ? messageText.slice(previousText.length) : messageText;
      if (delta) this.emit(managed, { type: "assistant_delta", delta }, listener);
      return messageText;
    }
    if (event.type === "tool_execution_start") {
      this.activity.emit({
        sessionId,
        kind: "tool-execution",
        title: `Using ${event.toolName}`,
        detail: "The agent is executing a capability.",
        status: "running",
        target: event.toolName,
        metadata: { toolCallId: event.toolCallId, arguments: activityPayload(event.args) },
      });
    } else if (event.type === "tool_execution_end") {
      this.activity.emit({
        sessionId,
        kind: "tool-execution",
        title: `${event.toolName} ${event.isError ? "failed" : "completed"}`,
        detail: event.isError ? "The tool returned an error." : "The tool returned successfully.",
        status: event.isError ? "error" : "success",
        target: event.toolName,
        metadata: { toolCallId: event.toolCallId, response: activityPayload(event.result) },
      });
    } else if (event.type === "agent_start") {
      this.activity.emit({ sessionId, kind: "status", title: "Agent started", status: "running" });
    } else if (event.type === "agent_end" || event.type === "agent_settled") {
      this.activity.emit({ sessionId, kind: "status", title: "Agent settled", status: "success" });
    }
    return previousText;
  }

  private emit(managed: ManagedSession, event: AgentStreamEvent, listener?: AgentStreamListener): void {
    if (event.type === "activity") {
      managed.record.activity.push(event.event);
      if (managed.record.activity.length > 500) managed.record.activity.splice(0, managed.record.activity.length - 500);
    }
    listener?.(event);
  }

  private lastAssistantText(session: AgentSession): string {
    const messages = session.messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message && message.role === "assistant") return messageTextFrom(message);
    }
    return "";
  }

  private async findApprovalSession(approvalId: string): Promise<string | undefined> {
    const pending = await this.dispatcher.getApproval(approvalId);
    return pending?.sessionId;
  }
}

function activityPayload(value: unknown): unknown {
  const secretKey = /(^|_)(api[_-]?key|token|password|secret|authorization)($|_)/i;
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(value, (key, current) => {
    if (secretKey.test(key)) return "[redacted]";
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return "[circular]";
      seen.add(current);
    }
    return current;
  });
  if (!serialized) return String(value ?? "");
  const bounded = serialized.length > 20_000 ? `${serialized.slice(0, 20_000)}…` : serialized;
  try { return JSON.parse(bounded); } catch { return bounded; }
}

function messageTextFrom(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const type = (block as { type?: unknown }).type;
      if (type !== "text") return "";
      return String((block as { text?: unknown }).text ?? "");
    })
    .filter(Boolean)
    .join("");
}

function buildSystemPrompt(): string {
  return [
    "You are Pi Home Agent, a careful Home Assistant operations and coding agent.",
    "Use read-only capabilities to inspect the system before proposing changes. Use the smallest scoped operation that satisfies the request.",
    "Never claim that a mutation succeeded until its tool reports success. Approval requests are part of the workflow; explain what will change and wait for the user when approval is required.",
    "Configuration writes are limited to the Home Assistant configuration directory, are checkpointed, and are validated before success. Do not access secrets, .storage, arbitrary host paths, or credentials.",
    "For an unfamiliar Home Assistant operation, search the HA-MCP catalog first and call only the discovered tool needed for the task.",
    "Keep the user informed with concise intent, risk, validation, and rollback details.",
  ].join("\n");
}
