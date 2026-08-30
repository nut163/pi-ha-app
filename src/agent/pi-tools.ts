import { defineTool, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";

import type { ToolExecutionResult } from "../core/types.js";
import { ToolDispatcher, type ToolExecutionContext } from "./tool-dispatcher.js";

const empty = Type.Object({});
const query = Type.Object({ query: Type.Optional(Type.String({ maxLength: 200 })) });
const pathQuery = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 500 }),
  recursive: Type.Optional(Type.Boolean()),
});
const logs = Type.Object({
  target: Type.Optional(Type.String({ maxLength: 200 })),
  lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
});
const app = Type.Object({ slug: Type.String({ minLength: 1, maxLength: 150 }) });

export function createPiTools(
  dispatcher: ToolDispatcher,
  context: () => ToolExecutionContext,
): ToolDefinition[] {
  const execute = <T extends TSchema>(
    name: string,
    title: string,
    description: string,
    parameters: T,
    run: (params: Static<T>) => Promise<ToolExecutionResult>,
  ): ToolDefinition => defineTool({
    name,
    label: title,
    description,
    promptSnippet: `${title}: ${description}`,
    parameters,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      // The SDK supplies validated params to the function below. Keeping the
      // wrapper tiny makes every tool go through the same dispatcher and the
      // same policy/audit path.
      return toPiResult(await run(params));
    },
  });

  const run = (name: string, params: Record<string, unknown>): Promise<ToolExecutionResult> =>
    dispatcher.execute(name, params, context());

  return [
    execute("ha_get_overview", "Get overview", "Read the Home Assistant overview and capability status.", empty, () => run("ha_get_overview", {})),
    execute("ha_get_state", "Get entity state", "Read one entity's current state and attributes.", Type.Object({ entity_id: Type.String({ minLength: 1, maxLength: 300 }) }), (params) => run("ha_get_state", params)),
    execute("ha_get_services", "List services", "Read the Home Assistant service registry.", empty, () => run("ha_get_services", {})),
    execute("ha_render_template", "Render template", "Evaluate a Home Assistant template without changing state.", Type.Object({ template: Type.String({ minLength: 1, maxLength: 20_000 }) }), (params) => run("ha_render_template", params)),
    execute("ha_list_entities", "List entities", "Find Home Assistant entities by name, domain, or state.", query, (params) => run("ha_list_entities", params)),
    execute("ha_list_unavailable", "List unavailable", "Find unavailable and unknown entities.", empty, () => run("ha_list_unavailable", {})),
    execute("ha_get_logs", "Read logs", "Read recent Home Assistant or App logs.", logs, (params) => run("ha_get_logs", params)),
    execute("ha_read_file", "Read config file", "Read a scoped Home Assistant configuration file.", Type.Object({ path: Type.String({ minLength: 1, maxLength: 500 }) }), (params) => run("ha_read_file", params)),
    execute("ha_list_files", "List config files", "List files in a scoped Home Assistant configuration area.", pathQuery, (params) => run("ha_list_files", params)),
    execute("ha_search_tools", "Search HA tools", "Search the lazy HA-MCP catalog for a relevant tool.", Type.Object({ query: Type.Optional(Type.String({ maxLength: 200 })), max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })) }), (params) => run("ha_search_tools", params)),
    execute("ha_get_skill_guide", "Load skill guide", "Load a domain-specific Home Assistant workflow guide on demand.", Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }) }), (params) => run("ha_get_skill_guide", params)),
    execute("ha_get_health", "Get health", "Inspect Home Assistant, Supervisor, filesystem, backup, and MCP health.", empty, () => run("ha_get_health", {})),
    execute("ha_list_apps", "List Apps", "List installed Home Assistant Apps.", empty, () => run("ha_list_apps", {})),
    execute("ha_list_backups", "List backups", "List available Home Assistant backups.", empty, () => run("ha_list_backups", {})),
    execute("ha_call_service", "Call service", "Call a Home Assistant service; approval is determined by policy.", Type.Object({
      domain: Type.String({ minLength: 1, maxLength: 100 }),
      service: Type.String({ minLength: 1, maxLength: 100 }),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }), (params) => run("ha_call_service", params)),
    execute("ha_write_file", "Write config file", "Write a scoped, checkpointed, validated configuration file.", Type.Object({
      path: Type.String({ minLength: 1, maxLength: 500 }),
      content: Type.String({ maxLength: 512_000 }),
    }), (params) => run("ha_write_file", params)),
    execute("ha_apply_patch", "Apply config patch", "Apply a narrow unified patch to a scoped configuration file.", Type.Object({
      path: Type.String({ minLength: 1, maxLength: 500 }),
      patch: Type.String({ maxLength: 512_000 }),
    }), (params) => run("ha_apply_patch", params)),
    execute("ha_create_automation", "Create automation", "Append a validated automation to automations.yaml.", Type.Object({ automation: Type.Record(Type.String(), Type.Unknown()) }), (params) => run("ha_create_automation", params)),
    execute("ha_reload_automations", "Reload automations", "Reload Home Assistant automations after a change.", empty, () => run("ha_reload_automations", {})),
    execute("ha_restart_core", "Restart Home Assistant", "Validate and request a Home Assistant Core restart.", empty, () => run("ha_restart_core", {})),
    execute("ha_create_backup", "Create checkpoint", "Create a Supervisor checkpoint backup.", Type.Object({ name: Type.Optional(Type.String({ maxLength: 200 })) }), (params) => run("ha_create_backup", params)),
    execute("ha_app_logs", "Read App logs", "Read logs for one installed Home Assistant App.", logsWithSlug(), (params) => run("ha_app_logs", params)),
    execute("ha_start_app", "Start App", "Start an installed Home Assistant App.", app, (params) => run("ha_start_app", params)),
    execute("ha_stop_app", "Stop App", "Stop an installed Home Assistant App.", app, (params) => run("ha_stop_app", params)),
    execute("ha_restart_app", "Restart App", "Restart an installed Home Assistant App.", app, (params) => run("ha_restart_app", params)),
    execute("ha_update_app", "Update App", "Update an installed Home Assistant App.", app, (params) => run("ha_update_app", params)),
    execute("ha_uninstall_app", "Uninstall App", "Uninstall an App after explicit confirmation.", app, (params) => run("ha_uninstall_app", params)),
    execute("ha_install_app", "Install App", "Install an App from the Supervisor store.", app, (params) => run("ha_install_app", params)),
    execute("ha_call_tool", "Call discovered tool", "Call one discovered HA-MCP tool after deterministic risk checks.", Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200 }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }), (params) => run("ha_call_tool", params)),
  ];
}

function logsWithSlug() {
  return Type.Object({
    slug: Type.String({ minLength: 1, maxLength: 150 }),
    lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })),
  });
}

function toPiResult(result: ToolExecutionResult): AgentToolResult<Record<string, unknown>> {
  if ("approvalRequired" in result) {
    return {
      content: [{
        type: "text" as const,
        text: `Approval required. Request ${result.approval.id}: ${result.approval.explanation} Target: ${result.approval.target}.`,
      }],
      details: {
        approvalRequired: true,
        approvalId: result.approval.id,
        risk: result.approval.risk,
        target: result.approval.target,
      },
    };
  }
  return {
    content: [{ type: "text" as const, text: result.content }],
    details: {
      structured: result.structured,
      activity: result.activity,
      diff: result.diff,
    },
  };
}
