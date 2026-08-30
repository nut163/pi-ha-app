# Pi Home Agent: primary-source research

_Research snapshot: 2026-08-29. No README, Markdown documentation, or Git metadata exists in this workspace, so this report establishes `docs/research/` as the documentation location._

## Decision summary

The cleanest topology is a Node host embedding Pi, with `pi-mcp-adapter` acting as the MCP client and `ha-mcp` providing the Home Assistant tool surface:

```text
Pi SDK (Node) -> pi-mcp-adapter -> HA-MCP (Streamable HTTP/webhook) -> Home Assistant Core/Supervisor
```

Prefer the HA-MCP in-process integration when the target Core is **2026.6.0 or newer**; use the HA-MCP App on HAOS/Supervised when an App deployment is preferred; use an external HA-MCP process for Container/Core installations that cannot use the integration. Install exactly one HA-MCP server per Home Assistant instance.

## Version and runtime snapshot

| Component | Current primary-source fact | Implication |
|---|---|---|
| Pi SDK | `@earendil-works/pi-coding-agent` **0.84.4**; Node `>=22.19.0` ([npm metadata](https://www.npmjs.com/package/%40earendil-works/pi-coding-agent), [package source](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/package.json)) | The host should use Node 22.19+; this also satisfies the adapter’s Node 20 minimum. |
| MCP adapter | `pi-mcp-adapter` **2.31.0**; Node `>=20`; MCP client/core packages `2.0.0`; Pi AI peer `^0.84.1` ([npm metadata](https://www.npmjs.com/package/pi-mcp-adapter), [package source](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.31.0/package.json)) | It is a Pi extension/bridge, not a Home Assistant server. |
| HA-MCP server | `ha-mcp` **8.4.0**; Python `>=3.13,<3.15`; FastMCP `3.4.7` ([release](https://github.com/homeassistant-ai/ha-mcp/releases/tag/v8.4.0), [PyPI](https://pypi.org/project/ha-mcp/), [pyproject](https://github.com/homeassistant-ai/ha-mcp/blob/v8.4.0/pyproject.toml)) | Keep this runtime isolated from the Pi Node process unless using the supported in-process integration. |
| HA-MCP in-process integration | Current manifest **2.1.0**; minimum Home Assistant Core **2026.6.0** ([manifest](https://github.com/homeassistant-ai/ha-mcp/blob/master/custom_components/ha_mcp_tools/manifest.json), [in-process guide](https://github.com/homeassistant-ai/ha-mcp/blob/master/docs/in-process-server.md)) | It installs/updates the Python server in a worker thread and is not available on older Core versions. |
| HA-MCP App | Current repository App config is **8.4.0**, with `aarch64`/`amd64`, ingress on port **9583**, `hassio_api`, `homeassistant_api`, host networking, and Supervisor manager role ([config](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/config.yaml)) | App deployment requires Supervisor-backed HAOS or Supervised. |

## Pi SDK: usable embedding surface

The SDK’s primary factory is `createAgentSession()`. The resulting `AgentSession` exposes `prompt`, `steer`, `followUp`, event subscription, model/thinking-level changes, compaction, abort, session navigation, and disposal. Session replacement/resume/fork lifecycle belongs to `AgentSessionRuntime`. The exact exported API and option types are in the [versioned SDK guide](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/docs/sdk.md), [SDK source](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/src/core/sdk.ts), and [public exports](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/src/index.ts).

Relevant `createAgentSession` controls include `cwd`, model/runtime selection, thinking level, `tools`, `excludeTools`, `noTools`, `customTools`, resource loading, session management, and settings management. With no allowlist, Pi’s standard coding tools are `read`, `bash`, `edit`, and `write`; extensions can add tools. The SDK is the right boundary for a long-lived application service because it keeps agent state and typed events in-process. Pi also supports RPC for a subprocess boundary, but the SDK itself does not provide the MCP client needed to reach HA-MCP; that role is supplied by `pi-mcp-adapter`.

Pi extensions/packages execute with broad system access, so the final product should pin and review installed extensions and MCP server configuration ([Pi security warning](https://github.com/earendil-works/pi/blob/v0.84.4/packages/coding-agent/README.md)).

## HA-MCP: capabilities and deployment choices

The current HA-MCP project is an unofficial FastMCP server whose repository advertises an approximately 88-tool catalog. Its scope is substantially broader than entity control: the catalog and documentation cover Home Assistant state/services, configuration and registries, Supervisor/App operations, backups, HACS, diagnostics, and optional file/YAML/code-oriented features ([project README](https://github.com/homeassistant-ai/ha-mcp/blob/master/README.md), [App documentation](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/DOCS.md)). Tool search is disabled by default; enabling it compresses the catalog into search/proxy tools and is intended for clients without their own deferred-tool mechanism.

The capability split is: the **App** is the Supervisor-managed HAOS/Supervised package; **Core/Container** can use the custom in-process component or run HA-MCP externally; **Supervisor** operations use the Supervisor API and require the App’s configured role/API access; and the **MCP** surface is exposed over Streamable HTTP/webhook (with the project’s compatibility paths) rather than requiring a stdio client. The [server README](https://github.com/homeassistant-ai/ha-mcp/blob/master/README.md), [App config](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/config.yaml), and [in-process guide](https://github.com/homeassistant-ai/ha-mcp/blob/master/docs/in-process-server.md) document these as separate deployment surfaces.

The supported in-process path is a custom component. On setup it installs the `ha-mcp` package, provisions a dedicated HA admin token, starts the server on its own thread/async loop, and registers a webhook; setup runs in the background so a failed server does not block HA startup ([implementation](https://github.com/homeassistant-ai/ha-mcp/blob/master/custom_components/ha_mcp_tools/embedded_server.py), [setup lifecycle](https://github.com/homeassistant-ai/ha-mcp/blob/master/custom_components/ha_mcp_tools/embedded_setup.py)). It exposes either a webhook URL such as `/api/webhook/<id>` or a direct local endpoint using port **9584** and a random `/private_<secret>` path. It can also register the tool surface as a Home Assistant LLM API for selected conversation agents. This is powerful but means anyone allowed to use that conversation agent may receive admin-level control; the in-process guide explicitly calls out this security boundary.

The App path is for HAOS/Supervised and exposes the server on port **9583**. The App uses Supervisor authentication rather than asking the MCP client for a Home Assistant token; the random secret path is itself a credential. Do not run both the App and in-process server for the same instance. The App’s [current configuration](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/config.yaml) and [user documentation](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/DOCS.md) are the deployment authority.

## `pi-mcp-adapter`: Pi-to-MCP bridge

Install it as a Pi package with `pi install npm:pi-mcp-adapter`, or embed it with `createMcpAdapter({ config: { mcpServers: ... } })`. It reads standard MCP configuration plus Pi-specific files, starts servers lazily by default, caches metadata, and exposes one compact proxy tool instead of placing every server tool definition in the Pi context. `directTools` can selectively register individual MCP tools; `includeTools`/`excludeTools`, `toolPrefix`, `exposeResources`, lifecycle, timeout, OAuth/bearer configuration, and request headers are part of the server configuration ([adapter README](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.31.0/README.md), [configuration source](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.31.0/config.ts)).

For HA-MCP, use its `url` transport rather than a local stdio process when Pi and HA are separate. The adapter’s URL transport is Streamable HTTP with SSE fallback. Its protocol setting defaults to a legacy-compatible handshake; `auto` probes MCP `2026-07-28` and falls back, while explicitly pinning the new protocol removes legacy/SSE fallback. This gives a concrete compatibility test point for the HA-MCP endpoint rather than assuming that two “MCP” labels imply identical negotiation.

The adapter’s sampling handler is intentionally narrower than a general model API: it rejects sampling tasks involving context inclusion, tools/tool choice, stop sequences, audio, or images and handles text-only sampling with interactive approval unless auto-approved ([sampling source](https://github.com/nicobailon/pi-mcp-adapter/blob/v2.31.0/sampling-handler.ts)). Normal HA state/service tool calls do not require sampling. Leave HA-MCP’s own tool-search mode off initially so there is one discovery layer—the adapter’s proxy—instead of nested search/proxy tools; enable `directTools` only for a small, explicitly chosen subset.

## Home Assistant App contract and official MCP boundary

Home Assistant now calls add-ons “Apps.” The official App contract requires `name`, `version`, `slug`, `description`, and `arch`; relevant optional fields include `startup`, `boot`, `ports`, `host_network`, `hassio_api`, `hassio_role`, `homeassistant_api`, `map`, `options`, `schema`, and `image` ([configuration reference](https://developers.home-assistant.io/docs/apps/configuration/)).

For App-to-Core communication, enable `homeassistant_api` and use `http://supervisor/core/api/` with the `SUPERVISOR_TOKEN`; for Supervisor operations, enable `hassio_api` and use `http://supervisor/` with the same bearer token. WebSocket Core access is `ws://supervisor/core/websocket` ([communication reference](https://developers.home-assistant.io/docs/apps/communication/)). Supervisor roles matter: HA-MCP requests manager access for App/Core/add-on log and management endpoints.

Ingress is an authenticated HA UI reverse proxy, not a generic public MCP endpoint. An App sets `ingress: true`, serves the configured `ingress_port`, accepts traffic from the Supervisor ingress address, and may use `X-Ingress-Path` for its base path; HA handles user authentication ([Ingress reference](https://developers.home-assistant.io/docs/apps/presentation/)). HA-MCP’s MCP client URL is therefore its webhook or secret direct port, not the App’s UI ingress URL. Exposing the App port directly to the Internet would bypass the intended security model.

Home Assistant’s official built-in MCP integration is a different, narrower surface: `/api/mcp` (or an API-specific endpoint) is stateless Streamable HTTP around the Assist API, exposed entities, and Assist live-context resources; it supports tools/prompts but not sampling or notifications ([official MCP integration](https://www.home-assistant.io/integrations/mcp_server/)). It is a reasonable alternative if Pi Home Agent only needs Assist/entity control, but it is not a drop-in replacement for HA-MCP’s Supervisor, App, backup, HACS, configuration, and diagnostic capabilities.

## Incompatibilities and implementation constraints

- **Deployment:** the HA-MCP App needs Supervisor (HAOS/Supervised). Container/Core should use the in-process component on Core `2026.6.0+` or an external HA-MCP process; the component’s first package install can be slow, and its Python dependencies must coexist with HA’s runtime. HA-MCP deliberately vendors a private `websockets` copy, which is a warning against casually importing the server into arbitrary HA/Pi application code.
- **Version boundary:** use Node `22.19+` for Pi and Python `3.13–3.14` for HA-MCP. Validate the exact Pi/adapter/MCP SDK combination in CI; the adapter’s current peer range is Pi AI `^0.84.1`, while the SDK package observed here is `0.84.4`.
- **Transport:** test the chosen webhook/direct URL with the adapter’s default legacy mode first, then test `protocolVersion: "auto"` if negotiating the current MCP protocol is required. The HA-MCP App documentation also contains a time-sensitive warning about direct Codex HTTP initialization; treat that as an App/client compatibility check, not evidence that the Pi adapter is incompatible ([App notes](https://github.com/homeassistant-ai/ha-mcp/blob/master/homeassistant-addon/DOCS.md)).
- **Context budget:** keep the adapter’s proxy/on-demand discovery as the default. Registering all ~88 HA-MCP tools directly defeats the adapter’s token-saving design; enabling HA-MCP tool search as well creates a second proxy layer.
- **Privilege:** HA-MCP can perform administrative operations and the in-process path creates a dedicated admin token. Restrict the webhook/secret URL, avoid public port exposure, review enabled tools, and treat any HA LLM API exposure as admin access.

### Sources

Primary sources are linked inline above. The key versioned source sets are [Pi SDK v0.84.4](https://github.com/earendil-works/pi/tree/v0.84.4/packages/coding-agent), [pi-mcp-adapter v2.31.0](https://github.com/nicobailon/pi-mcp-adapter/tree/v2.31.0), and [HA-MCP v8.4.0](https://github.com/homeassistant-ai/ha-mcp/releases/tag/v8.4.0), complemented by the current HA-MCP App/in-process sources and the [official Home Assistant App documentation](https://developers.home-assistant.io/docs/apps/).
