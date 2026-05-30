# Precon deck files

Each supported precon is one JSON file in this folder. The filename (without
`.json`) is the deck's id. Format:

```json
{
  "name": "Grand Larceny (Commander 2024)",
  "cards": [
    "Sol Ring",
    "Arcane Signet",
    "Command Tower"
  ]
}
```

- `name` — what shows in the deck picker.
- `cards` — the exact card names, one per line, as they appear on Scryfall.
  Card quantities don't matter here (we only need the unique names), and basic
  lands can be left out or included — they won't generate relationships.

On first use of a deck, the server fetches each card's data from Scryfall (free)
and caches a small "profile" (keywords, creature types, themes) under
`cache/decks/<id>.enriched.json`. That's used to find which cards relate to each
other. No AI credits are spent on this step.

If you edit a deck file, delete its `cache/decks/<id>.enriched.json` to force a
rebuild (the server also rebuilds automatically if the card count changes).

To get a precon's card list: Wizards publishes them, and Archidekt / Moxfield
let you export a deck as a plain list of names you can paste into `cards`.
