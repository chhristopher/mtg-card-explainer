import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Some shells (and this one) preset an EMPTY ANTHROPIC_API_KEY. dotenv won't
// override an already-defined variable, so a blank preset would shadow the real
// key in .env. Let .env win whenever the environment value is blank.
const parsedEnv = dotenv.config().parsed || {};
for (const [k, v] of Object.entries(parsedEnv)) {
  if (!process.env[k] || process.env[k].trim() === "") process.env[k] = v;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL = process.env.EXPLAINER_MODEL || "claude-opus-4-8";
const CACHE_DIR = path.join(__dirname, "cache");

// Demo mode: run with no API key and no billing so you can preview the app.
// Card search/images/text are free (Scryfall); explanations come from a small set
// of hand-written samples plus a labeled placeholder for everything else.
const HAS_KEY = !!(process.env.ANTHROPIC_API_KEY || "").trim();
const DEMO_MODE = process.env.DEMO_MODE === "1" || !HAS_KEY;

const client = DEMO_MODE ? null : new Anthropic();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Canonical keyword definitions — the model explains keywords from these, not memory.
const KEYWORDS = JSON.parse(
  await fs.readFile(path.join(__dirname, "data", "keywords.json"), "utf8")
);
// Hand-written real explanations for a few iconic cards, used in demo mode.
const DEMO_EXPLANATIONS = JSON.parse(
  await fs.readFile(path.join(__dirname, "data", "demo-explanations.json"), "utf8")
);
await fs.mkdir(CACHE_DIR, { recursive: true });

// The five-section structure the UI renders. Constraining the output shape keeps
// every explanation consistent and parseable. When the player has chosen a precon
// deck and this card is in it, we add a sixth "in_your_deck" section.
function buildSchema(withDeck) {
  const properties = {
    in_plain_words: {
      type: "string",
      description: "1-3 sentences: what this card is and what it does, in everyday language.",
    },
    when_you_can_play_it: {
      type: "string",
      description: "When during the game a beginner is allowed to play this card.",
    },
    how_it_works: {
      type: "array",
      items: { type: "string" },
      description: "Ordered, concrete steps describing what happens when the card is used.",
    },
    words_to_know: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
      },
      description: "Every keyword, symbol, or unusual term on the card, defined simply.",
    },
    example_turn: {
      type: "string",
      description: "A short, concrete example of playing or using this card at the table.",
    },
  };
  const required = [
    "in_plain_words",
    "when_you_can_play_it",
    "how_it_works",
    "words_to_know",
    "example_turn",
  ];
  if (withDeck) {
    properties.in_your_deck = {
      type: "string",
      description:
        "1-3 sentences on how this card works together with the SPECIFIC related cards listed from the player's deck. Use only the listed relationships; do not invent synergies.",
    };
    required.push("in_your_deck");
  }
  return { type: "object", additionalProperties: false, properties, required };
}

const SYSTEM_PROMPT = `You explain Magic: The Gathering cards to TOTAL BEGINNERS who have never played before and cannot tell whether an explanation is correct. Accuracy is more important than anything else.

ABSOLUTE RULES:
- Explain ONLY from the official card data and rulings provided in the user message. Do NOT use any knowledge of this card from memory.
- Never invent rules, abilities, interactions, or numbers that are not supported by the provided Oracle text and rulings.
- If something cannot be determined from the provided information, say so plainly rather than guessing.
- When defining a keyword or symbol, use the authoritative definition provided. If a keyword on the card has no definition provided, define it only if the card's own text explains it; otherwise say it isn't defined here.
- Write for someone who does not know Magic jargon. Spell things out. Keep sentences short and concrete.
- Be encouraging and calm. Do not assume prior knowledge.

DECK CONTEXT (only when an "IN THE PLAYER'S DECK" section is provided):
- The user message may list specific other cards from the player's own precon deck that are mechanically related to this card, each with the reason they're related.
- For the "in_your_deck" field, explain how this card teams up with those SPECIFIC listed cards, using ONLY the listed relationships. Name the related cards.
- Do NOT invent synergies, combos, or relationships that are not in the provided list. If the list is empty, say this card mostly works on its own in the deck.

Return the explanation in the required structured format. Define every keyword and every mana/tap symbol that appears on the card in "words_to_know". In "how_it_works", do NOT prefix items with step numbers (they are numbered automatically); just write the step.`;

function combineOracle(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length > 1) {
    return card.card_faces
      .map((f) => {
        const parts = [f.name, f.mana_cost, f.type_line]
          .filter(Boolean)
          .join("  •  ");
        return `${parts}\n${f.oracle_text ?? ""}`.trim();
      })
      .join("\n\n— other face —\n\n");
  }
  return card.oracle_text ?? "";
}

function collectKeywords(card) {
  const text = [
    combineOracle(card),
    (card.keywords || []).join(" "),
    card.type_line || "",
  ]
    .join(" ")
    .toLowerCase();

  const matched = {};
  for (const [name, def] of Object.entries(KEYWORDS)) {
    if (name.startsWith("_")) continue;
    // Match on the keyword name, ignoring any parenthetical qualifier in the key.
    const probe = name.split(" (")[0];
    if (text.includes(probe)) matched[name] = def;
  }
  // Always include the universal cost symbols — beginners ask about these constantly.
  matched["mana cost"] = KEYWORDS["mana cost"];
  if (card.mana_cost?.includes("{T}") || combineOracle(card).includes("{T}")) {
    matched["tap symbol"] = KEYWORDS["tap symbol"];
  }
  return matched;
}

function buildUserMessage(card, rulings, deckContext) {
  const oracle = combineOracle(card);
  const relevant = collectKeywords(card);
  const keywordBlock = Object.entries(relevant)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const rulingsBlock =
    rulings && rulings.length
      ? rulings.map((r) => `- ${r.comment}`).join("\n")
      : "(no official rulings)";

  let deckBlock = "";
  if (deckContext) {
    const lines = deckContext.related.length
      ? deckContext.related
          .map((r) => `- ${r.name}: ${r.reasons.join("; ")}`)
          .join("\n")
      : "(no clearly related cards found in the deck)";
    deckBlock = `

IN THE PLAYER'S DECK ("${deckContext.deckName}"):
This card is part of the player's precon deck. Other cards in that same deck that are mechanically related to it:
${lines}

Write the "in_your_deck" note about how this card works with those specific cards, using only the relationships above.`;
  }

  return `OFFICIAL CARD DATA (the only source of truth):
Name: ${card.name}
Mana cost: ${card.mana_cost || (card.card_faces?.[0]?.mana_cost) || "(none / not applicable)"}
Type: ${card.type_line || "(unknown)"}
${card.power != null ? `Power/Toughness: ${card.power}/${card.toughness}\n` : ""}${card.loyalty != null ? `Starting loyalty: ${card.loyalty}\n` : ""}Oracle text:
${oracle || "(this card has no rules text)"}

KEYWORDS LISTED BY SCRYFALL: ${(card.keywords || []).join(", ") || "(none)"}

AUTHORITATIVE KEYWORD / SYMBOL DEFINITIONS (use these verbatim in meaning):
${keywordBlock || "(none relevant)"}

OFFICIAL RULINGS FROM WIZARDS:
${rulingsBlock}${deckBlock}

Now explain this card to a complete beginner using ONLY the information above.`;
}

// ---------- Precon deck support ----------
const DECKS_DIR = path.join(__dirname, "data", "decks");
const DECK_CACHE_DIR = path.join(CACHE_DIR, "decks");
await fs.mkdir(DECK_CACHE_DIR, { recursive: true });

// Theme tags spotted in a card's Oracle text, used to relate cards that "care
// about" the same mechanic even if they share no keyword.
const THEME_TAGS = [
  { tag: "+1/+1 counters", re: /\+1\/\+1 counter/i },
  { tag: "tokens", re: /\bcreate[s]?\b.*\btoken|\btoken\b/i },
  { tag: "sacrificing", re: /\bsacrifice\b/i },
  { tag: "the graveyard", re: /\bgraveyard\b/i },
  { tag: "gaining life", re: /\bgain[s]?\b.*\blife\b|\blifelink\b/i },
  { tag: "drawing cards", re: /\bdraw[s]?\b.*\bcard/i },
  { tag: "discarding", re: /\bdiscard/i },
  { tag: "+1/+1 from attacking", re: /\battacks?\b.*\+1\/\+1|\bwhenever .* attacks\b/i },
  { tag: "artifacts", re: /\bartifact\b/i },
  { tag: "enchantments", re: /\benchantment\b/i },
  { tag: "+1 mana / ramp", re: /\badd \{|\bsearch your library for a .*land\b/i },
];

function subtypesOf(typeLine) {
  // The part after the em dash in a type line holds subtypes (e.g. "Elf Warrior").
  const m = (typeLine || "").split("—");
  if (m.length < 2) return [];
  return m[1].trim().split(/\s+/).filter(Boolean);
}

function profileOf(card) {
  const oracle = combineOracle(card).toLowerCase();
  const keywords = new Set(
    (card.keywords || []).map((k) => k.toLowerCase())
  );
  // also pick up keyword-glossary terms appearing in the text
  for (const name of Object.keys(KEYWORDS)) {
    if (name.startsWith("_")) continue;
    const probe = name.split(" (")[0];
    if (probe.length > 3 && oracle.includes(probe)) keywords.add(probe);
  }
  const subtypes = new Set(subtypesOf(card.type_line).map((s) => s.toLowerCase()));
  const themes = new Set(
    THEME_TAGS.filter((t) => t.re.test(oracle)).map((t) => t.tag)
  );
  return { keywords, subtypes, themes };
}

// Load deck definitions: data/decks/<id>.json = { name, cards: ["Name", ...] }
async function loadDeckList() {
  let files = [];
  try {
    files = (await fs.readdir(DECKS_DIR)).filter(
      (f) => f.endsWith(".json") && !f.startsWith("_")
    );
  } catch {
    return [];
  }
  const decks = [];
  for (const f of files) {
    try {
      const def = JSON.parse(await fs.readFile(path.join(DECKS_DIR, f), "utf8"));
      const id = f.replace(/\.json$/, "");
      const uniqueCards = (def.cards || []).length;
      // Total deck size includes duplicate basic lands, which we don't store
      // individually (they need no explanation). uniqueCards = explain-able cards.
      decks.push({
        id,
        name: def.name || id,
        commander: def.commander || null, // used for the deck-picker thumbnail
        cardCount: uniqueCards + (def.basics || 0),
        uniqueCards,
      });
    } catch {
      /* skip malformed deck file */
    }
  }
  return decks.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadDeckDef(deckId) {
  const safe = String(deckId).replace(/[^a-z0-9_-]/gi, "");
  const file = path.join(DECKS_DIR, `${safe}.json`);
  const def = JSON.parse(await fs.readFile(file, "utf8"));
  return { id: safe, name: def.name || safe, cards: def.cards || [] };
}

// Fetch Oracle data for every card in a deck from Scryfall (free) once, and cache
// the lightweight "profile" we need for relating cards. No LLM credits involved.
async function getEnrichedDeck(deckId) {
  const def = await loadDeckDef(deckId);
  const cacheFile = path.join(DECK_CACHE_DIR, `${def.id}.enriched.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    if (cached.count === def.cards.length) return cached;
  } catch {
    /* (re)build below */
  }

  // Scryfall's collection endpoint matches split/double-faced cards by their first
  // face name (e.g. "Double Jump"), but returns the full "A // B" name — which is
  // what the browser sends, so keying by the returned name stays consistent.
  const identifiers = def.cards.map((name) => ({ name: name.split(" // ")[0] }));
  const cards = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const chunk = identifiers.slice(i, i + 75);
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: chunk }),
    });
    if (res.ok) {
      const json = await res.json();
      cards.push(...(json.data || []));
    }
    await new Promise((r) => setTimeout(r, 120)); // be kind to Scryfall
  }

  const byName = {};
  for (const c of cards) {
    const p = profileOf(c);
    byName[c.name.toLowerCase()] = {
      name: c.name,
      keywords: [...p.keywords],
      subtypes: [...p.subtypes],
      themes: [...p.themes],
    };
  }
  const enriched = {
    id: def.id,
    name: def.name,
    count: def.cards.length,
    cards: byName,
  };
  await fs.writeFile(cacheFile, JSON.stringify(enriched, null, 2));
  return enriched;
}

// Given the searched card and an enriched deck, find the related cards + reasons.
function relatedCardsFor(card, enriched) {
  const me = profileOf(card);
  const meName = card.name.toLowerCase();
  const out = [];
  for (const [key, other] of Object.entries(enriched.cards)) {
    if (key === meName) continue;
    const reasons = [];
    const sharedKw = other.keywords.filter((k) => me.keywords.has(k));
    const sharedSub = other.subtypes.filter((s) => me.subtypes.has(s));
    const sharedTheme = other.themes.filter((t) => me.themes.has(t));
    if (sharedSub.length)
      reasons.push(`both are ${sharedSub.join("/")}` + " (same creature type)");
    if (sharedKw.length) reasons.push(`both have ${sharedKw.join(", ")}`);
    if (sharedTheme.length)
      reasons.push(`both care about ${sharedTheme.join(", ")}`);
    if (reasons.length) {
      out.push({ name: other.name, reasons, score: reasons.length });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8).map(({ name, reasons }) => ({ name, reasons }));
}

// Resolve deck context for a searched card, or null if no/unknown deck or the
// card isn't part of the chosen deck.
async function resolveDeckContext(deckId, card) {
  if (!deckId) return null;
  let enriched;
  try {
    enriched = await getEnrichedDeck(deckId);
  } catch {
    return null;
  }
  if (!enriched.cards[card.name.toLowerCase()]) return null; // card not in this deck
  return {
    deckId: enriched.id,
    deckName: enriched.name,
    related: relatedCardsFor(card, enriched),
  };
}

async function cachePath(oracleId, deckId) {
  // oracle_id is a stable UUID per unique card; safe as a filename. Deck-aware
  // explanations are cached separately per deck so a card is paid for once per deck.
  const safe = String(oracleId).replace(/[^a-z0-9-]/gi, "") || "unknown";
  if (deckId) {
    const dir = path.join(CACHE_DIR, "by-deck", deckId);
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, `${safe}.json`);
  }
  return path.join(CACHE_DIR, `${safe}.json`);
}

// Demo explanation: a real hand-written sample if we have one for this card,
// otherwise a clearly-labeled placeholder that still fills every section (and
// gives genuine keyword definitions from the glossary).
function demoExplanation(card, deckContext) {
  const real = DEMO_EXPLANATIONS[card.name.toLowerCase()];
  const base = real ? { ...real } : null;

  // A free, templated "in your deck" note so the deck feature is previewable too.
  const deckNote = deckContext
    ? deckContext.related.length
      ? `In your "${deckContext.deckName}" deck, this connects with ${deckContext.related
          .slice(0, 3)
          .map((r) => r.name)
          .join(", ")} (${deckContext.related[0].reasons[0]}). (Demo preview — a real, written-out synergy note appears here with an API key.)`
      : `In your "${deckContext.deckName}" deck, this card mostly works on its own. (Demo preview.)`
    : null;

  if (base) {
    if (deckNote) base.in_your_deck = deckNote;
    return base;
  }

  const oracleLines = combineOracle(card)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const words = Object.entries(collectKeywords(card)).map(([term, definition]) => ({
    term,
    definition,
  }));
  const isInstant = (card.type_line || "").toLowerCase().includes("instant");

  const fallback = {
    in_plain_words: `This is ${
      card.type_line ? "a " + card.type_line.toLowerCase() : "a Magic card"
    }. (Demo preview — with an API key connected, this section becomes a real, beginner-friendly explanation written only from this card's official text.)`,
    when_you_can_play_it: isInstant
      ? "It's an instant, so you can play it at almost any time, including during other players' turns."
      : "Cards like this are usually played on your own turn, during your main phase, when nothing else is happening.",
    how_it_works: oracleLines.length ? oracleLines : ["This card has no rules text."],
    words_to_know: words,
    example_turn:
      "(Demo preview) A concrete, worked example for this exact card appears here once an API key is connected.",
  };
  if (deckNote) fallback.in_your_deck = deckNote;
  return fallback;
}

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, model: MODEL, demo: DEMO_MODE })
);

// List the supported precon decks for the deck picker.
app.get("/api/decks", async (_req, res) => {
  res.json({ decks: await loadDeckList() });
});

app.post("/api/explain", async (req, res) => {
  const { card, rulings, deckId } = req.body || {};
  if (!card || !card.name) {
    return res.status(400).json({ error: "Missing card data." });
  }

  const oracleId = card.oracle_id || card.id || card.name;

  // Work out whether this card belongs to the player's chosen deck, and if so
  // which other deck cards relate to it (computed from Scryfall data — free).
  const deckContext = await resolveDeckContext(deckId, card);
  const inDeck = !!deckContext;
  const file = await cachePath(oracleId, inDeck ? deckContext.deckId : null);

  // In demo mode, never call the paid API — return a sample so the UI is fully visible.
  if (DEMO_MODE) {
    return res.json({
      explanation: demoExplanation(card, deckContext),
      card_name: card.name,
      oracle_id: oracleId,
      in_deck: inDeck,
      deck_name: deckContext?.deckName || null,
      demo: true,
    });
  }

  // 1. Serve a previously generated (and ideally human-reviewed) explanation.
  if (!req.query.refresh) {
    try {
      const cached = JSON.parse(await fs.readFile(file, "utf8"));
      return res.json({ ...cached, cached: true });
    } catch {
      /* not cached yet — generate below */
    }
  }

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // A capped thinking budget: enough to reason through tricky cards, but not
      // so much that explanations balloon in length and cost. Adjustable.
      thinking: { type: "enabled", budget_tokens: 1500 },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        format: { type: "json_schema", schema: buildSchema(inDeck) },
      },
      messages: [
        { role: "user", content: buildUserMessage(card, rulings, deckContext) },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock) throw new Error("Model returned no text output.");
    const explanation = JSON.parse(textBlock.text);

    const record = {
      explanation,
      card_name: card.name,
      oracle_id: oracleId,
      in_deck: inDeck,
      deck_name: deckContext?.deckName || null,
      model: MODEL,
      generated_at: new Date().toISOString(),
    };
    await fs.writeFile(file, JSON.stringify(record, null, 2));
    res.json({ ...record, cached: false });
  } catch (err) {
    console.error("Explain failed:", err);
    const status = err instanceof Anthropic.APIError ? err.status || 502 : 500;
    res.status(status).json({
      error: "Could not generate an explanation. Please try again.",
      detail: err.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nMTG card explainer running:`);
  console.log(`  On this machine:  http://localhost:${PORT}`);
  console.log(`  On your phone:    http://<this-computer's-LAN-IP>:${PORT}`);
  if (DEMO_MODE) {
    console.log(`  Mode:  DEMO (no API key — sample explanations, nothing billed)`);
    console.log(`         Add ANTHROPIC_API_KEY to .env for real explanations of any card.`);
  } else {
    console.log(`  Model: ${MODEL}`);
  }
  console.log("");
});
