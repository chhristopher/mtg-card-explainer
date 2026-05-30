# MTG Card Coach

*The card explains itself. This explains the card.*

**Card Coach** is a small web app that gives **total beginners** a plain-English
explanation of any Magic: The Gathering card. You type a card name, it pulls the
official card data and rulings from [Scryfall](https://scryfall.com), and an AI
writes a beginner-friendly explanation **grounded only in that official text** —
so it doesn't make up rules.

Built to be used on a **phone at the table**, mobile-first.

**🔗 Live site: https://mtg-card-explainer.onrender.com** — always-on and public, no login.
Just open it on your phone. (Hosted on Render; see [Deployment](#deployment).)

> Note: the GitHub repo is named `mtg-card-explainer` for historical reasons; the
> app itself is **Card Coach**.

## How it stays accurate (the important part)

The explanation is never written from the model's memory. The flow is:

1. You pick a card (typed name + Scryfall autocomplete).
2. The browser fetches the card's **official Oracle text + rulings** from Scryfall.
3. The server passes **only that data** to the model, with strict instructions
   to explain from the provided text and not invent anything.
4. The real Oracle text stays visible in the UI so you can see what the
   explanation is anchored to.

Explanations are **cached per card** (in `cache/`, keyed by Scryfall `oracle_id`),
so each card is generated once. You can read the cached files and fix any that
are wrong — see "Reviewing explanations" below.

## Using it

**Card Coach is live and public at the URL above** — hosted on Render, always-on,
no login or install. Day to day you just open it on your phone. Pick your precon
deck from the top bar
once (it's remembered in your browser) and start looking up cards. The search bar
stays **pinned at the top** as you scroll, so you can look up the next card without
scrolling back up; tapping it selects the previous card name so you can type right
over it.

Each explanation is broken into glanceable sections (in plain words / when to play
/ how it works / words to know / example turn). **"Words to know"** lists each term
collapsed — tap one to reveal its definition. If your card is in the chosen deck,
an extra **"How to use with your deck"** section appears, tinted in that deck's own
accent color.

## How it looks

The UI is **"Apple-sleek meets Magic"**: frosted-glass surfaces floating over a
soft color-pie aurora on a near-black base, *Cinzel* for display type, and the five
colored mana symbols beside the **Card Coach** title for a splash of color on
arrival. Specific touches:

- **Real MTG mana symbols** (via the mana-font webfont) everywhere they appear —
  the card's cost, the Oracle text, the explanations, and the term definitions —
  so players never see raw `{4}{R}` tokens. There's a text-pip fallback for any
  symbol the font can't draw.
- **Deck picker** styled like a media chooser: each precon shows its commander's
  card art as a thumbnail next to the name (it's a custom dropdown, since a native
  `<select>` can't show images), with full keyboard support.
- **Color-identity framing** on the card panel (mono color, gold for multicolor,
  silver for colorless).
- **Per-deck accent** on the "How to use with your deck" section — green for TMNT,
  violet for Sultai Arisen, crimson for Riders of Rohan.

If the CDN fonts ever fail to load, it degrades gracefully to a serif fallback and
text pips; nothing breaks functionally.

## Running it locally (for development)

You don't need this to *use* Card Coach — the live site above is always on. This
is only for working on the app itself.

Requires Node 20+ (the host pins Node 22) and an Anthropic API key.

```bash
npm install
cp .env.example .env
# edit .env and paste your ANTHROPIC_API_KEY
npm start
```

Then open the URL it prints.

### Testing a local build on your phone

(For the deployed app, just use the live URL above — this is only for a server
you're running locally.) The local server listens on all interfaces, so from a
phone on the same Wi‑Fi visit:

```
http://<your-computer's-LAN-IP>:3000
```

Find your Mac's IP with `ipconfig getifaddr en0` (Wi‑Fi) — e.g.
`http://192.168.1.42:3000`.

## Demo mode (no key, no billing)

If `ANTHROPIC_API_KEY` is missing/blank (or you set `DEMO_MODE=1`), the server runs
in **demo mode**: card search, images, official text, and the deck-relationship
engine all still work (Scryfall is free), and `/api/explain` returns a hand-written
sample for a few iconic cards or a clearly-labeled placeholder for the rest.
Nothing is billed, and the UI shows a "Demo preview" banner. Useful for previewing
the app without an API key.

## Configuration

`.env` keys (see `.env.example`):

- `ANTHROPIC_API_KEY` — required for real explanations. Stays server-side; never
  sent to the browser. Leave it blank to run in demo mode.
- `PORT` — default `3000`.
- `EXPLAINER_MODEL` — the model used for explanations. The deployed app runs
  `claude-sonnet-4-6`: because the grounding (above) does the accuracy work, Sonnet
  matches Opus on hard cards while being cheaper and faster. Swap to
  `claude-opus-4-8` for maximum accuracy or `claude-haiku-4-5` to stretch budget —
  it's one line. (If the variable is unset, the code falls back to `claude-opus-4-8`.)

## Reviewing explanations

Because the card lists you actually play are finite, the high-accuracy move is to
generate explanations once and **read them yourself**, fixing any that are off.

- Generated explanations live in `cache/<oracle_id>.json` (deck-aware ones under
  `cache/by-deck/<deck>/<oracle_id>.json`).
- Edit the `explanation` object in a file by hand to correct it — the app serves
  whatever is in the cache.
- To regenerate a single card, delete its cache file (or hit the API with
  `?refresh=1`).

The `cache/` directory is intentionally **committed to git**: the hosting disk is
ephemeral, so committing a reviewed explanation is what makes it survive a redeploy.

## Deployment

The app is deployed on **Render** as an always-on paid web service (chosen over the
free tier so it never cold-starts mid-game). Deploy artifacts live in the repo:

- `render.yaml` — Blueprint with build/start commands and env vars. The model is
  set to `claude-sonnet-4-6`; `ANTHROPIC_API_KEY` is a dashboard-entered secret
  (`sync: false`, never in git).
- `.node-version` → Node 22.

Render auto-deploys on push to `main`. See `DEPLOY.md` for the full deploy +
cache-review workflow.

## What's built vs. what's next

Built (features 1–4 from the spec):

- Type-a-name + autocomplete → card detail (image, mana cost as **real mana
  symbols**, type line, official Oracle text).
- Grounded beginner explanation in five sections (plain words / when to play /
  how it works / words to know / example turn).
- Keyword glossary: canonical definitions in `data/keywords.json` are passed to
  the model so keywords are explained from authoritative text. Multi-face cards
  (transform / MDFC / split) are handled.
- **Precon deck context.** Pick your deck from the top bar (remembered per
  browser). When you look up a card that's in your deck, the explanation gains an
  extra "In your deck" note. To stay inside the grounding boundary from
  `CLAUDE.md`, the server precomputes which *other* cards in that same deck are
  mechanically related (shared keywords, shared creature types/tribal, shared
  themes like +1/+1 counters or tokens) from free Scryfall data, and passes only
  that relationship list to the model — it doesn't free-associate synergies.
  Explanations are cached per (card + deck). Decks live in `data/decks/*.json`
  (see `data/decks/_FORMAT.md`); currently supported:
  - Sultai Arisen (Tarkir: Dragonstorm)
  - Riders of Rohan (LOTR: Tales of Middle-earth)
  - Teenage Mutant Ninja Turtles — Turtle Power!

Not yet built (deliberately deferred from the spec):

- **Photo identification** (OCR of the card title → fuzzy match).
- **Scryfall bulk-data** local store. Right now lookups use Scryfall's live
  endpoints, which is fine at this low volume; switch to the daily
  `oracle_cards` bulk file if usage grows.

## Data & licensing

Card data and images come from Scryfall, used under Wizards' Fan Content Policy.
The app doesn't paywall Scryfall data and keeps the copyright/artist line intact
on card images. Unofficial Fan Content — not approved or endorsed by Wizards of
the Coast.
</content>
</invoke>
