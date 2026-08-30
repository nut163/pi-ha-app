import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createTwoFilesPatch } from "diff";
import YAML from "yaml";

import { AuditLog } from "./audit.js";
import { ApprovalStore } from "./approvals.js";
import { ensureParent, writeJsonAtomic } from "./json-store.js";
import { ConfigPathPolicy } from "./path-policy.js";
import { RiskPolicy } from "./risk-policy.js";
import type {
  ActivityEvent,
  ApprovalRequest,
  AutonomyMode,
  HomeAssistantUser,
  RiskLevel,
  ToolExecutionResult,
} from "./types.js";
import type { SupervisorClient } from "../ha/supervisor-client.js";

export interface FileWriteRequest {
  sessionId: string;
  user: HomeAssistantUser;
  intent: string;
  path: string;
  content: string;
  autonomy: AutonomyMode;
  toolName?: string;
}

export interface TransactionDependencies {
  pathPolicy: ConfigPathPolicy;
  riskPolicy: RiskPolicy;
  approvals: ApprovalStore;
  audit: AuditLog;
  supervisor?: SupervisorClient;
  checkpointsDir: string;
  automaticBackups: "meaningful" | "every-change" | "never";
  emit?: (event: Omit<ActivityEvent, "id" | "createdAt">) => Promise<void> | void;
}

export class ChangeTransactionRunner {
  private automaticBackups: TransactionDependencies["automaticBackups"];

  public constructor(private readonly dependencies: TransactionDependencies) {
    this.automaticBackups = dependencies.automaticBackups;
  }

  public setAutomaticBackups(value: TransactionDependencies["automaticBackups"]): void {
    this.automaticBackups = value;
  }

  public async writeFile(request: FileWriteRequest): Promise<ToolExecutionResult> {
    const toolName = request.toolName ?? "ha_write_file";
    const classification = this.dependencies.riskPolicy.classify(toolName, { path: request.path });
    if (this.dependencies.riskPolicy.requiresApproval(request.autonomy, classification)) {
      const approval = await this.dependencies.approvals.create({
        sessionId: request.sessionId,
        user: request.user,
        title: `Change ${request.path}`,
        explanation: `${classification.explanation} The proposed file change will be validated before it is considered successful.`,
        operation: classification.operation,
        target: request.path,
        risk: classification.risk,
        toolName,
        arguments: {
          path: request.path,
          content: request.content,
          intent: request.intent,
        },
      });
      await this.dependencies.audit.record({
        sessionId: request.sessionId,
        user: request.user,
        requestedIntent: request.intent,
        tool: toolName,
        operation: classification.operation,
        target: request.path,
        risk: classification.risk,
        approval: "pending",
        result: "pending",
        rollbackStatus: "available",
      });
      await this.emit(request.sessionId, "approval", `Approval required for ${request.path}`, "pending", {
        risk: classification.risk,
        target: request.path,
        approvalId: approval.id,
      });
      return { approvalRequired: true, approval };
    }
    return this.executeFileWrite(request, classification.risk, "not-required");
  }

  public async executeApprovedFileWrite(
    approval: ApprovalRequest,
    autonomy: AutonomyMode,
  ): Promise<ToolExecutionResult> {
    const content = approval.arguments.content;
    const requestedPath = approval.arguments.path;
    const intent = approval.arguments.intent;
    if (typeof content !== "string" || typeof requestedPath !== "string" || typeof intent !== "string") {
      throw new Error("The approval payload is incomplete and cannot be executed.");
    }
    const classification = this.dependencies.riskPolicy.classify(approval.toolName, { path: requestedPath });
    if (this.dependencies.riskPolicy.requiresApproval(autonomy, classification)) {
      return this.executeFileWrite(
        {
          sessionId: approval.sessionId,
          user: approval.user,
          intent,
          path: requestedPath,
          content,
          autonomy,
          toolName: approval.toolName,
        },
        classification.risk,
        "approved",
      );
    }
    return this.executeFileWrite(
      {
        sessionId: approval.sessionId,
        user: approval.user,
        intent,
        path: requestedPath,
        content,
        autonomy,
        toolName: approval.toolName,
      },
      classification.risk,
      "approved",
    );
  }

  private async executeFileWrite(
    request: FileWriteRequest,
    risk: RiskLevel,
    approval: "not-required" | "approved",
  ): Promise<ToolExecutionResult> {
    const target = this.dependencies.pathPolicy.resolve(request.path);
    await this.dependencies.pathPolicy.assertNoSymlinkEscape(target);
    const previous = await this.readIfPresent(target);
    const diff = createTwoFilesPatch(request.path, request.path, previous ?? "", request.content);
    const checkpointId = randomUUID();
    await this.writeLocalCheckpoint(checkpointId, request, previous);

    let backupDetail: string | undefined;
    if (this.shouldCreateBackup(request.path, risk)) {
      backupDetail = await this.createBackup(request, risk);
    }

    await this.emit(request.sessionId, "file-write", `Changing ${request.path}`, "running", {
      target: request.path,
      risk,
      checkpointId,
      backup: backupDetail,
    });

    try {
      await ensureParent(target);
      await writeFile(target, request.content, { encoding: "utf8", mode: 0o600 });
      await this.validateTarget(request.path, request.content);
    } catch (error) {
      await this.restore(target, previous);
      const detail = error instanceof Error ? error.message : String(error);
      await this.dependencies.audit.record({
        sessionId: request.sessionId,
        user: request.user,
        requestedIntent: request.intent,
        tool: request.toolName ?? "ha_write_file",
        operation: "write file",
        target: request.path,
        risk,
        approval,
        beforeState: previous,
        afterState: request.content,
        result: "rolled-back",
        rollbackStatus: "performed",
        error: detail,
      });
      await this.emit(request.sessionId, "rollback", `Rolled back ${request.path}`, "error", {
        target: request.path,
        error: detail,
      });
      return {
        content: `The change to ${request.path} failed validation and was rolled back. ${detail}`,
        diff,
        activity: {
          kind: "rollback",
          title: `Rolled back ${request.path}`,
          status: "error",
          target: request.path,
        },
      };
    }

    await this.dependencies.audit.record({
      sessionId: request.sessionId,
      user: request.user,
      requestedIntent: request.intent,
      tool: request.toolName ?? "ha_write_file",
      operation: "write file",
      target: request.path,
      risk,
      approval,
      beforeState: previous,
      afterState: request.content,
      result: "success",
      rollbackStatus: "available",
    });
    await this.emit(request.sessionId, "diff", `Updated ${request.path}`, "success", {
      target: request.path,
      risk,
      diff,
      checkpointId,
      backup: backupDetail,
    });
    return {
      content: `Updated ${request.path}. Validation passed.${backupDetail ? ` ${backupDetail}` : ""}`,
      diff,
      activity: {
        kind: "file-write",
        title: `Updated ${request.path}`,
        status: "success",
        target: request.path,
        risk,
        diff,
      },
    };
  }

  private async validateTarget(relativePath: string, content: string): Promise<void> {
    if (/\.ya?ml$/i.test(relativePath)) {
      try {
        YAML.parse(content);
      } catch (error) {
        throw new Error(`YAML validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.dependencies.supervisor && this.needsHomeAssistantValidation(relativePath)) {
      const response = await this.dependencies.supervisor.checkCore();
      const valid = response.valid ?? response.result ?? true;
      if (valid === false) {
        throw new Error(String(response.message ?? "Home Assistant configuration validation failed."));
      }
    }
  }

  private needsHomeAssistantValidation(relativePath: string): boolean {
    return /^(configuration|automations|scripts|scenes|ui-lovelace|lovelace)\.ya?ml$/i.test(relativePath) ||
      relativePath.startsWith("custom_components/") ||
      relativePath.startsWith("packages/");
  }

  private shouldCreateBackup(relativePath: string, risk: RiskLevel): boolean {
    if (this.automaticBackups === "never") return false;
    if (this.automaticBackups === "every-change") return true;
    return risk === "MEDIUM" || risk === "HIGH" || /^(configuration|automations|scripts|scenes)\.ya?ml$/i.test(relativePath);
  }

  private async createBackup(request: FileWriteRequest, risk: RiskLevel): Promise<string | undefined> {
    if (!this.dependencies.supervisor) return "Local checkpoint created; Supervisor backup API is unavailable in this environment.";
    try {
      const name = `Pi Agent - Before ${request.path} - ${new Date().toISOString().slice(0, 10)}`;
      const result = await this.dependencies.supervisor.createPartialBackup({
        name,
        homeassistant: true,
        compressed: true,
        background: true,
      } as { name: string; homeassistant?: boolean; compressed?: boolean; background?: boolean });
      return `Created checkpoint backup '${name}'${result.slug ? ` (${String(result.slug)})` : ""}.`;
    } catch (error) {
      await this.emit(request.sessionId, "backup", `Supervisor backup unavailable`, "warning", {
        risk,
        error: error instanceof Error ? error.message : String(error),
      });
      return "Local checkpoint created; the Supervisor backup could not be created.";
    }
  }

  private async writeLocalCheckpoint(
    checkpointId: string,
    request: FileWriteRequest,
    previous: string | undefined,
  ): Promise<void> {
    await mkdir(this.dependencies.checkpointsDir, { recursive: true });
    await writeJsonAtomic(path.join(this.dependencies.checkpointsDir, `${checkpointId}.json`), {
      id: checkpointId,
      createdAt: new Date().toISOString(),
      sessionId: request.sessionId,
      path: request.path,
      content: previous,
    });
  }

  private async readIfPresent(target: string): Promise<string | undefined> {
    try {
      return await readFile(target, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async restore(target: string, previous: string | undefined): Promise<void> {
    if (previous === undefined) {
      try {
        await access(target);
        const { unlink } = await import("node:fs/promises");
        await unlink(target);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT") throw error;
      }
      return;
    }
    await writeFile(target, previous, { encoding: "utf8", mode: 0o600 });
  }

  private async emit(
    sessionId: string,
    kind: ActivityEvent["kind"],
    title: string,
    status: ActivityEvent["status"],
    metadata: Record<string, unknown>,
  ): Promise<void> {
      await this.dependencies.emit?.({
        sessionId,
        kind,
        title,
        status,
        metadata,
      });
  }
}
