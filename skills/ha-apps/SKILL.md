---
name: ha-apps
description: Inspect and manage Home Assistant Apps through Supervisor.
---

# App operations

Use `ha_list_apps` before acting on a slug. Logs and status are read-only. Start,
stop, restart, update, install, and uninstall are mutations; explain impact and
wait for approval whenever policy requires it. Confirm the exact App slug.
