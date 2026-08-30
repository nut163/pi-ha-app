# Security boundaries

Pi Home Agent is an administrative App. Treat provider prompts, MCP metadata,
Home Assistant labels, logs, and configuration content as untrusted input.

## Identity and transport

- The production server accepts traffic from the Home Assistant Ingress address
  (`172.30.32.2`) and uses the `X-Remote-User-*` identity headers.
- The development server permits localhost so the UI can be developed without a
  Supervisor proxy. Set `NODE_ENV=production` or
  `PI_HOME_AGENT_INGRESS_ONLY=true` in a deployed process.
- Mutating requests enforce a same-host Origin check when an Origin header is
  present.
- The App does not publish a host port in its manifest; Ingress is the intended
  presentation surface.

## Filesystem

The file policy accepts only approved Home Assistant configuration areas and
rejects absolute paths, drive prefixes, `..`, NUL bytes, and symlink targets
outside the resolved `/config` root. `.storage`, secrets, token files, and
unapproved directories are not an implicit escape hatch.

File writes are bounded to 512 KiB, serialized through the transaction runner,
checkpointed, validated, and rolled back on failure. The prior content is kept
in the local checkpoint store so a later recovery tool can be added without
reconstructing history from logs.

## Credentials

Home Assistant supplies `SUPERVISOR_TOKEN` to the server process through the
App API contract. It is never included in a tool schema or browser response.
Provider keys are encrypted with AES-256-GCM under `/data`; the encryption key is
created once with restrictive permissions and is also kept in `/data`.

Approval and audit records redact common credential-shaped fields before they
are sent to the browser. The raw approval arguments remain server-side only so
an approved operation can be resumed.

## Agents and MCP

Pi's shell, edit, write, and broad filesystem tools are disabled. The custom
tool dispatcher is the only mutation path. HA-MCP is optional and lazy; MCP
annotations are treated as hints, not permission. An MCP tool that is not
known to be read-only defaults to medium risk and cannot silently bypass local
approval policy. High-risk names and destructive actions always confirm.

This is a safety boundary, not a sandbox for arbitrary code. Keep the App image,
dependencies, Home Assistant, Supervisor, AppArmor, and host patched.
