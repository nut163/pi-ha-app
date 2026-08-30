# Architecture

```text
Home Assistant Ingress
          │ identity headers / websocket-capable HTTP
          ▼
 React UI ─────── native HTTP + SSE API ─────── Pi Home Agent server
                                                     │
                 ┌───────────────────────────────────┼──────────────────┐
                 ▼                                   ▼                  ▼
        Pi AgentSession                     capability layer       persistent /data
        + custom tools                      Core/Supervisor        state, sessions,
                 │                          + scoped files          approvals, audit
                 ▼                                   │
        provider ModelRuntime                         ├─ direct HA APIs
                                                     └─ optional HA-MCP
                                                        Streamable HTTP
```

## Runtime composition

`AppContext` owns one process-wide capability and persistence boundary. Each
browser conversation maps to a durable UI session record and a Pi
`SessionManager` transcript. Pi receives only the custom Home Assistant tools;
the built-in shell and broad filesystem tools are disabled.

The `ToolDispatcher` is the single policy gate. It validates inputs, classifies
risk, creates an approval request when required, calls the capability layer, and
records the outcome. `ChangeTransactionRunner` is a deeper gate for file writes:
it owns path validation, checkpointing, optional Supervisor backup, validation,
and restoration.

## Direct API versus HA-MCP

The direct path is used for operations where a typed target and deterministic
rollback matter: Core state, services, logs, Supervisor App actions, backups,
and configuration files. HA-MCP is discovered lazily, cached in `/data`, and
exposed through one `ha_search_tools` plus one `ha_call_tool` surface. The agent
does not load the full MCP catalog into every prompt.

When HA-MCP is absent, the direct path continues to work and Health reports MCP
as unavailable. When its catalog is present, read-only annotations remain
read-only; unknown or mutating MCP calls require confirmation by default.

## Recovery and lifecycle

1. The App starts and reads only `/data` state plus the mapped `/config` path.
2. Health and capability discovery are best effort; a failed dependency is
   visible as degraded instead of preventing the UI from opening.
3. Each prompt runs through a per-session lock so two requests cannot mutate the
   same transcript concurrently.
4. Home Assistant restart and App actions are reported as requested operations;
   the UI can refresh health after the service returns.
5. State writes are atomic and session writes are queued to avoid Windows rename
   races as well as ordinary process concurrency.
