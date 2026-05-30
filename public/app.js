"use strict";

const SCRYFALL = "https://api.scryfall.com";

const els = {
  deckTrigger: document.getElementById("deck-trigger"),
  deckCurrent: document.querySelector(".deck-current"),
  deckMenu: document.getElementById("deck-menu"),
  search: document.getElementById("search"),
  suggestions: document.getElementById("suggestions"),
  status: document.getElementById("status"),
  card: document.getElementById("card"),
  img: document.getElementById("card-img"),
  name: document.getElementById("card-name"),
  cost: document.getElementById("card-cost"),
  type: document.getElementById("card-type"),
  oracle: document.getElementById("oracle-text"),
  explanation: document.getElementById("explanation"),
  meta: document.getElementById("explanation-meta"),
};

let debounceTimer = null;
let suggestionIndex = -1;
let activeRequest = 0; // guards against out-of-order responses

const DECK_KEY = "mtg-explainer-deck";

// ---------- deck picker (custom dropdown with commander thumbnails) ----------
// A native <select> can't show images, so this is a small custom listbox. The
// chosen deck id lives in `selectedDeckId`; the rest of the app reads that.

let selectedDeckId = "";
let deckItems = [{ id: "", name: "No deck — just look up cards", thumb: null }];
let deckMenuIndex = -1; // keyboard-highlighted option

async function loadDecks() {
  try {
    const res = await fetch("/api/decks");
    const { decks } = await res.json();
    deckItems = [
      { id: "", name: "No deck — just look up cards", thumb: null },
      ...decks.map((d) => ({
        id: d.id,
        name: d.name,
        commander: d.commander,
        thumb: null,
      })),
    ];
  } catch {
    /* deck list is optional; the app still works without it */
  }

  const saved = localStorage.getItem(DECK_KEY);
  selectedDeckId =
    saved && deckItems.some((d) => d.id === saved) ? saved : "";

  renderDeckMenu();
  updateDeckTrigger();
  fetchDeckThumbs(); // commander art, filled in as it arrives
}

// Pull each deck's commander art from Scryfall (free, CORS-friendly) for the
// thumbnail. Failures are silent — the item just keeps its placeholder.
async function fetchDeckThumbs() {
  await Promise.all(
    deckItems.map(async (item) => {
      if (!item.commander) return;
      try {
        const res = await fetch(
          `${SCRYFALL}/cards/named?exact=${encodeURIComponent(item.commander)}`
        );
        if (!res.ok) return;
        const card = await res.json();
        const uris = card.image_uris || card.card_faces?.[0]?.image_uris;
        // Full card image = a mini "poster"; the portrait thumb box matches it.
        item.thumb = uris?.small || uris?.art_crop || null;
      } catch {
        /* leave placeholder */
      }
    })
  );
  renderDeckMenu();
  updateDeckTrigger();
}

function deckById(id) {
  return deckItems.find((d) => d.id === id) || deckItems[0];
}

function thumbHtml(item) {
  if (item.thumb) {
    return `<img class="deck-thumb" src="${item.thumb}" alt="" loading="lazy" />`;
  }
  return `<span class="deck-thumb deck-thumb-empty" aria-hidden="true"></span>`;
}

function updateDeckTrigger() {
  const item = deckById(selectedDeckId);
  const thumb = item.id ? thumbHtml(item) : "";
  els.deckCurrent.innerHTML = `${thumb}<span class="deck-current-name">${esc(
    item.name
  )}</span>`;
}

function renderDeckMenu() {
  els.deckMenu.innerHTML = deckItems
    .map(
      (item, i) =>
        `<li class="deck-option" role="option" data-id="${esc(item.id)}" id="deck-opt-${i}" aria-selected="${
          item.id === selectedDeckId ? "true" : "false"
        }">${
          item.id
            ? thumbHtml(item)
            : '<span class="deck-thumb-spacer" aria-hidden="true"></span>'
        }<span class="deck-option-name">${esc(item.name)}</span></li>`
    )
    .join("");
}

function openDeckMenu() {
  els.deckMenu.hidden = false;
  els.deckTrigger.setAttribute("aria-expanded", "true");
  deckMenuIndex = Math.max(
    0,
    deckItems.findIndex((d) => d.id === selectedDeckId)
  );
  highlightDeckOption();
}

function closeDeckMenu() {
  els.deckMenu.hidden = true;
  els.deckTrigger.setAttribute("aria-expanded", "false");
  deckMenuIndex = -1;
}

function highlightDeckOption() {
  const opts = [...els.deckMenu.querySelectorAll(".deck-option")];
  opts.forEach((li, i) =>
    li.classList.toggle("highlight", i === deckMenuIndex)
  );
  if (opts[deckMenuIndex]) {
    els.deckTrigger.setAttribute(
      "aria-activedescendant",
      opts[deckMenuIndex].id
    );
    opts[deckMenuIndex].scrollIntoView({ block: "nearest" });
  }
}

function chooseDeck(id) {
  setDeck(id);
  closeDeckMenu();
  els.deckTrigger.focus();
}

// Set the active deck, persist it, and re-explain the current card in the new
// deck's context if one is shown.
function setDeck(id) {
  selectedDeckId = id;
  localStorage.setItem(DECK_KEY, id);
  renderDeckMenu();
  updateDeckTrigger();
  if (currentCard) selectCard(currentCard.name);
}

els.deckTrigger.addEventListener("click", () => {
  if (els.deckMenu.hidden) openDeckMenu();
  else closeDeckMenu();
});

els.deckMenu.addEventListener("click", (e) => {
  const li = e.target.closest(".deck-option");
  if (li) chooseDeck(li.dataset.id);
});

els.deckTrigger.addEventListener("keydown", (e) => {
  if (els.deckMenu.hidden) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDeckMenu();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    deckMenuIndex = Math.min(deckMenuIndex + 1, deckItems.length - 1);
    highlightDeckOption();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    deckMenuIndex = Math.max(deckMenuIndex - 1, 0);
    highlightDeckOption();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (deckItems[deckMenuIndex]) chooseDeck(deckItems[deckMenuIndex].id);
  } else if (e.key === "Escape") {
    closeDeckMenu();
  }
});

let currentCard = null;

loadDecks();

// ---------- helpers ----------

function showStatus(html, isError = false) {
  els.status.innerHTML = html;
  els.status.classList.toggle("error", isError);
  els.status.hidden = false;
}
function hideStatus() {
  els.status.hidden = true;
}

function clearSuggestions() {
  els.suggestions.innerHTML = "";
  suggestionIndex = -1;
}

// Map a Scryfall mana symbol token (no braces) to a Mana-font class suffix.
// Handles colors, generic numbers, hybrid ({W/U}), monocolored hybrid ({2/W}),
// phyrexian ({W/P}), tap/untap, snow, energy, X/Y/Z and ∞.
function manaFontSuffix(token) {
  const t = token.toLowerCase().trim();
  if (/^\d+$/.test(t)) return t; // generic
  if (t === "∞" || t === "infinity") return "infinity";
  if (t === "t" || t === "tap") return "tap";
  if (t === "q" || t === "untap") return "untap";
  if (t === "e") return "e"; // energy
  if (/^[wubrgcsxyz]$/.test(t)) return t; // single color / generic vars / snow
  // hybrid / phyrexian: strip slashes, e.g. "w/u" -> "wu", "2/w" -> "2w", "w/p" -> "wp"
  if (t.includes("/")) {
    const joined = t.replace(/\//g, "");
    if (/^([wubrg2]{2}|[wubrg]p)$/.test(joined)) return joined;
  }
  return null; // unknown — caller falls back to a text pip
}

// Render a {2}{W}{U}-style mana string into real mana symbols (Mana font),
// falling back to a text pip for anything the font can't draw.
function renderMana(manaCost, container) {
  container.innerHTML = "";
  if (!manaCost) return;
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  for (const raw of symbols) {
    const sym = raw.slice(1, -1); // strip braces
    const suffix = manaFontSuffix(sym);
    if (suffix) {
      const i = document.createElement("i");
      i.className = `ms ms-${suffix} ms-cost ms-shadow`;
      i.title = raw;
      i.setAttribute("aria-label", raw);
      container.appendChild(i);
    } else {
      const pip = document.createElement("span");
      pip.className = "pip";
      pip.textContent = sym;
      container.appendChild(pip);
    }
  }
}

// Turn body text that may contain {X} mana/symbol tokens (e.g. "{4}{R}", "{T}")
// into HTML with real inline mana symbols, falling back to a small text pip for
// anything the font can't draw. Non-token text is HTML-escaped. Used for the
// Oracle block, explanation paragraphs, and word definitions so symbols read the
// same everywhere instead of showing raw "{4}{R}".
function withManaSymbols(text) {
  const str = String(text ?? "");
  const re = /\{([^}]+)\}/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    out += esc(str.slice(last, m.index));
    const suffix = manaFontSuffix(m[1]);
    if (suffix) {
      out += `<i class="ms ms-${suffix} ms-cost ms-inline" title="${esc(
        m[0]
      )}" aria-label="${esc(m[0])}"></i>`;
    } else {
      out += `<span class="pip-inline">${esc(m[1])}</span>`;
    }
    last = re.lastIndex;
  }
  out += esc(str.slice(last));
  return out;
}

// Frame the card panel by its Scryfall color identity: mono color, gold for
// multicolor, silver for colorless.
function applyColorIdentity(card, el) {
  const ci = Array.isArray(card.color_identity) ? card.color_identity : [];
  let cls = "id-c";
  if (ci.length === 1) cls = "id-" + ci[0].toLowerCase();
  else if (ci.length > 1) cls = "id-multi";
  el.className = "card " + cls;
}

function combineOracle(card) {
  if (Array.isArray(card.card_faces) && card.card_faces.length > 1) {
    return card.card_faces
      .map((f) => {
        const head = [f.name, f.mana_cost].filter(Boolean).join("  ");
        return `${head}\n${f.type_line || ""}\n${f.oracle_text || ""}`.trim();
      })
      .join("\n\n— // —\n\n");
  }
  return card.oracle_text || "(This card has no rules text.)";
}

function cardImage(card) {
  if (card.image_uris?.normal) return card.image_uris.normal;
  // Multi-face cards: image lives on the first face.
  if (card.card_faces?.[0]?.image_uris?.normal)
    return card.card_faces[0].image_uris.normal;
  return "";
}

// ---------- autocomplete ----------

// Tapping the (sticky) search to look up the next card selects the previous
// card's name so you can just start typing over it.
els.search.addEventListener("focus", () => els.search.select());

els.search.addEventListener("input", () => {
  const q = els.search.value.trim();
  clearTimeout(debounceTimer);
  if (q.length < 2) {
    clearSuggestions();
    return;
  }
  debounceTimer = setTimeout(() => fetchSuggestions(q), 180);
});

async function fetchSuggestions(q) {
  try {
    const res = await fetch(
      `${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`
    );
    const data = await res.json();
    renderSuggestions(data.data || []);
  } catch {
    clearSuggestions();
  }
}

function renderSuggestions(names) {
  clearSuggestions();
  for (const name of names.slice(0, 10)) {
    const li = document.createElement("li");
    li.textContent = name;
    li.setAttribute("role", "option");
    li.addEventListener("click", () => selectCard(name));
    els.suggestions.appendChild(li);
  }
}

els.search.addEventListener("keydown", (e) => {
  const items = [...els.suggestions.querySelectorAll("li")];
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
    updateSuggestionHighlight(items);
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    suggestionIndex = Math.max(suggestionIndex - 1, 0);
    updateSuggestionHighlight(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (suggestionIndex >= 0 && items[suggestionIndex]) {
      selectCard(items[suggestionIndex].textContent);
    } else if (els.search.value.trim()) {
      selectCard(els.search.value.trim());
    }
  } else if (e.key === "Escape") {
    clearSuggestions();
  }
});

function updateSuggestionHighlight(items) {
  items.forEach((li, i) =>
    li.setAttribute("aria-selected", i === suggestionIndex ? "true" : "false")
  );
}

document.addEventListener("click", (e) => {
  if (!els.search.contains(e.target) && !els.suggestions.contains(e.target)) {
    clearSuggestions();
  }
  if (
    !els.deckTrigger.contains(e.target) &&
    !els.deckMenu.contains(e.target)
  ) {
    closeDeckMenu();
  }
});

// ---------- card lookup + explanation ----------

async function selectCard(name) {
  clearSuggestions();
  els.search.value = name;
  els.card.hidden = true;
  showStatus('<span class="spinner"></span>Looking up the card…');

  const requestId = ++activeRequest;

  let card;
  try {
    const res = await fetch(
      `${SCRYFALL}/cards/named?exact=${encodeURIComponent(name)}`
    );
    if (!res.ok) {
      // fall back to fuzzy if the exact name wasn't quite right
      const fuzzy = await fetch(
        `${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`
      );
      if (!fuzzy.ok) throw new Error("Card not found.");
      card = await fuzzy.json();
    } else {
      card = await res.json();
    }
  } catch (err) {
    if (requestId === activeRequest)
      showStatus("Couldn't find that card. Check the spelling?", true);
    return;
  }
  if (requestId !== activeRequest) return;

  renderCard(card);

  // Fetch official rulings (CORS-friendly), then ask our server for the explanation.
  let rulings = [];
  try {
    if (card.rulings_uri) {
      const r = await fetch(card.rulings_uri);
      if (r.ok) rulings = (await r.json()).data || [];
    }
  } catch {
    /* rulings are optional */
  }
  if (requestId !== activeRequest) return;

  await explain(card, rulings, requestId);
}

function renderCard(card) {
  hideStatus();
  currentCard = card;
  applyColorIdentity(card, els.card);
  els.name.textContent = card.name;
  renderMana(card.mana_cost || card.card_faces?.[0]?.mana_cost, els.cost);
  els.type.textContent = card.type_line || "";
  els.oracle.innerHTML = withManaSymbols(combineOracle(card));

  const img = cardImage(card);
  if (img) {
    els.img.src = img;
    els.img.alt = card.name;
    els.img.style.display = "";
  } else {
    els.img.style.display = "none";
  }

  els.explanation.innerHTML =
    '<p class="section"><span class="spinner"></span>Writing a beginner explanation…</p>';
  els.meta.textContent = "";
  els.card.hidden = false;
}

async function explain(card, rulings, requestId) {
  try {
    const res = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, rulings, deckId: selectedDeckId || null }),
    });
    const data = await res.json();
    if (requestId !== activeRequest) return;
    if (!res.ok) throw new Error(data.error || "Explanation failed.");
    renderExplanation(data);
  } catch (err) {
    if (requestId === activeRequest) {
      els.explanation.innerHTML = `<p class="section" style="color:var(--r)">${err.message}</p>`;
    }
  }
}

// Small SF-style line icons for each section header (inline SVG, stroke =
// currentColor so they pick up the section's accent color).
const ICONS = {
  plain:
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  when:
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  how: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  words:
    '<path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  example: '<path d="M6 4l13 8-13 8z"/>',
  deck: '<path d="M12 2 2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
};

// Per-deck accent for the "How to use with your deck" section, as an "r, g, b"
// triple. All three precons are multicolor, so these are hand-picked to be
// distinct and on-theme rather than derived from color identity (which would
// make them all gold). Unknown decks fall back to green via the CSS default.
const DECK_ACCENTS = {
  "tmnt-turtle-power": "95, 194, 131", // green — turtles
  "sultai-arisen": "150, 123, 220", // violet — graveyard/Sultai
  "riders-of-rohan": "224, 102, 104", // crimson — Rohan/Boros, distinct from the gold headers
};

function renderExplanation(data) {
  const e = data.explanation;
  const sections = [];

  if (data.demo) {
    sections.push(
      `<div class="demo-banner">Demo preview — sample explanation. Connect an API key for real, accurate explanations of any card.</div>`
    );
  }

  sections.push(
    section(
      "In plain words",
      `<p>${withManaSymbols(e.in_plain_words)}</p>`,
      ICONS.plain
    )
  );

  // "How it works" sits right below "In plain words" — it's the part beginners
  // reach for first when a card is confusing.
  if (Array.isArray(e.how_it_works) && e.how_it_works.length) {
    // The <ol> already numbers each step; strip any leading "1. " / "2) " the
    // model may have added so beginners don't see doubled numbers.
    const steps = e.how_it_works
      .map(
        (s) =>
          `<li>${withManaSymbols(String(s).replace(/^\s*\d+[.)]\s*/, ""))}</li>`
      )
      .join("");
    sections.push(section("How it works", `<ol>${steps}</ol>`, ICONS.how));
  }

  if (e.in_your_deck) {
    // The player already picked their deck, so don't repeat its name here —
    // just label what this section is for.
    const title = "How to use with your deck";
    const accent = DECK_ACCENTS[selectedDeckId];
    const accentStyle = accent ? ` style="--deck-accent:${accent}"` : "";
    sections.push(
      `<details class="section in-deck" open${accentStyle}><summary><h3>${secIcon(
        ICONS.deck
      )}${title}</h3></summary><div class="section-body"><p>${withManaSymbols(
        e.in_your_deck
      )}</p></div></details>`
    );
  }

  sections.push(
    section(
      "When you can play it",
      `<p>${withManaSymbols(e.when_you_can_play_it)}</p>`,
      ICONS.when
    )
  );

  if (Array.isArray(e.words_to_know) && e.words_to_know.length) {
    // Each term is collapsed by default; tap it to reveal the definition.
    const terms = e.words_to_know
      .map(
        (t) =>
          `<details class="term-item"><summary><span class="term-name">${withManaSymbols(
            t.term
          )}</span></summary><div class="term-def">${withManaSymbols(
            t.definition
          )}</div></details>`
      )
      .join("");
    sections.push(
      section("Words to know", `<div class="terms">${terms}</div>`, ICONS.words)
    );
  }

  sections.push(
    section(
      "Example turn",
      `<p>${withManaSymbols(e.example_turn)}</p>`,
      ICONS.example
    )
  );

  els.explanation.innerHTML = sections.join("");

  if (data.demo) {
    els.meta.textContent = "Demo mode · no API key connected";
    return;
  }
  const when = data.generated_at
    ? new Date(data.generated_at).toLocaleDateString()
    : "";
  els.meta.textContent =
    (data.cached ? "Saved explanation" : "Freshly generated") +
    (when ? ` · ${when}` : "");
}

function secIcon(paths) {
  return `<span class="sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></span>`;
}

// Each section is a collapsible <details> (open by default) so players can fold
// away the parts they've read while scrolling a long explanation.
function section(title, bodyHtml, icon) {
  const head = (icon ? secIcon(icon) : "") + title;
  return `<details class="section" open><summary><h3>${head}</h3></summary><div class="section-body">${bodyHtml}</div></details>`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
