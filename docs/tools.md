# Tool policy

## Direct tools

Read-only direct tools include overview, entity/state lookup, services,
templates, logs, approved files, health, Apps, backups, tool search, and skill
guides. Mutating direct tools include service calls, file writes, patches,
automation creation/reload, Core restart, backups, and App lifecycle actions.

## Risk levels

- `READ`: no change; never needs approval.
- `LOW`: narrow, reversible change such as a `www` file or automation edit.
- `MEDIUM`: service calls, core configuration, restart, backups, and App lifecycle
  actions.
- `HIGH`: deletion, uninstall, restore, security/auth changes, secrets, and
  storage outside the normal YAML workflow.

Guided mode asks before all mutations. Balanced mode asks before medium and high
risk. Autonomous mode may proceed with low and medium risk, but high risk and
always-confirm operations still stop. The policy is deterministic and does not
depend on the model's prose.

## Lazy HA-MCP

`ha_search_tools` searches cached metadata. The model should search before
calling an unfamiliar capability, then use `ha_call_tool` with the exact name
and arguments. Read-only annotations can lower a call to `READ`; unknown or
mutating calls require confirmation. Full schemas are not loaded into the base
prompt.
