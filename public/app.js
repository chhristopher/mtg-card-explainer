"use strict";

const SCRYFALL = "https://api.scryfall.com";

const els = {
  deck: document.getElementById("deck"),
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

// ---------- deck picker ----------

async function loadDecks() {
  try {
    const res = await fetch("/api/decks");
    const { decks } = await res.json();
    for (const d of decks) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = `${d.name} (${d.cardCount} cards)`;
      els.deck.appendChild(opt);
    }
    const saved = localStorage.getItem(DECK_KEY);
    if (saved && [...els.deck.options].some((o) => o.value === saved)) {
      els.deck.value = saved;
    }
  } catch {
    /* deck list is optional; the app still works without it */
  }
}

els.deck.addEventListener("change", () => {
  localStorage.setItem(DECK_KEY, els.deck.value);
  // Re-explain the current card with the new deck context, if one is shown.
  if (currentCard) selectCard(currentCard.name);
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
  els.oracle.textContent = combineOracle(card);

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
      body: JSON.stringify({ card, rulings, deckId: els.deck.value || null }),
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

function renderExplanation(data) {
  const e = data.explanation;
  const sections = [];

  if (data.demo) {
    sections.push(
      `<div class="demo-banner">Demo preview — sample explanation. Connect an API key for real, accurate explanations of any card.</div>`
    );
  }

  sections.push(
    section("In plain words", `<p>${esc(e.in_plain_words)}</p>`, ICONS.plain)
  );

  if (e.in_your_deck) {
    const title = data.deck_name ? `In ${esc(data.deck_name)}` : "In your deck";
    sections.push(
      `<div class="section in-deck"><h3>${secIcon(ICONS.deck)}${title}</h3><p>${esc(
        e.in_your_deck
      )}</p></div>`
    );
  }

  sections.push(
    section(
      "When you can play it",
      `<p>${esc(e.when_you_can_play_it)}</p>`,
      ICONS.when
    )
  );

  if (Array.isArray(e.how_it_works) && e.how_it_works.length) {
    // The <ol> already numbers each step; strip any leading "1. " / "2) " the
    // model may have added so beginners don't see doubled numbers.
    const steps = e.how_it_works
      .map((s) => `<li>${esc(String(s).replace(/^\s*\d+[.)]\s*/, ""))}</li>`)
      .join("");
    sections.push(section("How it works", `<ol>${steps}</ol>`, ICONS.how));
  }

  if (Array.isArray(e.words_to_know) && e.words_to_know.length) {
    const terms = e.words_to_know
      .map(
        (t) =>
          `<li><span class="term">${esc(t.term)}</span> — ${esc(
            t.definition
          )}</li>`
      )
      .join("");
    sections.push(
      section("Words to know", `<ul class="terms">${terms}</ul>`, ICONS.words)
    );
  }

  sections.push(
    section("Example turn", `<p>${esc(e.example_turn)}</p>`, ICONS.example)
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

function section(title, bodyHtml, icon) {
  const head = (icon ? secIcon(icon) : "") + title;
  return `<div class="section"><h3>${head}</h3>${bodyHtml}</div>`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
