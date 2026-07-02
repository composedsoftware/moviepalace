/**
 * tmdb-server.ts
 *
 * Express web server that wraps the TMDB API.
 * Based on https://api.themoviedb.org (OpenAPI spec: tmdb-api.json)
 *
 * Endpoints exposed:
 *   GET /movies/search?query=<title>&year=<year>&page=<n>
 *   GET /movies/overlap?movie1=<title>&movie2=<title>
 *   GET /movies/:movieId
 *   GET /movies/:movieId/credits
 *
 * Run (dev):  npm run dev
 * Run (prod): npm run build && npm start
 */

import express, { Request, Response } from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

import {
  TmdbMovieSearchResponse,
  TmdbMovieDetails,
  TmdbCreditsResponse,
  MovieSearchResponse,
  MovieDetails,
  CreditsResponse,
  OverlapResponse,
  ErrorResponse,
} from "./moviepalace-types";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

// ─── TMDB client ────────────────────────────────────────────────────────────

const TMDB_BASE = "https://api.themoviedb.org";
const TMDB_TOKEN = process.env.TMDB_TOKEN;

if (!TMDB_TOKEN) {
  console.error("Error: TMDB_TOKEN environment variable is not set.");
  process.exit(1);
}

/** Custom error class that carries the HTTP status code from TMDB responses. */
class TmdbApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "TmdbApiError";
  }
}

/**
 * Make an authenticated GET request to the TMDB API.
 * @param path   - e.g. "/3/search/movie"
 * @param params - query string parameters (undefined/null/"" values are omitted)
 */
async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(TMDB_BASE + path);

  // Attach query parameters — mirrors the OpenAPI parameter definitions
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { status_message?: string };
    throw new TmdbApiError(body.status_message ?? "TMDB API error", response.status);
  }

  return response.json() as Promise<T>;
}

// ─── Error helper ───────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  if (err instanceof TmdbApiError) {
    res.status(err.status).json({ error: err.message } satisfies ErrorResponse);
  } else if (err instanceof Error) {
    res.status(500).json({ error: err.message } satisfies ErrorResponse);
  } else {
    res.status(500).json({ error: "An unexpected error occurred" } satisfies ErrorResponse);
  }
}

/** Resolve a TMDB image path to a full URL, or return null. */
function imageUrl(path: string | null, size: string): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /movies/search
 * Wraps: GET /3/search/movie
 *
 * Query params (from OpenAPI spec):
 *   query    (required) - movie title to search
 *   year     (optional) - filter by release year
 *   page     (optional, default: 1) - paginate results
 *   language (optional, default: en-US)
 *
 * Returns: MovieSearchResponse
 */
app.get(
  "/movies/search",
  async (
    req: Request<{}, MovieSearchResponse | ErrorResponse, {}, { query?: string; year?: string; page?: string; language?: string }>,
    res: Response
  ) => {
    const { query, year, page, language } = req.query;

    if (!query) {
      res.status(400).json({ error: '"query" parameter is required' } satisfies ErrorResponse);
      return;
    }

    try {
      const data = await tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", {
        query,
        year,
        page,
        language,
      });

      const results = data.results.map((m) => ({
        id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        popularity: m.popularity,
        poster_path: imageUrl(m.poster_path, "w500"),
      }));

      res.json({
        page: data.page,
        total_results: data.total_results,
        total_pages: data.total_pages,
        results,
      } satisfies MovieSearchResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);

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
 * Returns: OverlapResponse
 */
app.get(
  "/movies/overlap",
  async (
    req: Request<{}, OverlapResponse | ErrorResponse, {}, { movie1?: string; movie2?: string; year1?: string; year2?: string }>,
    res: Response
  ) => {
    const { movie1, movie2, year1, year2 } = req.query;

    if (!movie1 || !movie2) {
      res.status(400).json({ error: '"movie1" and "movie2" parameters are required' } satisfies ErrorResponse);
      return;
    }

    try {
      // Step 1: Search for both movies in parallel
      const [search1, search2] = await Promise.all([
        tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", { query: movie1, year: year1 }),
        tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", { query: movie2, year: year2 }),
      ]);

      if (!search1.results.length) {
        res.status(404).json({ error: `No movie found for "${movie1}"` } satisfies ErrorResponse);
        return;
      }
      if (!search2.results.length) {
        res.status(404).json({ error: `No movie found for "${movie2}"` } satisfies ErrorResponse);
        return;
      }

      const m1 = search1.results[0];
      const m2 = search2.results[0];

      // Step 2: Fetch credits for both movies in parallel
      const [credits1, credits2] = await Promise.all([
        tmdbGet<TmdbCreditsResponse>(`/3/movie/${m1.id}/credits`),
        tmdbGet<TmdbCreditsResponse>(`/3/movie/${m2.id}/credits`),
      ]);

      // Step 3: Find overlapping cast by actor ID
      const castMap1 = new Map(credits1.cast.map((a) => [a.id, a]));
      const castMap2 = new Map(credits2.cast.map((a) => [a.id, a]));

      const overlap = Array.from(castMap1.entries())
        .filter(([actorId]) => castMap2.has(actorId))
        .map(([actorId, actor]) => ({
          id: actorId,
          name: actor.name,
          character_in_movie1: actor.character,
          character_in_movie2: castMap2.get(actorId)!.character,
          profile_path: imageUrl(actor.profile_path, "w185"),
        }));

      res.json({
        movie1: { id: m1.id, title: m1.title, release_date: m1.release_date },
        movie2: { id: m2.id, title: m2.title, release_date: m2.release_date },
        overlap_count: overlap.length,
        overlap,
      } satisfies OverlapResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);

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
 * Returns: MovieDetails
 */
app.get(
  "/movies/:movieId",
  async (
    req: Request<{ movieId: string }, MovieDetails | ErrorResponse, {}, { language?: string }>,
    res: Response
  ) => {
    const { movieId } = req.params;
    const { language } = req.query;

    try {
      const movie = await tmdbGet<TmdbMovieDetails>(`/3/movie/${movieId}`, { language });

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
        poster_path: imageUrl(movie.poster_path, "w500"),
        backdrop_path: imageUrl(movie.backdrop_path, "original"),
        imdb_id: movie.imdb_id,
      } satisfies MovieDetails);
    } catch (err) {
      handleError(res, err);
    }
  }
);

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
 * Returns: CreditsResponse
 */
app.get(
  "/movies/:movieId/credits",
  async (
    req: Request<{ movieId: string }, CreditsResponse | ErrorResponse, {}, { language?: string }>,
    res: Response
  ) => {
    const { movieId } = req.params;
    const { language } = req.query;

    try {
      const data = await tmdbGet<TmdbCreditsResponse>(`/3/movie/${movieId}/credits`, { language });

      const cast = data.cast.map((member) => ({
        id: member.id,
        name: member.name,
        character: member.character,
        order: member.order,
        profile_path: imageUrl(member.profile_path, "w185"),
      }));

      res.json({ movie_id: data.id, cast } satisfies CreditsResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`TMDB server running at http://localhost:${PORT}`);
  console.log(`  GET /movies/search?query=Inception`);
  console.log(`  GET /movies/642`);
  console.log(`  GET /movies/642/credits`);
  console.log(`  GET /movies/overlap?movie1=Butch+Cassidy...&movie2=Donnie+Darko`);
});
