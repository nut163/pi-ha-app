import type { AutonomyMode, RiskLevel } from "./types.js";

export interface ActionClassification {
  risk: RiskLevel;
  operation: string;
  target: string;
  explanation: string;
  alwaysConfirm: boolean;
}

const EXACT_RISKS: Record<string, RiskLevel> = {
  ha_get_overview: "READ",
  ha_list_entities: "READ",
  ha_list_unavailable: "READ",
  ha_get_logs: "READ",
  ha_read_file: "READ",
  ha_list_files: "READ",
  ha_search_tools: "READ",
  ha_get_skill_guide: "READ",
  ha_get_health: "READ",
  ha_list_apps: "READ",
  ha_list_backups: "READ",
  ha_call_service: "MEDIUM",
  ha_write_file: "LOW",
  ha_apply_patch: "LOW",
  ha_create_automation: "LOW",
  ha_reload_automations: "LOW",
  ha_restart_core: "MEDIUM",
  ha_create_backup: "MEDIUM",
  ha_install_app: "MEDIUM",
  ha_update_app: "MEDIUM",
  ha_start_app: "MEDIUM",
  ha_stop_app: "MEDIUM",
  ha_restart_app: "MEDIUM",
  ha_uninstall_app: "HIGH",
  ha_restore_backup: "HIGH",
  ha_delete_file: "HIGH",
  ha_remove_integration: "HIGH",
  ha_manage_security: "HIGH",
};

const ALWAYS_CONFIRM = new Set([
  "ha_restart_core",
  "ha_stop_app",
  "ha_restart_app",
  "ha_uninstall_app",
  "ha_restore_backup",
  "ha_delete_file",
  "ha_remove_integration",
  "ha_manage_security",
]);

export class RiskPolicy {
  public classify(toolName: string, args: Record<string, unknown> = {}): ActionClassification {
    const risk = this.classifyRisk(toolName, args);
    const operation = this.operationName(toolName);
    const target = this.targetFor(toolName, args);
    return {
      risk,
      operation,
      target,
      alwaysConfirm: ALWAYS_CONFIRM.has(toolName) || risk === "HIGH",
      explanation: this.explanationFor(risk, operation, target),
    };
  }

  public requiresApproval(
    autonomy: AutonomyMode,
    classification: ActionClassification,
  ): boolean {
    if (classification.alwaysConfirm) return true;
    if (classification.risk === "READ") return false;
    if (autonomy === "guided") return true;
    if (autonomy === "balanced") return classification.risk === "MEDIUM";
    return false;
  }

  private classifyRisk(toolName: string, args: Record<string, unknown>): RiskLevel {
    const exact = EXACT_RISKS[toolName];
    if (exact) {
      if (toolName === "ha_write_file" || toolName === "ha_apply_patch") {
        const path = String(args.path ?? "").toLowerCase();
        if (/^(configuration|automations|scripts|scenes)\.ya?ml$/.test(path)) return "MEDIUM";
        if (path.includes(".storage") || path.includes("secrets")) return "HIGH";
      }
      return exact;
    }

    const name = toolName.toLowerCase();
    if (/(delete|remove|uninstall|restore|security|network|auth)/.test(name)) return "HIGH";
    if (/(install|update|restart|stop|start|reload|service|write|edit|create)/.test(name)) {
      return /(restart|install|update|stop|start|service)/.test(name) ? "MEDIUM" : "LOW";
    }
    return "READ";
  }

  private operationName(toolName: string): string {
    return toolName.replace(/^ha_/, "").replaceAll("_", " ");
  }

  private targetFor(toolName: string, args: Record<string, unknown>): string {
    for (const key of ["path", "entity_id", "addon", "app", "backup", "domain", "name"]) {
      const value = args[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return toolName;
  }

  private explanationFor(risk: RiskLevel, operation: string, target: string): string {
    switch (risk) {
      case "READ":
        return `Read-only inspection of ${target}.`;
      case "LOW":
        return `Reversible or low-impact ${operation} affecting ${target}.`;
      case "MEDIUM":
        return `This may change Home Assistant behavior or briefly interrupt service while ${operation} affects ${target}.`;
      case "HIGH":
        return `This is a destructive or security-sensitive ${operation} affecting ${target}.`;
    }
  }
}
