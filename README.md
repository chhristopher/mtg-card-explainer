# MTG Precon Card Explainer

A small web app that gives **total beginners** a plain-English explanation of any
Magic: The Gathering card. You type a card name, it pulls the official card data
and rulings from [Scryfall](https://scryfall.com), and an AI writes a
beginner-friendly explanation **grounded only in that official text** — so it
doesn't make up rules.

Built to be used on a phone at the table.

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

## Setup

Requires Node 20+ and an Anthropic API key.

```bash
npm install
cp .env.example .env
# edit .env and paste your ANTHROPIC_API_KEY
npm start
```

Then open the URL it prints.

## Using it on your phone

Run the server on a computer, and make sure your phone is on the **same Wi‑Fi**.
The server listens on all interfaces, so visit:

```
http://<your-computer's-LAN-IP>:3000
```

Find your Mac's IP with `ipconfig getifaddr en0` (Wi‑Fi) — e.g.
`http://192.168.1.42:3000`.

## Configuration

`.env` keys (see `.env.example`):

- `ANTHROPIC_API_KEY` — required. Stays server-side; never sent to the browser.
- `PORT` — default `3000`.
- `EXPLAINER_MODEL` — default `claude-opus-4-8` (most accurate). Use
  `claude-sonnet-4-6` for a cheaper option.

## Reviewing explanations

Because the card lists you actually play are finite, the high-accuracy move is to
generate explanations once and **read them yourself**, fixing any that are off.

- Generated explanations live in `cache/<oracle_id>.json`.
- Edit the `explanation` object in a file by hand to correct it — the app serves
  whatever is in the cache.
- To regenerate a single card, delete its cache file (or load it with
  `?refresh=1` appended to the page URL — the server honors a `refresh` query on
  the API).

## What's built vs. what's next

Built (features 1–4 from the spec):

- Type-a-name + autocomplete → card detail (image, mana cost as colored pips,
  type line, official Oracle text).
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
on card images.
