/**
 * MoviePalace admin — browse and edit stored puzzles.
 *
 * Talks to the admin API on the same origin (see server/src/webServer.ts):
 *   GET  /v1/admin/questions
 *   GET  /v1/admin/questions/:id
 *   POST /v1/admin/question
 *   PUT  /v1/admin/questions/:id
 *   GET  /v1/admin/movies
 */

const CHAIN_LENGTH = 7;
const DIFFICULTIES = ["easy", "medium", "hard"];

const state = {
  questions: [],
  movies: [],
  moviesByTitle: new Map(),
  selectedId: null,
  detail: null,
  filterType: "",
  filterDifficulty: "",
  editing: null, // null = creating, otherwise the question being edited
  mode: "chain",
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

// ─── API ─────────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed (${response.status})`);
  }
  return data;
}

async function loadQuestions() {
  const params = new URLSearchParams({ limit: "200" });
  if (state.filterType.trim()) params.set("type", state.filterType.trim());
  if (state.filterDifficulty) params.set("difficulty", state.filterDifficulty);

  const data = await api(`/v1/admin/questions?${params}`);
  state.questions = data.questions;
  return data;
}

async function loadMovies() {
  const data = await api("/v1/admin/movies?limit=200");
  state.movies = data.movies;
  state.moviesByTitle = new Map(data.movies.map((m) => [m.title.toLowerCase(), m]));
  return data;
}

async function loadDetail(id) {
  state.detail = await api(`/v1/admin/questions/${id}`);
}

// ─── Payload helpers ─────────────────────────────────────────────────────────

const isCastLinks = (question) => question?.type === "cast_links";

/** The actor bridging positions n → n+1, if the payload declares one. */
function actorBetween(payload, fromPos) {
  const link = (payload?.links ?? []).find(
    (l) => l.from_pos === fromPos && l.to_pos === fromPos + 1
  );
  return link?.intended_actor ?? null;
}

function puzzleLabel(question) {
  const number = question.payload?.puzzle_number;
  if (isCastLinks(question) && number != null) return `Puzzle ${number}`;
  return question.type;
}

function chainSummary(question) {
  const chain = question.payload?.chain;
  if (Array.isArray(chain) && chain.length) {
    return `${chain[0]?.film ?? "?"} → ${chain[chain.length - 1]?.film ?? "?"}`;
  }
  return `${question.movies.length} movie${question.movies.length === 1 ? "" : "s"} linked`;
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function renderList() {
  const list = $("question-list");

  if (!state.questions.length) {
    list.innerHTML = `<li class="empty" style="height:auto;padding:40px 16px">
      <span class="empty-mark">∅</span>
      <span>No puzzles match.</span>
    </li>`;
    return;
  }

  list.innerHTML = state.questions
    .map(
      (q) => `
      <li class="question-item ${q.id === state.selectedId ? "is-selected" : ""}" data-id="${q.id}">
        <div class="qi-head">
          <span class="qi-id">#${q.id}</span>
          <span class="qi-title">${esc(puzzleLabel(q))}</span>
          <span class="badge badge-${esc(q.difficulty)}">${esc(q.difficulty)}</span>
        </div>
        <div class="qi-sub">${esc(chainSummary(q))}</div>
      </li>`
    )
    .join("");

  list.querySelectorAll(".question-item").forEach((item) => {
    item.addEventListener("click", () => select(Number(item.dataset.id)));
  });
}

async function select(id) {
  state.selectedId = id;
  renderList();
  $("detail").innerHTML = `<div class="empty"><span>Loading…</span></div>`;

  try {
    await loadDetail(id);
    renderDetail();
  } catch (err) {
    renderError(err);
  }
}

// ─── Detail ──────────────────────────────────────────────────────────────────

function renderDetail() {
  const question = state.detail;
  if (!question) return renderEmpty();

  const moviesById = new Map(question.movies.map((m) => [m.id, m]));
  const created = new Date(question.createdAt).toLocaleString();

  $("detail").innerHTML = `
    <div class="detail-head">
      <h2>${esc(puzzleLabel(question))}</h2>
      <span class="badge badge-${esc(question.difficulty)}">${esc(question.difficulty)}</span>
      <button class="btn" id="edit-btn">Edit</button>
    </div>
    <p class="meta">#${question.id} · ${esc(question.type)} · ${question.movies.length} movies linked · created ${esc(created)}</p>
    ${isCastLinks(question) ? renderChain(question, moviesById) : ""}
    <details class="raw-toggle" ${isCastLinks(question) ? "" : "open"}>
      <summary>Raw payload</summary>
      <div class="raw-block">${esc(JSON.stringify(question.payload, null, 2))}</div>
    </details>
  `;

  $("edit-btn").addEventListener("click", () => openEditor(question));
}

function renderChain(question, moviesById) {
  const chain = [...(question.payload?.chain ?? [])].sort((a, b) => a.pos - b.pos);
  if (!chain.length) return "";

  const parts = ['<section class="chain"><p class="section-label">Chain</p>'];

  chain.forEach((entry, index) => {
    const movie = entry.tmdb_id != null ? moviesById.get(entry.tmdb_id) : null;
    const year = movie?.releaseDate ? movie.releaseDate.slice(0, 4) : null;

    const poster = movie?.posterUrl
      ? `<img class="poster" src="${esc(movie.posterUrl)}" alt="" loading="lazy">`
      : `<div class="poster poster-missing">?</div>`;

    // The payload carries the authored title; the cached row carries TMDB's
    const subtitle =
      entry.tmdb_id == null
        ? `<span class="film-missing">not resolved to a TMDB movie</span>`
        : `${year ? esc(year) + " · " : ""}<span class="tmdb-id">TMDB ${entry.tmdb_id}</span>${
            movie ? "" : ` · <span class="film-missing">not in movie cache</span>`
          }`;

    parts.push(`
      <div class="film">
        <span class="film-pos">${entry.pos}</span>
        ${poster}
        <div class="film-body">
          <div class="film-title">${esc(entry.film)}</div>
          <div class="film-sub">${subtitle}</div>
          ${movie?.keywords?.length ? renderKeywords(movie.keywords) : ""}
        </div>
      </div>`);

    if (index < chain.length - 1) {
      const actor = actorBetween(question.payload, entry.pos);
      parts.push(`
        <div class="link-rail">
          <div class="rail-line"></div>
          <span class="actor ${actor ? "" : "actor-warn"}">
            <span class="actor-icon">↕</span>&nbsp;${esc(actor ?? "no actor set")}
          </span>
        </div>`);
    }
  });

  parts.push("</section>");
  return parts.join("");
}

function renderKeywords(keywords) {
  return `<div class="keywords">${keywords
    .slice(0, 6)
    .map((k) => `<span class="kw">${esc(k)}</span>`)
    .join("")}</div>`;
}

function renderEmpty() {
  $("detail").innerHTML = `<div class="empty">
    <span class="empty-mark">◇</span>
    <p>Select a puzzle to see its chain.</p>
  </div>`;
}

function renderError(err) {
  $("detail").innerHTML = `<div class="empty">
    <span class="empty-mark">!</span>
    <p>${esc(err.message)}</p>
  </div>`;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function blankPayload() {
  return {
    puzzle_number: nextPuzzleNumber(),
    chain: Array.from({ length: CHAIN_LENGTH }, (_, i) => ({ pos: i + 1, film: "", tmdb_id: null })),
    links: Array.from({ length: CHAIN_LENGTH - 1 }, (_, i) => ({
      from_pos: i + 1,
      to_pos: i + 2,
      intended_actor: "",
    })),
  };
}

function nextPuzzleNumber() {
  const numbers = state.questions
    .map((q) => q.payload?.puzzle_number)
    .filter((n) => Number.isInteger(n));
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function openEditor(question) {
  state.editing = question ?? null;
  const payload = question ? structuredClone(question.payload) : blankPayload();

  $("editor-title").textContent = question ? `Edit puzzle #${question.id}` : "New puzzle";
  $("f-type").value = question?.type ?? "cast_links";
  $("f-difficulty").value = question?.difficulty ?? "medium";
  $("f-puzzle-number").value = payload.puzzle_number ?? "";
  $("f-raw").value = JSON.stringify(payload, null, 2);
  $("editor-error").textContent = "";

  // Anything that isn't a well-formed cast_links payload edits as raw JSON
  setMode(canUseChainEditor(question?.type ?? "cast_links", payload) ? "chain" : "raw");
  renderChainEditor(payload);

  $("type-options").innerHTML = [...new Set(state.questions.map((q) => q.type))]
    .map((t) => `<option value="${esc(t)}">`)
    .join("");

  $("editor").showModal();
}

function canUseChainEditor(type, payload) {
  return (
    type === "cast_links" &&
    Array.isArray(payload?.chain) &&
    payload.chain.length === CHAIN_LENGTH &&
    Array.isArray(payload?.links)
  );
}

function setMode(mode) {
  state.mode = mode;
  $("chain-editor").hidden = mode !== "chain";
  $("raw-editor").hidden = mode !== "raw";
  document.querySelectorAll(".mode-switch .seg").forEach((seg) => {
    seg.classList.toggle("is-active", seg.dataset.mode === mode);
  });
}

function renderChainEditor(payload) {
  const chain = [...(payload.chain ?? [])].sort((a, b) => a.pos - b.pos);
  const rows = [];

  for (let i = 0; i < CHAIN_LENGTH; i += 1) {
    const entry = chain[i] ?? { pos: i + 1, film: "", tmdb_id: null };

    rows.push(`
      <div class="chain-row">
        <span class="film-pos">${i + 1}</span>
        <input class="input film-input" list="movie-options" data-film="${i}"
               value="${esc(entry.film)}" placeholder="Film title" autocomplete="off">
        <input class="input id-input mono" type="number" data-tmdb="${i}"
               value="${entry.tmdb_id ?? ""}" placeholder="TMDB id">
      </div>`);

    if (i < CHAIN_LENGTH - 1) {
      const actor = actorBetween(payload, i + 1) ?? "";
      rows.push(`
        <div class="actor-row">
          <span class="label">Linked by</span>
          <input class="input actor-input" data-actor="${i}"
                 value="${esc(actor)}" placeholder="Actor in both films" autocomplete="off">
        </div>`);
    }
  }

  $("chain-rows").innerHTML = rows.join("");

  $("movie-options").innerHTML = state.movies
    .map((m) => `<option value="${esc(m.title)}">${esc(m.releaseDate?.slice(0, 4) ?? "")}</option>`)
    .join("");

  // Choosing a cached movie fills in its TMDB ID
  $("chain-rows")
    .querySelectorAll("[data-film]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const match = state.moviesByTitle.get(input.value.trim().toLowerCase());
        if (match) {
          $("chain-rows").querySelector(`[data-tmdb="${input.dataset.film}"]`).value = match.id;
        }
      });
    });
}

function collectChainPayload() {
  const rows = $("chain-rows");
  const chain = [];
  const links = [];

  for (let i = 0; i < CHAIN_LENGTH; i += 1) {
    const film = rows.querySelector(`[data-film="${i}"]`).value.trim();
    const rawId = rows.querySelector(`[data-tmdb="${i}"]`).value.trim();

    if (!film) throw new Error(`Film ${i + 1} needs a title.`);

    chain.push({ pos: i + 1, film, tmdb_id: rawId === "" ? null : Number(rawId) });

    if (i < CHAIN_LENGTH - 1) {
      links.push({
        from_pos: i + 1,
        to_pos: i + 2,
        intended_actor: rows.querySelector(`[data-actor="${i}"]`).value.trim(),
      });
    }
  }

  const missingActor = links.findIndex((l) => !l.intended_actor);
  if (missingActor !== -1) {
    throw new Error(`Films ${missingActor + 1} and ${missingActor + 2} need a linking actor.`);
  }

  const puzzleNumber = Number($("f-puzzle-number").value);
  if (!Number.isInteger(puzzleNumber) || puzzleNumber < 1) {
    throw new Error("Puzzle # must be a positive whole number.");
  }

  return { puzzle_number: puzzleNumber, chain, links };
}

function collectRawPayload() {
  let parsed;
  try {
    parsed = JSON.parse($("f-raw").value);
  } catch {
    throw new Error("Payload is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object.");
  }
  return parsed;
}

async function save() {
  const errorEl = $("editor-error");
  errorEl.textContent = "";

  let payload;
  let type;
  try {
    payload = state.mode === "chain" ? collectChainPayload() : collectRawPayload();

    type = $("f-type").value.trim();
    if (!type) throw new Error("Type is required.");

    if (!DIFFICULTIES.includes($("f-difficulty").value)) {
      throw new Error("Pick a difficulty.");
    }
  } catch (err) {
    errorEl.textContent = err.message;
    return;
  }

  // Links follow the chain: every resolved TMDB ID becomes a QuestionMovie row
  const movieIds = [
    ...new Set(
      (payload.chain ?? [])
        .map((entry) => entry.tmdb_id)
        .filter((id) => Number.isInteger(id))
    ),
  ];

  const body = { type, difficulty: $("f-difficulty").value, payload, movieIds };
  const saveBtn = $("save-btn");
  saveBtn.disabled = true;

  try {
    const saved = state.editing
      ? await api(`/v1/admin/questions/${state.editing.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
      : await api("/v1/admin/question", { method: "POST", body: JSON.stringify(body) });

    $("editor").close();
    await refresh(saved.id);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function refresh(selectId) {
  try {
    const [questionData, movieData] = await Promise.all([loadQuestions(), loadMovies()]);

    $("stat-line").textContent =
      `${questionData.total} puzzle${questionData.total === 1 ? "" : "s"} · ${movieData.total} movies cached`;

    renderList();

    const target =
      selectId ??
      (state.questions.some((q) => q.id === state.selectedId)
        ? state.selectedId
        : state.questions[0]?.id);

    if (target != null) {
      await select(target);
    } else {
      state.selectedId = null;
      renderEmpty();
    }
  } catch (err) {
    renderError(err);
    $("stat-line").textContent = "offline";
  }
}

function initTheme() {
  const stored = localStorage.getItem("mp-admin-theme");
  const preferred =
    stored ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = preferred;

  $("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("mp-admin-theme", next);
  });
}

function initFilters() {
  let debounce;
  $("filter-type").addEventListener("input", (event) => {
    state.filterType = event.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 250);
  });

  $("filter-difficulty").addEventListener("click", (event) => {
    const button = event.target.closest(".seg");
    if (!button) return;

    state.filterDifficulty = button.dataset.difficulty;
    $("filter-difficulty")
      .querySelectorAll(".seg")
      .forEach((seg) => seg.classList.toggle("is-active", seg === button));
    refresh();
  });
}

function initEditor() {
  $("new-btn").addEventListener("click", () => openEditor(null));
  $("save-btn").addEventListener("click", save);

  document.querySelector(".mode-switch").addEventListener("click", (event) => {
    const button = event.target.closest(".seg");
    if (!button) return;

    // Carry edits across when switching, so neither view loses work
    try {
      if (button.dataset.mode === "raw" && state.mode === "chain") {
        $("f-raw").value = JSON.stringify(collectChainPayload(), null, 2);
      } else if (button.dataset.mode === "chain" && state.mode === "raw") {
        const payload = collectRawPayload();
        if (!canUseChainEditor($("f-type").value.trim(), payload)) {
          throw new Error("This payload isn't a 7-film cast_links chain — edit it as raw JSON.");
        }
        $("f-puzzle-number").value = payload.puzzle_number ?? "";
        renderChainEditor(payload);
      }
      $("editor-error").textContent = "";
      setMode(button.dataset.mode);
    } catch (err) {
      $("editor-error").textContent = err.message;
    }
  });
}

initTheme();
initFilters();
initEditor();
refresh();
