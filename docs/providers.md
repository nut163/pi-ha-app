# Provider setup

The onboarding flow supports four provider kinds:

| Kind | Default URL | API shape | Key |
| --- | --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | Anthropic Messages | required |
| OpenAI | `https://api.openai.com/v1` | OpenAI Chat Completions | required |
| OpenAI-compatible | `http://localhost:11434/v1` | OpenAI Chat Completions | optional |
| Local / Ollama | `http://localhost:11434/v1` | OpenAI Chat Completions | optional |

The provider test performs one small streaming completion and reports three
checks: endpoint reachability, model acceptance, and a non-empty streaming
response. A successful test is recommended but not required for saving a profile
because local gateways may be offline during setup.

Pi's `ModelRuntime` receives a single process-local provider registration. The
key is supplied through an environment interpolation that is populated only by
the server after decrypting `/data/secrets.enc.json`; it is not stored in
`state.json`, the browser, session UI records, or audit entries.

Use a provider URL reachable from the App container. `localhost` means the App
container itself, not the Home Assistant host; use a LAN address or a supported
internal gateway when the model runs elsewhere.
