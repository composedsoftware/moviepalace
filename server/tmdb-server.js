/**
 * tmdb-server.js
 *
 * Express web server that wraps the TMDB API.
 * Based on https://api.themoviedb.org (OpenAPI spec: tmdb-api.json)
 *
 * Endpoints exposed:
 *   GET /movies/search?query=<title>&year=<year>&page=<n>
 *   GET /movies/:movieId
 *   GET /movies/:movieId/credits
 *   GET /movies/overlap?movie1=<title>&movie2=<title>
 *
 * Run:
 *   npm install express node-fetch
 *   TMDB_TOKEN=<your_bearer_token> node tmdb-server.js
 */

const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─── TMDB client ────────────────────────────────────────────────────────────

const TMDB_BASE = "https://api.themoviedb.org";
const TMDB_TOKEN = process.env.TMDB_TOKEN;

if (!TMDB_TOKEN) {
  console.error("Error: TMDB_TOKEN environment variable is not set.");
  process.exit(1);
}

/**
 * Make an authenticated GET request to the TMDB API.
 * @param {string} path  - e.g. "/3/search/movie"
 * @param {object} params - query string parameters
 * @returns {Promise<object>} parsed JSON response
 */
async function tmdbGet(path, params = {}) {
  const url = new URL(TMDB_BASE + path);

  // Attach query parameters — mirrors the OpenAPI parameter definitions
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(error.status_message || "TMDB API error");
    err.status = response.status;
    throw err;
  }

  return response.json();
}

// ─── Error helper ───────────────────────────────────────────────────────────

function handleError(res, err) {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /movies/search
 * Wraps: GET /3/search/movie
 *
 * Query params (from OpenAPI spec):
 *   query   (required) - movie title to search
 *   year    (optional) - filter by release year
 *   page    (optional, default: 1) - paginate results
 *   language (optional, default: en-US)
 *
 * Returns: { page, total_results, total_pages, results: [...] }
 */
app.get("/movies/search", async (req, res) => {
  const { query, year, page, language } = req.query;

  if (!query) {
    return res.status(400).json({ error: '"query" parameter is required' });
  }

  try {
    const data = await tmdbGet("/3/search/movie", {
      query,
      year,
      page,
      language,
    });

    // Return a trimmed version of each result
    const results = data.results.map((m) => ({
      id: m.id,
      title: m.title,
      release_date: m.release_date,
      overview: m.overview,
      popularity: m.popularity,
      poster_path: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : null,
    }));

    res.json({
      page: data.page,
      total_results: data.total_results,
      total_pages: data.total_pages,
      results,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /movies/overlap
 * Custom endpoint — finds actors appearing in both of two movies.
 * Internally calls /3/search/movie (twice) and /3/movie/{id}/credits (twice).
 *
 * Query params:
 *   movie1 (required) - title of the first movie
 *   movie2 (required) - title of the second movie
 *   year1  (optional) - release year of first movie (helps disambiguation)
 *   year2  (optional) - release year of second movie
 *
 * Returns: { movie1, movie2, overlap: [{ id, name, character_in_movie1, character_in_movie2 }] }
 */
app.get("/movies/overlap", async (req, res) => {
  const { movie1, movie2, year1, year2 } = req.query;

  if (!movie1 || !movie2) {
    return res
      .status(400)
      .json({ error: '"movie1" and "movie2" parameters are required' });
  }

  try {
    // Step 1: Search for both movies in parallel
    const [search1, search2] = await Promise.all([
      tmdbGet("/3/search/movie", { query: movie1, year: year1 }),
      tmdbGet("/3/search/movie", { query: movie2, year: year2 }),
    ]);

    if (!search1.results.length) {
      return res.status(404).json({ error: `No movie found for "${movie1}"` });
    }
    if (!search2.results.length) {
      return res.status(404).json({ error: `No movie found for "${movie2}"` });
    }

    const m1 = search1.results[0];
    const m2 = search2.results[0];

    // Step 2: Fetch credits for both movies in parallel
    const [credits1, credits2] = await Promise.all([
      tmdbGet(`/3/movie/${m1.id}/credits`),
      tmdbGet(`/3/movie/${m2.id}/credits`),
    ]);

    // Step 3: Find overlapping cast by actor ID
    const castMap1 = new Map(credits1.cast.map((a) => [a.id, a]));
    const castMap2 = new Map(credits2.cast.map((a) => [a.id, a]));

    const overlap = [];
    for (const [actorId, actor] of castMap1) {
      if (castMap2.has(actorId)) {
        overlap.push({
          id: actorId,
          name: actor.name,
          character_in_movie1: actor.character,
          character_in_movie2: castMap2.get(actorId).character,
          profile_path: actor.profile_path
            ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
            : null,
        });
      }
    }

    res.json({
      movie1: { id: m1.id, title: m1.title, release_date: m1.release_date },
      movie2: { id: m2.id, title: m2.title, release_date: m2.release_date },
      overlap_count: overlap.length,
      overlap,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /movies/:movieId
 * Wraps: GET /3/movie/{movie_id}
 *
 * Path params:
 *   movieId (required) - TMDB movie ID (integer)
 *
 * Query params (from OpenAPI spec):
 *   language (optional, default: en-US)
 *
 * Returns: full movie details (id, title, overview, genres, runtime, etc.)
 */
app.get("/movies/:movieId", async (req, res) => {
  const { movieId } = req.params;
  const { language } = req.query;

  try {
    const movie = await tmdbGet(`/3/movie/${movieId}`, { language });

    res.json({
      id: movie.id,
      title: movie.title,
      overview: movie.overview,
      release_date: movie.release_date,
      runtime: movie.runtime,
      budget: movie.budget,
      revenue: movie.revenue,
      popularity: movie.popularity,
      genres: movie.genres,
      poster_path: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      backdrop_path: movie.backdrop_path
        ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
        : null,
      imdb_id: movie.imdb_id,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /movies/:movieId/credits
 * Wraps: GET /3/movie/{movie_id}/credits
 *
 * Path params:
 *   movieId (required) - TMDB movie ID (integer)
 *
 * Query params (from OpenAPI spec):
 *   language (optional, default: en-US)
 *
 * Returns: { id, cast: [{ id, name, character, order, profile_path }] }
 */
app.get("/movies/:movieId/credits", async (req, res) => {
  const { movieId } = req.params;
  const { language } = req.query;

  try {
    const data = await tmdbGet(`/3/movie/${movieId}/credits`, { language });

    const cast = data.cast.map((member) => ({
      id: member.id,
      name: member.name,
      character: member.character,
      order: member.order,
      profile_path: member.profile_path
        ? `https://image.tmdb.org/t/p/w185${member.profile_path}`
        : null,
    }));

    res.json({ movie_id: data.id, cast });
  } catch (err) {
    handleError(res, err);
  }
});

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`TMDB server running at http://localhost:${PORT}`);
  console.log(`  GET /movies/search?query=Inception`);
  console.log(`  GET /movies/642`);
  console.log(`  GET /movies/642/credits`);
  console.log(`  GET /movies/overlap?movie1=Butch+Cassidy...&movie2=Donnie+Darko`);
});
