# MTG Precon Card Explainer — Project Context

## What this is

A web app that helps **new Magic: The Gathering players** understand the cards in a
preconstructed ("precon") deck while playing in person. The player types a card name and
gets a plain-language, beginner-level explanation of what the card does, when they can
play it, and what its keywords mean — and, where applicable, how that card functions
**within their specific precon deck**.

Audience: total beginners. They cannot detect a wrong answer — that's the whole reason
they're using the tool — so **accuracy is the top priority**, above features and polish.

This is a personal tool for a small group of friends (≈4 players), not a commercial
product. Don't build account systems, scaling infrastructure, monetization, or anything
that assumes many users.

---

## Implementation status (as built — last updated 2026-05-30)

**Built and working** (features 1–4 of the original spec):

1. ✅ Type-a-name + Scryfall autocomplete → card detail (image, mana cost as real MTG
   mana symbols, type line, official Oracle text).
2. ✅ Grounded LLM beginner explanation in five sections (plain words / when to play /
   how it works / words to know / example turn), via a server-side endpoint.
3. ✅ Keyword glossary (`data/keywords.json`) passed to the model so keywords are defined
   from authoritative text, not memory. Multi-face cards (transform / MDFC / split) handled.
4. ✅ Precon deck context — pick a deck once (remembered per browser); cards in that deck
   get an extra "In your deck" note grounded in a precomputed related-card list.

**Also done since launch:**

- ✅ **UI redesign** — "Apple-sleek meets Magic" theme (see *Design* below).
- ✅ **Deployed live** to Render as an always-on public site (see *Deployment* below).

**Deferred / not built:**

- ❌ Photo / OCR identification (feature 5) — intentionally not built; low value.
- ❌ Scryfall **bulk-data** local store — currently using live endpoints (fine at this
   volume; see Data sources).
- ⏳ A 4th precon deck — three are loaded; the group's 4th deck is pending.
- ⏳ Desktop / wide layout — still mobile-first single column; widescreen polish is the
   next design task (to be done in a fresh session).

### Tech stack

- **Backend:** Node + Express, single file `server.js` (ES modules). Serves the static
  frontend and exposes the API. No database — flat JSON files on disk.
- **Frontend:** vanilla HTML/CSS/JS in `public/` (no build step, no framework).
  Mobile-first; used on phones at the table. Two CDN webfonts (Google Fonts *Cinzel* +
  *mana-font* for real mana symbols) — fine since the app is online-only anyway.
- **LLM:** Anthropic Claude via `@anthropic-ai/sdk`. Structured output (JSON schema) +
  a capped thinking budget.
- **Hosting:** deployed on Render (paid Starter instance, always-on) at a public URL.
  Also runs locally; on the same Wi-Fi it's reachable at `http://<LAN-IP>:3000`.

### File map

```
server.js              Express app: /api/explain, /api/decks, /api/health, deck engine
public/index.html      UI shell (deck bar, search, card panel, explanation sections)
public/app.js          Autocomplete, Scryfall fetch, mana symbols, color identity, render
public/styles.css      Frosted-glass dark theme (mobile-first)
data/keywords.json     Canonical beginner definitions of keywords + mana/tap symbols
data/decks/<id>.json   One precon per file: { name, commander, basics, cards: [names] }
data/decks/_FORMAT.md  How to add a deck
data/demo-explanations.json  Hand-written samples shown in demo mode
cache/<oracle_id>.json           Cached generic explanations (paid once per card)
cache/by-deck/<deck>/<id>.json   Cached deck-aware explanations (per card + deck)
cache/decks/<id>.enriched.json   Per-deck card profiles from Scryfall (free, for relating)
render.yaml            Render Blueprint (build/start commands + env vars) for deploy
.node-version          Pins Node 22 on the host
DEPLOY.md              Step-by-step deploy + cache-review workflow
.claude/launch.json    Local preview-tool config (npm start on port 3000)
.env                   ANTHROPIC_API_KEY, PORT, EXPLAINER_MODEL (gitignored)
```

### Key decisions made

- **Model: `claude-sonnet-4-6`** (set in `.env` as `EXPLAINER_MODEL`). A head-to-head
  vs Opus on a hard card (Teval) showed near-identical accuracy — the grounding does the
  accuracy work, so Opus is overkill for this task. Swap to `claude-opus-4-8` for max
  accuracy or `claude-haiku-4-5` to stretch budget; it's one line.
- **Thinking is capped** (`thinking: { type: "enabled", budget_tokens: 1500 }`) rather
  than adaptive — adaptive let Sonnet balloon to ~3,800 tokens and over-explain. The cap
  keeps explanations tight, fast, and cheap while still reasoning through tricky cards.
- **One shared API key** funds the group (cost is tiny because explanations are cached).
  Consumer ChatGPT/Claude subscriptions cannot power this — only the paid API can, via a
  key. There is intentionally **no login screen**.
- **Demo mode** lets the app run with **no key and no billing** for previewing — see below.

### Design (UI)

The look is **"Apple-sleek meets Magic"** — modern iOS-style materials carrying MTG
flavor, mobile-first. Implemented in `public/styles.css` + `public/index.html`:

- **Frosted-glass surfaces** (`backdrop-filter: blur + saturate`) floating over a soft
  **color-pie aurora** (radial W/U/B/R/G glows) on a near-black graphite base.
- **Type:** *Cinzel* (serif, MTG-flavored) for the app title and card names; system font
  for body so it stays readable at the table.
- **Real mana symbols** via the *mana-font* webfont, not text circles. `renderMana()` in
  `app.js` maps each `{…}` token to a `ms ms-*` class and handles generic/hybrid
  (`{W/U}`)/monocolor-hybrid (`{2/W}`)/phyrexian (`{W/P}`)/tap, with a **text-pip
  fallback** for anything the font can't draw.
- **Color-identity framing:** `applyColorIdentity()` reads `card.color_identity` and puts
  an accent bar on the card panel — mono color, **gold gradient for multicolor**, silver
  for colorless (`.card.id-w/u/b/r/g/multi/c` in CSS).
- **Glanceable explanation:** each of the five sections is its own inset card with a small
  inline-SVG line icon + gold tracked header (icons defined in the `ICONS` map in
  `app.js`); the "In your deck" section keeps its green-tinted treatment and shows the
  deck name in its title.
- Graceful degradation: if the CDN fonts fail, Cinzel → serif fallback and mana symbols →
  text pips; nothing breaks functionally.

### Deployment

Live on **Render** as an always-on **paid Starter** web service (chosen over the free tier
so it never cold-starts — a ~50s wake mid-game was the dealbreaker). Setup artifacts:

- `render.yaml` — Blueprint: `npm install` / `npm start`, `EXPLAINER_MODEL=claude-sonnet-4-6`,
  and `ANTHROPIC_API_KEY` as a dashboard-entered secret (`sync: false`, never in git).
- `.node-version` → Node 22.
- **Code lives on GitHub** (`chhristopher/mtg-card-explainer`); Render auto-deploys on push
  to `main`.
- **Publishing flow is not yet streamlined** — the initial upload was via GitHub's web
  drag-and-drop. A one-click path (GitHub Desktop or `git push`) is a TODO for the next
  session, so design tweaks can ship without re-dragging files.

**The cache is the durable accuracy store — and it's committed to git.** Render's disk is
ephemeral (wiped on redeploy), so `cache/` is intentionally **un-ignored** and tracked.
Workflow to lock in a reviewed explanation: edit the JSON in `cache/`, commit, push →
auto-redeploy. Live-generated explanations are cached on the running instance but don't
survive a redeploy unless committed. See `DEPLOY.md`.

### Demo mode

If `ANTHROPIC_API_KEY` is missing/blank (or `DEMO_MODE=1`), the server runs in demo mode:
card search/images/text and the deck relationship engine all work (Scryfall is free), and
`/api/explain` returns a hand-written sample for a few iconic cards or a clearly-labeled
placeholder for the rest. Nothing is billed. The UI shows a "Demo preview" banner.

### Gotcha: blank env var shadows the key

This environment presets an **empty** `ANTHROPIC_API_KEY`. dotenv won't override an
already-defined variable, so the blank value shadowed the real key in `.env` and forced
demo mode. `server.js` fixes this by letting `.env` win whenever the environment value is
blank. Keep that logic if refactoring env loading.

---

## The single most important design rule: GROUNDING

The explanation must be built from **canonical card data**, never from the model's memory.

Flow (as implemented):
1. Identify the card from a typed name + Scryfall autocomplete.
2. The browser looks up the card's **official Oracle text + rulings** from Scryfall and
   POSTs them to `/api/explain`.
3. The server passes ONLY that data (plus matched keyword definitions and, if applicable,
   the deck's related-card list) to the LLM, with explicit instructions to explain from
   the provided text and to not invent rules, abilities, or interactions.
4. The real Oracle text stays visible in the UI (collapsible panel) so the user can see
   what the explanation is anchored to.

Why: LLMs confidently hallucinate Magic rules interactions. Grounding on Scryfall's
authoritative text + Wizards' rulings is what makes this trustworthy for beginners.

---

## Precon deck context — keep the grounding boundary tight

"Explain this card" grounds cleanly on Oracle text. "Explain this card *in this deck*"
tempts the model to free-associate about synergies it is inferring rather than reading.
The boundary is enforced by **precomputing** relationships, not asking the model to find them:

- On first use of a deck, the server fetches each card's data from Scryfall (free,
  `/cards/collection`, chunked) and caches a small "profile" per card: its keywords,
  creature subtypes (from the type line), and theme tags (regex over Oracle text for
  things like +1/+1 counters, tokens, sacrifice, graveyard, lifegain, etc.).
- When a searched card is in the deck, the server computes the other deck cards related to
  it (shared keyword / shared subtype-tribal / shared theme), with the *reason* for each,
  and passes only that list to the model. The model writes the "In your deck" note from
  that list and is told **not** to invent synergies outside it.
- Explanations are cached **per (card + deck)**, so a card looked up in two decks is
  generated (and reviewable) separately.

This works only because a precon is a **fixed, known, finite list** — which is also why
the lists can be human-reviewed.

### Supported decks (`data/decks/`)

| id | Deck | Source set | Explain-able cards (+basics) |
|----|------|-----------|------------------------------|
| `sultai-arisen` | Sultai Arisen | Tarkir: Dragonstorm Commander | 85 (+15 = 100) |
| `riders-of-rohan` | Riders of Rohan | LOTR: Tales of Middle-earth Commander | 81 (+19 = 100) |
| `tmnt-turtle-power` | TMNT — Turtle Power! | Universes Beyond Commander | 87 (+13 = 100) |

Deck files store only **unique non-basic card names** (basic lands are duplicates that
need no explanation). The deck picker shows the true 100-card total via a `basics` count
in each file. All card names were validated against Scryfall when the lists were sourced.

---

## Data sources

**Scryfall** — free card database, used under Wizards' Fan Content Policy.
- **Currently using live endpoints** (low volume, a few friends). The spec's advice to use
  the daily `oracle_cards` **bulk file** + a local store still stands if usage grows —
  not implemented yet.
  - Autocomplete: `GET /cards/autocomplete?q=<query>` → `{data:[names]}`
  - Exact card: `GET /cards/named?exact=<name>` (frontend falls back to `fuzzy`)
  - Rulings: fetch the card's `rulings_uri` → `{data:[{comment,...}]}`
  - Deck enrichment: `POST /cards/collection` (≤75 identifiers/request; split cards match
    by their **first face name**, e.g. "Double Jump", and return the full "A // B" name).
- Scryfall is CORS-friendly, so browser-side fetches work. Keep the browser's User-Agent
  intact (don't set it from JS).
- Fan Content Policy: don't paywall Scryfall data, don't gate it behind
  subscriptions/surveys, don't crop the copyright/artist line off card images. (The UI
  carries the Fan Content disclaimer in the footer.)

**Precon decklists** — NOT in Scryfall's card API as decks. Sourced separately (official
Wizards decklists + community sites, then Scryfall-validated) and stored per deck.

---

## Out of scope — do not build

- **Live board-state advice** ("what's my best play right now"). This is effectively an
  AI that plays Magic well; it's unreliable and not the goal. Resist scope creep here.
- A general card-scanner that matches photos against an image database.
- The tool is online-only (Scryfall + API calls). Acceptable for now; a known limitation
  at the table if signal is poor.

---

## Accuracy practices

- **Cache explanations per card** (keyed by Scryfall `oracle_id`; deck-aware ones keyed by
  card + deck). Oracle text is stable, so generate once and reuse — cheaper, faster, and
  reviewable. Cache files are plain JSON you can hand-edit to correct a bad explanation;
  the app serves whatever is in the cache. Delete a cache file (or POST with `?refresh=1`)
  to regenerate.
- For the precons you actually play: **generate explanations, read them yourself, and fix
  the wrong ones.** This manual review pass is the difference between "accurate" and
  "usually accurate," and it's feasible only because the lists are finite.

---

## Technical notes

- **API key is server-side only.** The LLM call lives on `/api/explain`. Never put the key
  in browser code. (`.env` is gitignored; on Render it's an encrypted env var.)
- **Multi-face cards** (transform / MDFC / split): combine `card_faces` for Oracle text and
  the prompt; use the first face's image if there's no card-level image. Done in both
  `server.js` (`combineOracle`) and `public/app.js`.
- **Mana symbols:** rendered from the `mana_cost` string (`{2}{W}{U}`) into the *mana-font*
  webfont via `renderMana()` / `manaFontSuffix()` in `app.js`, with a text-pip fallback.
- **Mobile-first:** primary use is phones at the table.
- **Structured output:** the model is forced to a JSON schema (five sections, plus an
  `in_your_deck` field when deck context applies). `how_it_works` items must not be
  pre-numbered (the UI numbers them; the frontend also strips stray leading numbers).

## Reference: prompt shape that worked

System prompt: explain a Magic card to a total beginner using ONLY the official data
provided; never rely on memory or invent rules/interactions not supported by the given
text and rulings; if something can't be determined, say so; define every keyword and
unusual symbol; for deck context, only use the provided related-card list. User message
provides name, mana cost, type, Oracle text, Scryfall keywords, matched keyword
definitions, official rulings, and (when applicable) the deck's related-card list.
Structured output enforces the five sections (+ "in your deck"). See `SYSTEM_PROMPT` and
`buildUserMessage` in `server.js`.
