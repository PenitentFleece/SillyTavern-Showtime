# Changelog

## 0.1.1 — Motivation who-knows, Set coherence, Cast audit, plan iconography

### Motivation · who knows / in the dark
- Replaced the crowded know-pop checklist with a Set-style punch-ticket dialog: pick a **cast member** or **affiliation**, then **Knows** or **In the dark**. Chips (× / Untrack) drop someone from both lists.
- Secret editor uses the same Assign… dialog; Cancel does not keep draft tags.
- **Invariant:** only explicit `knownBy` (knows) or `unawareBy` (in the dark) create a secret relation. Untagged parties have no Reputation connection — no implied “everyone else is in the dark.”
- Reputation Connections / web threads / chips follow that rule. Owners can still see their own secrets as owner. Sonar **Mark known** only adds explicit `knownBy` entries. The two lists stay mutually exclusive.

### Cast Stats / wardrobe / props / condition Audit
- Isolated generation via `generateRaw` (`instructOverride`, `quietToLoud`) so audits no longer ride the full chat + character card.
- Prompts are lean: ~720 characters of scene, name/role/pronouns only — no card lore or director block.
- Stats audit still requires Track enabled and only sends those trackers plus condition notes.
- 429 / “too many requests” is detected and shown as a wait-and-retry hint.
- Debounce (~1.6s) plus a busy lock so double-clicks cannot stack requests.

### Floorplan iconography
- `planMetrics` (plus wall/opening helpers) lives at the top of `dialogs.js` so the room editor and suite canvas both scale ink from the current SVG.
- Parent **suite** draws openings on every footprint edge (shared **and** exterior) with the same glyphs as the room editor: hinge + leaf + swing arc sized to the opening, window glazing ticks, arch, passage, stairs. No 4px door beads.
- Shared **Merge** is a continuous party wall. **Threshold** is a dotted walk-through (not orange dashed beads).
- Walls mode: drag a selected (or any) wall on the parent to reshape that room’s footprint edge. Arrange still moves the whole room.
- **Align** welds nearest contacting vertices onto the shared face so corners meet.
- Room-editor glyphs use the same scaled ink (thicker walls, larger door/window marks).

### Set ↔ Inventory / Library / sonar
- New rooms seed their display name as a location tag; rename keeps that tag aligned.
- `collectActiveLocationTags` includes Compass place names, so Library / Composer / sonar see a room as soon as it exists on the Set.
- Library place-tag picker also reads Compass names/tags directly.
- Sonar matches place names as well as tags, prefers loadable rooms, drops pings to deleted places, and persists when the latest chat line changes the last-known key.
- Set and Placement show a sonar check strip (last key, loaded vs pinged room, useful misses). **Check sonar** re-runs against current Compass state.
- Compass injection includes sonar last-known and lock notes. Lock matching now also sees **usable pieces placed on the Set**, not only Inventory.
- World Index and Inventory injection pick up Set clutter/furniture and mention keys that unlock the loaded room’s doors.

### Floorplan Audit (Backstage → Set)
- Deterministic sensibility check (no LLM): exterior doors on unlinked walls, missing egress, false “exit” labels, orphan/wrong shared walls, stairs without a vertical target, zero-area / tiny footprints, overlapping suite children, dead-end rooms with no opening, threshold vs door mismatch, north-label / edge-index drift, sibling scale outliers.
- Findings list severity + a short fix hint. **Fix safe** only marks unlinked door/window walls as `external` — it does not rewrite the map otherwise.
