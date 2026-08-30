---
name: ha-automations
description: Read, explain, create, and safely reload Home Assistant automations.
---

# Automation workflow

Read `automations.yaml` before editing. Preserve existing list entries, append
only the requested automation, and validate YAML. Show the proposed behavior
and risk before writing. Reload with `ha_reload_automations` only after the file
transaction reports validation success.
