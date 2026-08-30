---
name: ha-entities
description: Investigate Home Assistant entity state, attributes, and unavailable entities.
---

# Entity investigation

Search with `ha_list_entities` first, then inspect a specific entity with
`ha_get_state`. Use `ha_list_unavailable` for reliability investigations. Quote
the entity ID and distinguish an unavailable state from an unknown state.
