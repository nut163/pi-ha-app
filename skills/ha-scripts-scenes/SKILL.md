---
name: ha-scripts-scenes
description: Work with Home Assistant scripts and scenes using scoped YAML changes.
---

# Scripts and scenes

Inspect `scripts.yaml` or `scenes.yaml` first. Make the smallest possible
transaction, preserve unrelated keys, validate YAML, and describe how the
change affects runtime behavior. Ask before reload or service calls when the
active autonomy mode requires it.
