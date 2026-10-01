# Showtime: Your Personal Production Studio

*Ahem!* Welcome, dear creator, to the most ambitious production you'll ever direct—your own story. I'm your executive producer, and let me tell you, this isn't just another SillyTavern extension. This is a complete production desk packed into a cream toolbar that sits right above your chat. Think of it as the control room where the magic is filed: every character, every prop, every plot hook, at your fingertips.

A [SillyTavern](https://github.com/SillyTavern/SillyTavern) production: Cast, Script, Library, Inventory, Reputation, Motivation, Composer, and Backstage.

## The Grand Premiere: Installation

Getting this onto your SillyTavern stage is refreshingly simple—no degree in technical theater required:

1. Open **Extensions** → **Install Extension**
2. Paste this golden ticket:
   ```
   https://github.com/penitentfleece/SillyTavern-Showtime
   ```
3. Click **Install** and reload if prompted

Once installed, keep the production current with **Extensions** → Showtime → **Update**.

Hard-reload (**Ctrl+F5**) after a first install if the marquee does not appear—SillyTavern caches extension JS.

## Raising the Curtain: First Steps

The moment you open a chat, the cream **Showtime** bar appears—like a stage curtain drawing back. With no chat selected, the curtain stays down. Every good show needs its intermissions.

## The Production Departments: Your Creative Crew

### CAST: The Heart of Your Production

Here's where the ensemble lives, breathes, and (when you say so) takes the stage. Track Health and Energy on billed roles; flip on **Hard Mode** for Satiety, Hydration, Bladder, and Odor. No dice rolls—just bars that follow the story. Custom bars live under **Backstage → Stage → Trackers**, then show on Cast once Track is on.

Wardrobe and props go down to condition grades. Cue a billed member from the list (or `/cue`) when the scene needs *them*—not the Star, not the Director, and not someone Written out. You are typically the **Star**, the focal point of the trackers, though you can mark yourself **Absent** and keep persona out of generation. **Director** is unique: one chair. Assign it to a GM or setting card. From that chair you set genre, culture, era, tone, and the rest of the production dials, file plot hooks, and inject events.

- **Billing:** Director, Star, Lead, Major, Minor, Foil, Supporting. Kit and stats expand for Star / Lead / Major / Foil; Minor and Supporting are list and credit.
- **Presence:** In play, Absent, Written out. **Filter** defaults to In play only; Absent and Written out are extra checkboxes there so a long roster does not bury people on stage.
- **Casting Call:** Manual (Appearance, Affiliation, Summary), linked character card, or persona. Starting kit can be left empty, filled in by hand, or generated from the card / written description. **View** opens a read-only profile; **Edit** lives on that sheet.
- **Star Absent** strips persona from main generations. **Director** can Reply as another cast member when that card speaks.

### SCRIPT: Your Story's Blueprint

The Script tab is the screenwriter's room: scene cards with summaries, keywords, location / object / date facets, and credits. A timeline lets you place scenes in story time—lock them, leave them undated in the dock, pan and zoom. Organization is yours: rename the **level hierarchy** and pick Show, Book, or Custom codes to match the world. This does not retire SillyTavern lorebooks. Script can **replace the chat lorebook** and stamp Library entries onto cards; World Info still belongs to SillyTavern.

- **Views:** Shelf and Timeline (condensed / broad), plus World and Personal events.
- **Agent:** Chat-side help, lorebook audit, and pulling entries onto cards.
- **Calendar:** World date settings travel with the clapper and scene time.

### INVENTORY: The Star's Personal Prop Department

This is the Star's kit—**{{user}}** belongings. The **Trunk** is everything not on your person; **On Person** is what you are carrying, with equipped wearables called out. Mention a known item in chat and Showtime can inject an *Items at hand* cue. Names in the transcript are not clickable props; they are tracked here, then offered, used, forced, or given when the beat calls for it.

- Audit from user messages; claim pieces from the Set or Lost & Found.
- Incoming NPC offers wait for an in-character reply; Give is immediate.

### REPUTATION: The Social Dynamics Department

Two divisions, both for how the room feels about the Star.

The **Connections** web is the visual map: people, rumors, and private takes, with standing from Infamous to Celebrated. You can post a notice by hand or run an Audit so a connection files a take. Auto-synced house nodes follow Affiliations; everything else is a notice you placed.

**Affiliations** are faction dossiers: standing with the Star, apparent head, member roles, duty, and authority. Secrets and who-is-in-the-dark live on **Motivation**, not as org-rule fields on the dossier.

### COMPOSER: Your Personal Soundtrack Director

Every production needs music. **Spotify Premium** connects with a client ID only (PKCE—no client secret). YouTube, SoundCloud, and direct audio files are playback engines in their own right; an optional **backup URL** on a cue is the understudy, not the whole house. Tag tracks with location, character, time, and mood (enabling / activating / disabling). Import a playlist or album URL onto the shelf. Director events **re-sort the queue** against the scene; they do not mint new albums. Save a queue, suggest from tags on Spotify, or **Eject** the player and keep scoring while you work.

### MOTIVATION: The Character Development Studio

This is the billed character's arc board—Star, Lead, Major, or Foil—not a skill check. File **secrets**, **achievements**, and beat **arcs** (branching trees with gates). Audit can draft a branching arc from Connections, Script cards, and plot hooks. When a beat lands, point it at the Script scene that unlocks it. Interviews filed from Backstage sit in the drawer.

- Who knows / who is in the dark wires into Reputation.
- Plot hooks on the Director card can pull from (and push to) these boards.

### LIBRARY: Your World's Archive

The Library shelves SillyTavern World Info into cubbies, with tags, folders, and duplicate detection. It does not swallow lorebooks into Showtime. World Info activation stays SillyTavern's job. What Library injects are **native** entries you wrote here—pinned and/or keyword-matched. Stamp a scene code onto a Script card when provenance matters.

### BACKSTAGE: Where the Technical Magic Happens

The lobby behind the curtain. Don't be intimidated; this is where the house lights actually come up.

- **Production:** Director on call, scan frequency, and what the Director may pull from (tags, Stage, Inventory, Script, events, Library, Reputation, Motivation). Intrusiveness is Derail / Twist / Advance / Pressure, or Random. Compose world events and holidays onto Script cards. **Reels** import and export a production with module pickers—not only the whole house at once. A pending event opens as paper: play, dismiss, or file a hook.
- **Interview:** One subject (not Star or Director), with Connections in the brief. You interview as `{{user}}`, as a cast member, or **Anonymous** as the interviewer. File the sitting to Motivation and Connections, or walk away.
- **Peanut Gallery:** Isolated balcony, not main chat. Listen as **Last N** messages, a **message range**, or a **Script entry**. Cast (not Star or Director) reacts in character, can talk among themselves, and you can Continue.
- **Stage:** Spatial storytelling.
  - **Set:** Floorplans, compass, sonar, unlisted places, exposed vs sheltered, suite tools, floorplan audit.
  - **Placement:** Dress cells with **fixtures, furniture, clutter**. Preview by cell and facing (N/E/S/W) for what you can see, interact with, and walk. Lost & Found lives here.
  - **Effects:** Weather overlay by exposure; indoor night is dimmer than open sky, with optional candlelight flicker; custom SFX URLs for rain, storm, snow, wind, ambient.
  - **Trackers:** Status (including custom bars), Connection, Scene plus the floating **clapper**, Location, Items.
  - **Visuals:** Backgrounds by location, area, narrative tags, or manual pick.
  - **World Index:** Live retrieval preview of what would inject next.
- Compass slash commands: `/room`, `/occ`, `/item`, `/exit`, `/compass` (and `st-*` aliases).

### SETTINGS: Your Technical Director's Office

Handbook (including the Spotify / Composer note), paper / night / crimson themes plus ink, paper, gold, and billing colors, and **connection profiles** (Audit vs Event). **Tabs** toggles which departments show; a master switch powers the whole marquee down. Custom tracker bars are designed under **Stage → Trackers**. Spotify's connect button lives on **Composer**.

## Technical Requirements

SillyTavern recent `release` or `staging`. No additional Node packages—the production runs on the existing house.

## Licensing

MIT — see [LICENSE](LICENSE) for the legal fine print.

---

Remember: every great production begins with a single scene. Start small, experiment with the departments, and build the house as the story asks for it. Showtime grows with your ambitions.
