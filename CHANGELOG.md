# Changelog

## 1.0.0 — Pacing, needs, continuity, and a safer house

### Narrative pacing / the chat slate
- New `[SCENE|]` / `[EVENT|]` / `[ACH|]` / `[SEC|]` / `[REP|]` tag layer (`lib/chatSlate.js`) parses model-emitted lines, strips them from the visible bubble, stamps the scene board, and paints a collapsible mini-clapper — replacing ad hoc inline scanning.
- A `[TIME|+Nm]` tag (and `+Nh`, `+1h30m`) lets a reply say how much narrative time passed; the scene clock advances by that amount. No tag still nudges the clock by a small default so time is never frozen just because nobody named a clock. A gap under ~20 minutes stays on per-turn needs drift; 20+ minutes uses the larger "time passing" step. The tag never appears in the printed bubble.
- Guided Response (and any other external `/trigger`) now speaks under the name the user actually picked instead of being forced under the Cue Sheet's gold-bar slot, and the steer text no longer gets posted as the Star's own line.
- **Cue Sheet** (`lib/cueSheet.js`): an ordered-turn state machine for cast speaking order — Once / Repeat / Until Disrupted — that Cast owns end to end; it chains the rest of a pass after the first reply without re-sending the user's draft.

### Cast needs, conditions, and off-screen life
- Absent and Privy cast members with Hard Mode needs on, who are not actually named in the current scene text, now have their hunger, thirst, bladder, and hygiene settled off screen once each stat crosses an uncomfortable threshold (a meal, a drink, a bathroom break, a wash). A short notice line reports it ("Aizawa ate and washed up, off screen"); it never pollutes the `[Now]` prompt injection.
- New shared bar/condition plumbing: `lib/statBars.js` (bar definitions, thresholds, expression labels shared by Cast and the receipt), `lib/statEvents.js` (event-driven deltas shared by Cast Audit and per-turn filing), `lib/conditionCatalog.js` (condition nature × duration, source stamps, stat caps).
- Per-turn tracker filing (`lib/receipt.js`) heuristic swings and hard-mode caps were halved across the board so a single ordinary turn no longer swings a bar as hard as an explicit event.
- A **Camera Focus** dialog now appears when the Star leaves an in-progress scene (goes Absent/Privy mid-scene): keep the current cast talking, follow the Star instead, or cancel the presence change.
- `lib/castPresence.js`: automatic In play / Absent based on who is mentioned and who is in the current room. Written out stays sticky and the Star is never auto-written out.
- `lib/travelState.js`: a small scene-travel state machine (Compass "here" / Moving from-to / Unknown) that regex and sonar propose into and the receipt commits.

### Item, wardrobe, and document systems
- `lib/itemLocator.js`: a canonical item-slot model (worn / carried / inside / trunk / room / lost) with `moveItem` as the single mutation contract, used by Inventory, Cast kit, and Compass pieces alike.
- `lib/wardrobeOutfits.js`: named outfit folders — saved combinations of existing kit pieces; wearing stays per-item, and the inject still infers the best current match.
- `lib/fileCabinet.js` + `lib/fileSanitize.js`: one house-wide store of narrative HTML documents (letters, clippings, notes) attributed to a house, sanitized through DOMPurify so only classed markup survives — never scripts.
- `lib/reelSanitize.js`: Reel import is now a hard boundary — untrusted JSON can no longer land script-capable HTML or `javascript:`/SVG media URLs in chat metadata, portraits, character cards, or lore.

### Backstage → Set: building rooms from the story
- `lib/compass/roomBuilder.js`, `roomDresser.js`, and `roomProgram.js`: a suite interior pipeline that chains a geometry pass into a named room program, narrates fixtures/furniture/clutter/containers straight out of prose, and lets code (not the model) own the room list while the model only names and describes.
- `lib/compass/suitePack.js`: packs suite children from an adjacency graph without manual CAD work.
- `lib/compass/listing.js`: playbill-style suite listing codes for nested rooms.
- Large expansions to `lib/compass/state.js`, `sonar.js`, `dialogs.js`, and `stageUi.js` for sonar presence/last-known tracking, floorplan dialogs, and stage UI to match.
- `lib/placeNeighborhood.js`: a place-neighborhood lookup (ancestors + building/unit children + one-hop links) for World Index.

### Continuity, onboarding, and diagnostics
- `lib/scriptDag.js` + `lib/dagWalk.js`: a cycle-safe Follows/Depends plot spine for Script cards.
- `lib/visitMemory.js`: tracks the last visit at the current place via credited, located, and dated Script cards, ordered by the story calendar rather than the DAG walker.
- `lib/memoryBookPrompt.js`: a Showtime MemoryBooks scene prompt and parser for Script Agent ingest.
- `lib/intelBridge.js`: applies ACH / SEC / rumor-intel tags onto Motivation and nudges standing math; Reputation keeps owning the web nodes.
- `lib/setupSheet.js` + `lib/setupKit.js`: a manual first-chat setup flow — wardrobe, props, and closet drafts in the same shapes Cast files, with nothing saved or audited until the user accepts it.
- `lib/houseHealth.js`: last-one house loop notes surfaced on Backstage → Settings (not a token budget estimate).
- `lib/playbill.js`: an in-app program/glossary, opened from the closed curtain or the minimized marquee, explaining the house's own vocabulary (Director, Star, Billing, In play, Absent, quiet jobs, and so on).
- `lib/dialogs.js`: a unified set of Showtime punch-ticket modals, alerts, confirmations, prompts, menus, and notice helpers used across the newer flows (Camera Focus among them).

### Startup and performance
- `index.js` module loading now waits for the open chat to actually paint (`chatSurfaceReady`) before compiling the ~2MB of tab modules, paced with small `breathe()`/`yieldPaint` yields instead of racing chat paint on a blind timeout. This is what used to leave the pane blank or the tab unresponsive on a long transcript.
- `redisplayChat`-style batched re-rendering and a cheaper per-message reply-depth calculation land on the SillyTavern side of this fix (see the core changelog/commit, not this extension).

### Platform fix (ships with SillyTavern core, not this extension)
- A newer Claude model family (Fable, Mythos, Opus 5, Sonnet 5, Haiku 5 — including Bedrock ids) was rejecting requests with `role 'system' must follow a 'user' message...` whenever a mid-chat system turn (narrator line, author's note, Compass card) landed right after an assistant reply instead of a user turn. The request is now repaired before it goes out: the offending system turn is moved to the nearest legal slot, or demoted to a user turn in place if there is nowhere legal to put it.

### Housekeeping
- Removed two pieces of hardcoded, personal disaster-recovery code that should never have shipped publicly: a one-off cast "refile" patch keyed to specific character names, and an "Origins desk" restore keyed to one specific chat's exact title. Neither belonged in a public extension; both are gone, along with the private JSON payloads they read (now gitignored defensively as well).

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
