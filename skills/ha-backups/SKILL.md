---
name: ha-backups
description: Create and inspect Home Assistant checkpoint backups and local recovery points.
---

# Recovery workflow

List existing backups when recovery context matters. Create a named Supervisor
checkpoint before meaningful changes when enabled. Every local file transaction
also records a checkpoint containing the previous file content. Report whether
the checkpoint is local, Supervisor-backed, or unavailable.
