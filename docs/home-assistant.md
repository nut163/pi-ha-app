# Home Assistant integration

The App uses the official internal App communication surfaces:

- Core REST: `http://supervisor/core/api` with `SUPERVISOR_TOKEN`.
- Supervisor API: `http://supervisor` with the same token and `hassio_api` /
  `hassio_role: manager`.
- Ingress: application port `8099`, streaming enabled, no second login page.
- Configuration mapping: `/config` with writes enabled for scoped transaction
  operations.
- Published image: `ghcr.io/troydev/pi-home-agent`, with the image tag matching
  the App version in `config.yaml`.

The server detects Home Assistant OS/Supervised, container, or unknown mode from
the Supervisor information available at runtime. Missing Supervisor access does
not crash startup; the Health view explains which path is unavailable.

## App settings

`apps/home-assistant/config.yaml` requests `amd64` and `aarch64`, uses Ingress,
and avoids host networking. The repository root `Dockerfile` is used by the
release workflow to produce the runtime image. The manifest points at the
generic multi-architecture image, so Supervisor selects the correct platform.
If the repository is forked or renamed, update the App URL and `image` value
before publishing.

## HA-MCP

Set `HA_MCP_URL` when a reachable HA-MCP Streamable HTTP endpoint is available.
Otherwise Pi asks Supervisor for an installed App whose slug/name identifies
HA-MCP and reads its advertised address and secret path. The catalog is cached
under `/data/ha-mcp-tools.json`; discovery is lazy and failures stay visible in
Health.

The direct path is sufficient for the core workflow. HA-MCP is valuable for
domain-specific capabilities and future extensions, but its mutating tools still
pass through Pi Home Agent approval policy.
