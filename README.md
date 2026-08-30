# Pi Home Agent

Pi Home Agent is a Home Assistant App that gives a coding-agent workflow a
safe, visible control plane: understand the system, choose a scoped capability,
show the impact, ask for approval when needed, validate the result, and keep a
way back.

## What is implemented

- Pi SDK sessions with durable transcripts and a browser chat stream.
- Direct Home Assistant Core and Supervisor capability clients.
- Optional lazy HA-MCP discovery and tool calls through Streamable HTTP.
- Read-only overview, entity search, state inspection, service registry,
  template rendering, logs, files, Apps, backups, health, and skills.
- Scoped configuration access under `/config`; traversal and symlink escapes
  are rejected.
- Deterministic `READ`, `LOW`, `MEDIUM`, and `HIGH` risk classification with
  guided, balanced, and autonomous modes.
- Approval cards for impactful operations, redacted UI payloads, audit JSONL,
  local checkpoints, optional Supervisor partial backups, YAML validation, and
  rollback on validation failure.
- Home Assistant Ingress UI, first-run onboarding, provider streaming test,
  activity trace, audit history, health view, and settings.

## Local development

Requires Node `22.19+`.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The Vite UI runs at `http://localhost:5173` and proxies `/api` to the server at
`http://localhost:8099`. On Windows, the server defaults to `.ha-config` for a
development Home Assistant configuration directory and `/data` for persistent
state; override both paths when needed:

```powershell
$env:PI_HOME_AGENT_DATA_DIR = "$PWD\.local-data"
$env:HOMEASSISTANT_CONFIG = "$PWD\.ha-config"
npm run dev
```

The Home Assistant APIs are intentionally unavailable in a plain local process
unless `HOMEASSISTANT_URL` and a token are supplied. The UI still exposes the
degraded health state and can be tested with a local provider.

## Home Assistant App

Add the repository URL from `repository.yaml` to Supervisor, then install **Pi
Home Agent** from the App store. The App uses Ingress on port `8099`, requests
the Core and Supervisor APIs, and maps the Home Assistant configuration directory
to `/config`. It does not use host networking or arbitrary host mounts.

For a local image build from the repository root:

```bash
docker build -f Dockerfile -t pi-home-agent:dev .
```

See [Home Assistant operations](docs/home-assistant.md) and [troubleshooting](docs/troubleshooting.md)
for installation and recovery details.

## Safety model

Pi may read only approved configuration areas such as `configuration.yaml`,
`automations.yaml`, `scripts.yaml`, `scenes.yaml`, `www`, `custom_components`,
`packages`, and `blueprints`. `.storage`, secrets, arbitrary host paths, and
credential files are outside the tool boundary.

All writes are transactions. A write records the previous content, creates a
local checkpoint, optionally asks Supervisor for a partial backup, writes the
candidate, validates YAML and relevant Home Assistant configuration, and restores
the prior content if validation fails. A tool result is not reported as success
until that sequence completes.

The agent never receives the Supervisor token or provider key as a tool
argument. Provider keys are encrypted in `/data/secrets.enc.json` using a key in
`/data/.secret-key`; the browser only receives whether a key is configured.

Read [the architecture](docs/architecture.md), [security boundaries](docs/security.md),
and [tool policy](docs/tools.md) before enabling autonomous mode.

## Research basis

The implementation follows the current Pi SDK, Home Assistant App, Supervisor,
HA-MCP, and `pi-mcp-adapter` contracts recorded in
[`docs/research/pi-home-agent-research.md`](docs/research/pi-home-agent-research.md).
The direct API layer is deliberate: it keeps safety-critical operations typed
and auditable while preserving HA-MCP as an optional, lazy capability surface.
