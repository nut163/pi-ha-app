import { readFile } from "node:fs/promises";
import path from "node:path";

import { applyPatch } from "diff";
import YAML from "yaml";

import { ActivityHub } from "../core/activity-hub.js";
import { AuditLog } from "../core/audit.js";
import { ApprovalStore } from "../core/approvals.js";
import { ConfigPathPolicy } from "../core/path-policy.js";
import { RiskPolicy, type ActionClassification } from "../core/risk-policy.js";
import { ChangeTransactionRunner } from "../core/transaction.js";
import type {
  ActivityEvent,
  ApprovalRequest,
  AutonomyMode,
  HomeAssistantUser,
  ToolCallResult,
  ToolDescriptor,
  ToolExecutionResult,
} from "../core/types.js";
import { DIRECT_TOOL_DESCRIPTORS, HomeAssistantCapabilityLayer } from "../ha/capability-layer.js";

export interface ToolExecutionContext {
  sessionId: string;
  user: HomeAssistantUser;
  intent: string;
  autonomy: AutonomyMode;
  approvalAlreadyGranted?: boolean;
}

type Operation = () => Promise<ToolCallResult>;

const MAX_FILE_BYTES = 512_000;
const MAX_LOG_LINES = 2_000;

export class ToolDispatcher {
  public constructor(
    private readonly layer: HomeAssistantCapabilityLayer,
    private readonly transaction: ChangeTransactionRunner,
    private readonly approvals: ApprovalStore,
    private readonly audit: AuditLog,
    private readonly riskPolicy: RiskPolicy,
    private readonly activity: ActivityHub,
    private readonly skillsDir = path.resolve("skills"),
  ) {}

  public getDirectDescriptors(): ToolDescriptor[] {
    return DIRECT_TOOL_DESCRIPTORS;
  }

  public async getApproval(approvalId: string): Promise<ApprovalRequest | undefined> {
    return this.approvals.get(approvalId);
  }

  public async getToolDescriptors(): Promise<ToolDescriptor[]> {
    try {
      return await this.layer.directTools();
    } catch {
      return DIRECT_TOOL_DESCRIPTORS;
    }
  }

  public async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    try {
      switch (toolName) {
        case "ha_get_overview":
          return this.readResult("overview", await this.layer.getOverview());
        case "ha_get_state":
          return this.readResult("state", await this.layer.core.getState(requiredString(args, "entity_id")));
        case "ha_get_services":
          return this.readResult("services", await this.layer.core.getServices());
        case "ha_render_template":
          return this.readResult("template", await this.layer.core.renderTemplate(requiredString(args, "template")));
        case "ha_list_entities":
          return this.readResult("entities", await this.layer.listEntities(optionalString(args, "query")));
        case "ha_list_unavailable":
          return this.readResult("unavailable", await this.layer.listUnavailable());
        case "ha_get_logs":
          return this.textResult("logs", await this.layer.logs(optionalString(args, "target") || "core", boundedNumber(args.lines, 200, MAX_LOG_LINES)));
        case "ha_read_file":
          return this.textResult("file", await this.readBoundedFile(requiredString(args, "path")));
        case "ha_list_files":
          return this.readResult("files", await this.layer.listFiles(optionalString(args, "path"), args.recursive === true));
        case "ha_search_tools":
          return this.readResult("tools", await this.searchMcp(optionalString(args, "query"), boundedNumber(args.max_results, 5, 10)));
        case "ha_get_skill_guide":
          return this.textResult("skill", await this.readSkillGuide(requiredString(args, "name")));
        case "ha_get_health":
          return this.readResult("health", await this.layer.getHealthChecks());
        case "ha_list_apps":
          return this.readResult("apps", await this.layer.listApps());
        case "ha_list_backups":
          return this.readResult("backups", await this.layer.listBackups());
        case "ha_call_service":
          return this.withApproval(toolName, args, context, async () => this.successResult(
            "service",
            await this.layer.callService(requiredString(args, "domain"), requiredString(args, "service"), record(args.data)),
            "Home Assistant service completed.",
          ));
        case "ha_write_file":
          return this.transaction.writeFile({
            sessionId: context.sessionId,
            user: context.user,
            intent: context.intent,
            path: requiredString(args, "path"),
            content: boundedString(args.content, MAX_FILE_BYTES, "content"),
            autonomy: context.autonomy,
            toolName,
          });
        case "ha_apply_patch":
          return this.applyConfigurationPatch(args, context);
        case "ha_create_automation":
          return this.createAutomation(args, context);
        case "ha_reload_automations":
          return this.withApproval(toolName, args, context, async () => this.successResult(
            "reload",
            await this.layer.callService("automation", "reload", {}),
            "Automations reloaded.",
          ));
        case "ha_restart_core":
          return this.withApproval(toolName, args, context, async () => {
            const validation = await this.layer.checkConfig();
            if (isInvalidValidation(validation)) throw new Error(validationMessage(validation));
            return this.successResult("restart", await this.layer.restartCore(), "Home Assistant Core restart requested after validation passed.");
          });
        case "ha_create_backup":
          return this.withApproval(toolName, args, context, async () => this.successResult(
            "backup",
            await this.layer.createBackup(optionalString(args, "name") || `Pi Agent checkpoint ${new Date().toISOString()}`),
            "Supervisor checkpoint backup requested.",
          ));
        case "ha_app_logs":
          return this.textResult("app-logs", await this.layer.logs(requiredString(args, "slug"), boundedNumber(args.lines, 200, MAX_LOG_LINES)));
        case "ha_start_app":
        case "ha_stop_app":
        case "ha_restart_app":
        case "ha_update_app":
        case "ha_uninstall_app":
          return this.appAction(toolName, args, context);
        case "ha_install_app":
          return this.withApproval(toolName, args, context, async () => this.successResult(
            "install-app",
            await this.layer.installApp(requiredSlug(args)),
            `Home Assistant App '${requiredSlug(args)}' installation requested.`,
          ));
        case "ha_call_tool":
          return this.callMcpTool(args, context);
        default:
          throw new Error(`Unknown Home Assistant tool '${toolName}'. Search the tool catalog before calling it.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.audit.record({
        sessionId: context.sessionId,
        user: context.user,
        requestedIntent: context.intent,
        tool: toolName,
        operation: this.riskPolicy.classify(toolName, args).operation,
        target: this.riskPolicy.classify(toolName, args).target,
        risk: this.riskPolicy.classify(toolName, args).risk,
        approval: "not-required",
        result: "failure",
        rollbackStatus: "not-needed",
        error: detail,
      });
      this.activity.emit({
        sessionId: context.sessionId,
        kind: "error",
        title: `${toolName} failed`,
        detail,
        status: "error",
        target: this.riskPolicy.classify(toolName, args).target,
        risk: this.riskPolicy.classify(toolName, args).risk,
      });
      return {
        content: `The operation failed: ${detail}`,
        activity: { kind: "error", title: `${toolName} failed`, status: "error", detail },
      };
    }
  }

  public async resolveApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    user: HomeAssistantUser,
    autonomy: AutonomyMode,
  ): Promise<ToolExecutionResult> {
    const approval = await this.approvals.get(approvalId);
    if (!approval || approval.status !== "pending") {
      return { content: "That approval is no longer pending." };
    }
    if (!user.isAdmin && approval.user.id !== user.id) {
      return { content: "Only the requesting user or a Home Assistant administrator can resolve this approval." };
    }
    const resolved = await this.approvals.resolve(approvalId, decision);
    if (!resolved) return { content: "The approval could not be resolved." };
    if (decision === "rejected") {
      await this.audit.record({
        sessionId: approval.sessionId,
        user,
        requestedIntent: "Approval rejected",
        tool: approval.toolName,
        operation: approval.operation,
        target: approval.target,
        risk: approval.risk,
        approval: "rejected",
        result: "rejected",
        rollbackStatus: "not-needed",
      });
      this.activity.emit({
        sessionId: approval.sessionId,
        kind: "approval",
        title: `Rejected ${approval.operation}`,
        detail: approval.target,
        status: "warning",
        risk: approval.risk,
        target: approval.target,
      });
      return { content: `Rejected: ${approval.operation} on ${approval.target}.` };
    }

    this.activity.emit({
      sessionId: approval.sessionId,
      kind: "approval",
      title: `Approved ${approval.operation}`,
      detail: approval.target,
      status: "running",
      risk: approval.risk,
      target: approval.target,
    });
    if (approval.toolName === "ha_write_file" || approval.toolName === "ha_apply_patch") {
      return this.transaction.executeApprovedFileWrite(approval, autonomy);
    }
    const result = await this.execute(approval.toolName, approval.arguments, {
      sessionId: approval.sessionId,
      user,
      intent: `Approved: ${approval.explanation}`,
      autonomy,
      approvalAlreadyGranted: true,
    });
    return result;
  }

  private async applyConfigurationPatch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const requestedPath = requiredString(args, "path");
    const patch = boundedString(args.patch, MAX_FILE_BYTES, "patch");
    const current = await this.layer.readFile(requestedPath).catch((error) => {
      if (isNotFound(error)) return "";
      throw error;
    });
    const updated = applyPatch(current, patch);
    if (updated === false) throw new Error("The patch did not apply cleanly to the current file. Read it again and regenerate a narrow patch.");
    return this.transaction.writeFile({
      sessionId: context.sessionId,
      user: context.user,
      intent: context.intent,
      path: requestedPath,
      content: updated,
      autonomy: context.autonomy,
      toolName: "ha_apply_patch",
    });
  }

  private async createAutomation(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const automation = args.automation;
    if (!automation || typeof automation !== "object" || Array.isArray(automation)) {
      throw new Error("automation must be a YAML object containing trigger, condition, and action fields.");
    }
    const existingText = await this.layer.readFile("automations.yaml").catch((error) => {
      if (isNotFound(error)) return "[]";
      throw error;
    });
    const existing = YAML.parse(existingText) ?? [];
    if (!Array.isArray(existing)) throw new Error("automations.yaml must contain a YAML list before a new automation can be added.");
    const content = YAML.stringify([...existing, automation]);
    return this.transaction.writeFile({
      sessionId: context.sessionId,
      user: context.user,
      intent: context.intent,
      path: "automations.yaml",
      content,
      autonomy: context.autonomy,
      toolName: "ha_create_automation",
    });
  }

  private async appAction(toolName: string, args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const action = toolName.replace("ha_", "") as "start_app" | "stop_app" | "restart_app" | "update_app" | "uninstall_app";
    const supervisorAction = action.replace("_app", "") as "start" | "stop" | "restart" | "update" | "uninstall";
    const slug = requiredSlug(args);
    return this.withApproval(toolName, args, context, async () => this.successResult(
      "app",
      await this.layer.appAction(slug, supervisorAction),
      `Home Assistant App '${slug}' ${supervisorAction} requested.`,
    ));
  }

  private async callMcpTool(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const name = requiredString(args, "name");
    const callArguments = record(args.arguments ?? args.args);
    const descriptor = await this.findMcpDescriptor(name);
    const classification = this.mcpClassification(name, callArguments, descriptor);
    return this.withApprovalClassification(name, callArguments, context, classification, async () => this.successResult(
      "mcp",
      await this.layer.callMcpTool(name, callArguments),
      `Home Assistant MCP tool '${name}' completed.`,
    ));
  }

  private async withApproval(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    operation: Operation,
  ): Promise<ToolExecutionResult> {
    return this.withApprovalClassification(toolName, args, context, this.riskPolicy.classify(toolName, args), operation);
  }

  private async withApprovalClassification(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    classification: ActionClassification,
    operation: Operation,
  ): Promise<ToolExecutionResult> {
    if (!context.approvalAlreadyGranted && this.riskPolicy.requiresApproval(context.autonomy, classification)) {
      const approval = await this.approvals.create({
        sessionId: context.sessionId,
        user: context.user,
        title: `Approve ${classification.operation}`,
        explanation: classification.explanation,
        operation: classification.operation,
        target: classification.target,
        risk: classification.risk,
        toolName,
        arguments: args,
      });
      await this.audit.record({
        sessionId: context.sessionId,
        user: context.user,
        requestedIntent: context.intent,
        tool: toolName,
        operation: classification.operation,
        target: classification.target,
        risk: classification.risk,
        approval: "pending",
        result: "pending",
        rollbackStatus: "available",
      });
      this.activity.emit({
        sessionId: context.sessionId,
        kind: "approval",
        title: `Approval required: ${classification.operation}`,
        detail: classification.explanation,
        status: "pending",
        risk: classification.risk,
        target: classification.target,
        metadata: { approvalId: approval.id },
      });
      return { approvalRequired: true, approval };
    }
    try {
      const result = await operation();
      await this.audit.record({
        sessionId: context.sessionId,
        user: context.user,
        requestedIntent: context.intent,
        tool: toolName,
        operation: classification.operation,
        target: classification.target,
        risk: classification.risk,
        approval: context.approvalAlreadyGranted ? "approved" : "not-required",
        result: "success",
        rollbackStatus: "not-needed",
      });
      this.activity.emit({
        sessionId: context.sessionId,
        kind: activityKindFor(toolName),
        title: `${classification.operation} completed`,
        status: "success",
        risk: classification.risk,
        target: classification.target,
      });
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.audit.record({
        sessionId: context.sessionId,
        user: context.user,
        requestedIntent: context.intent,
        tool: toolName,
        operation: classification.operation,
        target: classification.target,
        risk: classification.risk,
        approval: "not-required",
        result: "failure",
        rollbackStatus: "not-needed",
        error: detail,
      });
      throw error;
    }
  }

  private async searchMcp(query: string, maxResults: number): Promise<ToolDescriptor[]> {
    try {
      return await this.layer.searchMcpTools(query, maxResults);
    } catch {
      return [];
    }
  }

  private async findMcpDescriptor(name: string): Promise<ToolDescriptor | undefined> {
    try {
      const matches = await this.layer.searchMcpTools(name, 10);
      return matches.find((item) => item.name === name);
    } catch {
      return undefined;
    }
  }

  private mcpClassification(name: string, args: Record<string, unknown>, descriptor?: ToolDescriptor): ActionClassification {
    const base = this.riskPolicy.classify(name, args);
    if (descriptor?.readOnly) return { ...base, risk: "READ", alwaysConfirm: false, explanation: `Read-only Home Assistant MCP operation '${name}'.` };
    return {
      ...base,
      risk: descriptor?.risk === "HIGH" ? "HIGH" : descriptor?.risk === "LOW" ? "LOW" : "MEDIUM",
      alwaysConfirm: descriptor?.risk !== "READ",
      explanation: descriptor ? `${descriptor.description} This MCP operation is classified as ${descriptor.risk} risk.` : "This Home Assistant MCP operation is not in the local catalog yet, so it requires confirmation.",
      operation: `MCP ${name}`,
      target: descriptor?.title ?? name,
    };
  }

  private async readBoundedFile(relativePath: string): Promise<string> {
    const content = await this.layer.readFile(relativePath);
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      return `${content.slice(0, MAX_FILE_BYTES)}\n\n[truncated at ${MAX_FILE_BYTES} bytes]`;
    }
    return content;
  }

  private async readSkillGuide(name: string): Promise<string> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error("Skill names may contain only letters, numbers, and hyphens.");
    const root = path.resolve(this.skillsDir);
    const file = path.resolve(root, name, "SKILL.md");
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Skill path is outside the bundled skill directory.");
    const content = await readFile(file, "utf8");
    return content.length > MAX_FILE_BYTES ? `${content.slice(0, MAX_FILE_BYTES)}\n\n[truncated]` : content;
  }

  private readResult(label: string, value: unknown): ToolCallResult {
    return { content: `${label}:\n${stringify(value)}`, structured: value };
  }

  private textResult(label: string, value: string): ToolCallResult {
    return { content: `${label}:\n${value}`, structured: value };
  }

  private successResult(label: string, value: unknown, message: string): ToolCallResult {
    return { content: `${message}\n${label}:\n${stringify(value)}`, structured: value };
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function boundedString(value: unknown, maxBytes: number, key: string): string {
  if (typeof value !== "string") throw new Error(`${key} is required.`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${key} is larger than the ${maxBytes}-byte safety limit.`);
  return value;
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(1, Math.min(maximum, number));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredSlug(args: Record<string, unknown>): string {
  const slug = optionalString(args, "slug") || optionalString(args, "app");
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) throw new Error("A valid Home Assistant App slug is required.");
  return slug;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isInvalidValidation(value: Record<string, unknown>): boolean {
  return value.valid === false || value.result === false || value.result === "invalid";
}

function validationMessage(value: Record<string, unknown>): string {
  return String(value.message ?? value.error ?? "Home Assistant configuration validation failed.");
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function activityKindFor(toolName: string): ActivityEvent["kind"] {
  if (toolName.includes("service")) return "service-call";
  if (toolName.includes("restart")) return "restart";
  if (toolName.includes("backup")) return "backup";
  if (toolName.includes("app")) return "tool-execution";
  return "validation";
}
