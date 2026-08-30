---
name: ha-dashboard
description: Inspect and safely update Lovelace dashboard resources and UI assets.
---

# Dashboard workflow

Read the relevant Lovelace YAML or approved `www` asset. Prefer a narrow patch
over replacing a whole dashboard. Never touch `.storage` dashboard data or
credentials. Include a diff and validate syntax before reporting completion.
