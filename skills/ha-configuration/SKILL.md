---
name: ha-configuration
description: Plan and validate Home Assistant configuration changes.
---

# Configuration workflow

Use `ha_read_file` before a write. Limit work to approved configuration paths.
For `configuration.yaml`, packages, or custom components, run configuration
validation and treat any failure as a rollback condition. Do not edit secrets,
`.storage`, or arbitrary host files.
