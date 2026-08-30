# Development guide

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

The server build is emitted to `dist-server` and the Vite build to `dist-web`.
The runtime is ESM and requires Node 22.19 or newer to match the Pi SDK.

## Adding a capability

1. Add a typed Core/Supervisor/MCP method to `src/ha`.
2. Add a descriptor to `DIRECT_TOOL_DESCRIPTORS`.
3. Add a deterministic classification in `src/core/risk-policy.ts`.
4. Route the operation through `ToolDispatcher`; mutations must use
   `withApproval` or `ChangeTransactionRunner`.
5. Add a TypeBox schema in `src/agent/pi-tools.ts`.
6. Add unit tests for invalid input and risk behavior, then an integration test
   for the success or rollback path.
7. Update [tool policy](tools.md) and the relevant skill guide.

Never expose a raw `fetch`, arbitrary path, shell command, or Supervisor token to
an LLM-facing tool.

## Testing seams

HTTP clients accept an injected `fetchImpl`. Transaction dependencies accept a
fake Supervisor and activity emitter. Provider tests can use a local response
fixture, and the Pi integration test uses a fake OpenAI-compatible streaming
server. Keep tests deterministic and avoid live Home Assistant or provider
accounts.

## Release

The GitHub workflow runs typecheck, unit/integration tests, and both builds before
publishing the generic multi-architecture image referenced by
`apps/home-assistant/config.yaml`. Update `apps/home-assistant/config.yaml`,
`CHANGELOG.md`, and the version in `package.json` together; publish a release tag
whose semver tag matches the App version.
