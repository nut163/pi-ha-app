# Troubleshooting

## The UI says Home Assistant is unavailable

Open Health and inspect Core, Supervisor, filesystem, and provider separately.
Inside the App, verify the App has `homeassistant_api: true`, `hassio_api: true`,
and `hassio_role: manager`. Check App logs through Supervisor. A local process
needs `HOMEASSISTANT_URL` and `SUPERVISOR_TOKEN` or will intentionally report a
degraded Home Assistant connection.

## The provider test fails

Confirm the URL is reachable from the App container and that the model name is
valid for that gateway. For Anthropic, use the account's API key and a Messages
compatible model. For OpenAI-compatible/local providers, include the `/v1`
path when the gateway expects it. Check that a proxy is not stripping streaming
responses.

## A change was rolled back

Read the rollback entry in Changes & audit and the validation error. The prior
file content was restored before the tool reported failure. Fix the YAML or
configuration issue, reload the file, and submit a smaller patch. Do not retry a
Core restart until configuration validation passes.

## HA-MCP is unavailable

HA-MCP is optional. Set `HA_MCP_URL` to its Streamable HTTP endpoint or install
the HA-MCP App so Supervisor discovery can find its secret path. Health will show
the endpoint detail. Direct Core/Supervisor tools remain available without it.

## The App restarted during a change

Supervisor action calls and file checkpoints are durable under `/data`. After the
App returns, inspect Health, Changes & audit, the local checkpoint directory,
and Supervisor backups. A pending approval is not automatically executed after
restart; it must be explicitly resolved again.
