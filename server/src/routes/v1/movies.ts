import { Router, Request, Response } from "express";
import { tmdbGet, handleError } from "../../lib/tmdb";
import prisma from "../../lib/db";
import { generateChain, posterUrl } from "../../lib/connections";
import {
  TmdbMovieSearchResponse,
  TmdbMovieDetails,
  TmdbCreditsResponse,
  MovieSearchResponse,
  MovieDetails,
  CreditsResponse,
  ErrorResponse,
  ActorResponse,
  MovieWithCast,
  QuestionWithMoviesResponse,
} from "../../moviepalace-types";

const router = Router();

const TMDB_API_VERSION = 3;

/** Parse a JSON array of IDs (Movie.genres, Movie.topCast) into a number[]; malformed or missing -> []. */
function parseIdList(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}

/**
 * GET /v1/movies/search
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
router.get(
  "/search",
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
      const data = await tmdbGet<TmdbMovieSearchResponse>(`/${TMDB_API_VERSION}/search/movie`, {
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
        poster_path: m.poster_path,
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
 * GET /v1/movies/question/:questionId
 *
 * Retrieves a stored question with full movie and cast data for every linked film.
 *
 * Path params:
 *   questionId (required) - Question.id (integer)
 *
 * Returns: QuestionWithMoviesResponse
 */
router.get(
  "/question/:questionId",
  async (
    req: Request<{ questionId: string }, QuestionWithMoviesResponse | ErrorResponse>,
    res: Response
  ) => {
    const questionId = Number.parseInt(req.params.questionId, 10);

    if (Number.isNaN(questionId)) {
      res.status(400).json({ error: '"questionId" must be an integer' } satisfies ErrorResponse);
      return;
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        movies: {
          include: {
            movie: {
              select: {
                id: true,
                title: true,
                releaseDate: true,
                posterPath: true,
                overview: true,
                keywords: true,
                topCast: true,
              },
            },
          },
        },
      },
    });

    if (!question) {
      res.status(404).json({ error: `No question with ID ${questionId}` } satisfies ErrorResponse);
      return;
    }

    // Parse topCast JSON arrays from every linked movie, collect unique actor IDs
    const parseIds = (raw: string | null): number[] => {
      try {
        const parsed = JSON.parse(raw ?? "[]") as unknown;
        return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : [];
      } catch { return []; }
    };

    const allActorIds = [...new Set(question.movies.flatMap((qm) => parseIds(qm.movie.topCast)))];

    // Fetch all needed actors in one query, build a lookup map
    const actorRows = await prisma.actor.findMany({ where: { id: { in: allActorIds } } });
    const actorMap = new Map(actorRows.map((a) => [a.id, a]));

    const movies: MovieWithCast[] = question.movies.map((qm) => {
      const m = qm.movie;

      const topCast: ActorResponse[] = parseIds(m.topCast)
        .map((id) => actorMap.get(id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined)
        .map((a) => ({
          id: a.id,
          name: a.name,
          profilePath: a.profilePath,
          popularity: a.popularity,
          knownForDepartment: a.knownForDepartment,
        }));

      const keywordList: string[] = (() => {
        try {
          const parsed = JSON.parse(m.keywords ?? "[]") as unknown;
          if (!Array.isArray(parsed)) return [];
          return parsed.flatMap((k) => {
            if (typeof k === "string") return [k];
            if (k && typeof k === "object" && "name" in k && typeof (k as { name: unknown }).name === "string")
              return [(k as { name: string }).name];
            return [];
          });
        } catch { return []; }
      })();

      return {
        id: m.id,
        title: m.title,
        releaseDate: m.releaseDate,
        posterUrl: m.posterPath,
        overview: m.overview,
        keywords: keywordList,
        topCast,
      };
    });

    res.json({
      id: question.id,
      type: question.type,
      difficulty: question.difficulty,
      payload: JSON.parse(question.payload) as Record<string, unknown>,
      createdAt: question.createdAt.toISOString(),
      movies,
    } satisfies QuestionWithMoviesResponse);
  }
);

/**
 * GET /v1/movies/suggest?q=
 *
 * Searches the local Movie table for titles containing the query string.
 * Intended for the autocomplete dropdown on the blurred-poster page.
 *
 * Query params:
 *   q (required) - search string, min 2 characters
 *
 * Returns: { results: [{ id, title, year }] }
 */
router.get(
  "/suggest",
  async (
    req: Request<{}, unknown, {}, { q?: string }>,
    res: Response
  ) => {
    const q = String(req.query.q ?? "").trim();

    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const movies = await prisma.movie.findMany({
      where: { title: { contains: q } },
      select: { id: true, title: true, releaseDate: true },
      take: 8,
      orderBy: { title: "asc" },
    });

    res.json({
      results: movies.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.releaseDate?.slice(0, 4) ?? null,
      })),
    });
  }
);

/**
 * GET /v1/movies/genres
 *
 * Lists the genres that at least one poster-bearing movie in the local database
 * belongs to, with how many such movies each has. Feeds the genre filter on the
 * blurred-poster page.
 *
 * Returns: { genres: [{ id, name, count }] } sorted by name
 */
router.get(
  "/genres",
  async (_req: Request, res: Response) => {
    const movies = await prisma.movie.findMany({
      where: { posterPath: { not: null }, genres: { not: null } },
      select: { genres: true },
    });

    const counts = new Map<number, number>();
    for (const m of movies) {
      for (const id of parseIdList(m.genres)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    const rows = await prisma.genre.findMany({
      where: { id: { in: [...counts.keys()] } },
      orderBy: { name: "asc" },
    });

    res.json({ genres: rows.map((g) => ({ id: g.id, name: g.name, count: counts.get(g.id) ?? 0 })) });
  }
);

/**
 * GET /v1/movies/random
 *
 * Returns a random movie from the local database that has a poster image.
 * Intended for the blurred-poster feature.
 *
 * Query params:
 *   genres (optional) - comma-separated genre IDs; a movie matches if it has ANY of them
 *
 * Returns: { id, title, releaseDate, posterUrl, keywords, matchCount }
 *   matchCount - how many movies satisfied the filter
 */
router.get(
  "/random",
  async (
    req: Request<{}, unknown, {}, { genres?: string }>,
    res: Response
  ) => {
    const wantedGenres = new Set(
      String(req.query.genres ?? "")
        .split(",")
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n))
    );

    const all = await prisma.movie.findMany({
      where: { posterPath: { not: null } },
      select: { id: true, title: true, releaseDate: true, posterPath: true, keywords: true, genres: true },
    });

    const movies = wantedGenres.size
      ? all.filter((m) => parseIdList(m.genres).some((id) => wantedGenres.has(id)))
      : all;

    if (!movies.length) {
      const error = wantedGenres.size
        ? "No movies match the selected genres"
        : "No movies with poster images found";
      res.status(404).json({ error } satisfies ErrorResponse);
      return;
    }

    const pick = movies[Math.floor(Math.random() * movies.length)];

    // Resolve keyword movieCounts from the Keyword table
    let keywords: { id: number; name: string; movieCount: number }[] = [];
    try {
      const parsed = JSON.parse(pick.keywords ?? "[]") as { id: number; name: string }[];
      if (parsed.length > 0) {
        const kwIds = parsed.map((k) => k.id);
        const kwRows = await prisma.keyword.findMany({
          where: { id: { in: kwIds } },
          select: { id: true, movieCount: true },
        });
        const countMap = new Map(kwRows.map((k) => [k.id, k.movieCount]));
        keywords = parsed.map((k) => ({
          id: k.id,
          name: k.name,
          movieCount: countMap.get(k.id) ?? 1,
        }));
      }
    } catch { /* ignore malformed keyword JSON */ }

    res.json({
      id: pick.id,
      title: pick.title,
      releaseDate: pick.releaseDate ?? null,
      posterUrl: pick.posterPath ? `https://image.tmdb.org/t/p/w500${pick.posterPath}` : null,
      keywords,
      matchCount: movies.length,
    });
  }
);

/**
 * GET /v1/movies/connections
 *
 * Generates a connections puzzle from the local database: a chain of films where
 * each adjacent pair shares a top-billed actor. Feeds the puzzle-generator page.
 *
 * Query params:
 *   length (optional, default 7, 3-10) - films in the chain
 *   avoid  (optional) - comma-separated movie IDs to leave out (e.g. recent puzzles)
 *
 * Returns: { requested, steps: [{ id, title, year, posterUrl, via? }] }
 *   steps may be shorter than requested when every attempt dead-ends
 */
router.get(
  "/connections",
  async (
    req: Request<{}, unknown, {}, { length?: string; avoid?: string }>,
    res: Response
  ) => {
    const parsed = parseInt(String(req.query.length ?? "7"), 10);
    const length = Number.isInteger(parsed) ? Math.min(10, Math.max(3, parsed)) : 7;
    const avoid = new Set(
      String(req.query.avoid ?? "")
        .split(",")
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n))
    );

    const steps = await generateChain(length, avoid);
    if (!steps.length) {
      res.status(404).json({ error: "No movies with cast data found" } satisfies ErrorResponse);
      return;
    }
    res.json({ requested: length, steps });
  }
);

/**
 * GET /v1/movies/actors/suggest?q=
 *
 * Searches the local Actor table by name, most popular first.
 * Feeds the link guesses on the puzzle-generator page.
 *
 * Query params:
 *   q (required) - search string, min 2 characters
 *
 * Returns: { results: [{ id, name }] }
 */
router.get(
  "/actors/suggest",
  async (req: Request<{}, unknown, {}, { q?: string }>, res: Response) => {
    const q = String(req.query.q ?? "").trim();

    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const actors = await prisma.actor.findMany({
      where: { name: { contains: q } },
      select: { id: true, name: true },
      take: 8,
      orderBy: { popularity: "desc" },
    });

    res.json({ results: actors });
  }
);

/**
 * GET /v1/movies/actors/:actorId/films
 *
 * Lists local movies where the actor is top-billed, newest first.
 *
 * Returns: { actor: { id, name }, films: [{ id, title, year, billing, posterUrl }] }
 *   billing - 1-based position in the film's top-billed cast
 */
router.get(
  "/actors/:actorId/films",
  async (req: Request<{ actorId: string }>, res: Response) => {
    const actorId = Number.parseInt(req.params.actorId, 10);
    if (Number.isNaN(actorId)) {
      res.status(400).json({ error: '"actorId" must be an integer' } satisfies ErrorResponse);
      return;
    }

    const actor = await prisma.actor.findUnique({ where: { id: actorId }, select: { id: true, name: true } });
    if (!actor) {
      res.status(404).json({ error: `No actor with ID ${actorId}` } satisfies ErrorResponse);
      return;
    }

    // topCast is a JSON array of IDs; the LIKE narrows the scan, the parse confirms the match
    const rows = await prisma.movie.findMany({
      where: { topCast: { contains: String(actorId) } },
      select: { id: true, title: true, releaseDate: true, posterPath: true, topCast: true },
    });

    const films = rows
      .map((m) => ({ m, billing: parseIdList(m.topCast).indexOf(actorId) + 1 }))
      .filter(({ billing }) => billing > 0)
      .sort((a, b) => (b.m.releaseDate ?? "").localeCompare(a.m.releaseDate ?? ""))
      .map(({ m, billing }) => ({
        id: m.id,
        title: m.title,
        year: m.releaseDate?.slice(0, 4) ?? null,
        billing,
        posterUrl: posterUrl(m.posterPath),
      }));

    res.json({ actor, films });
  }
);

/**
 * GET /v1/movies/:movieId/cast
 *
 * The movie's top-billed cast from the local database (Movie.topCast + Actor),
 * in billing order. Unlike /:movieId/credits, this never calls TMDB.
 *
 * Returns: { movie: { id, title, year }, cast: [{ id, name, popularity, billing }] }
 */
router.get(
  "/:movieId/cast",
  async (req: Request<{ movieId: string }>, res: Response) => {
    const movieId = Number.parseInt(req.params.movieId, 10);
    if (Number.isNaN(movieId)) {
      res.status(400).json({ error: '"movieId" must be an integer' } satisfies ErrorResponse);
      return;
    }

    const movie = await prisma.movie.findUnique({
      where: { id: movieId },
      select: { id: true, title: true, releaseDate: true, topCast: true },
    });
    if (!movie) {
      res.status(404).json({ error: `No movie with ID ${movieId}` } satisfies ErrorResponse);
      return;
    }

    const ids = parseIdList(movie.topCast);
    const actorRows = await prisma.actor.findMany({ where: { id: { in: ids } } });
    const actorMap = new Map(actorRows.map((a) => [a.id, a]));

    res.json({
      movie: { id: movie.id, title: movie.title, year: movie.releaseDate?.slice(0, 4) ?? null },
      cast: ids.flatMap((id, i) => {
        const a = actorMap.get(id);
        return a ? [{ id: a.id, name: a.name, popularity: a.popularity, billing: i + 1 }] : [];
      }),
    });
  }
);

/**
 * GET /v1/movies/:movieId
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
router.get(
  "/:movieId",
  async (
    req: Request<{ movieId: string }, MovieDetails | ErrorResponse, {}, { language?: string }>,
    res: Response
  ) => {
    const { movieId } = req.params;
    const { language } = req.query;

    try {
      const movie = await tmdbGet<TmdbMovieDetails>(`/${TMDB_API_VERSION}/movie/${movieId}`, { language });

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
        poster_path: movie.poster_path,
        backdrop_path: movie.backdrop_path,
        imdb_id: movie.imdb_id,
      } satisfies MovieDetails);
    } catch (err) {
      handleError(res, err);
    }
  }
);

/**
 * GET /v1/movies/:movieId/credits
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
router.get(
  "/:movieId/credits",
  async (
    req: Request<{ movieId: string }, CreditsResponse | ErrorResponse, {}, { language?: string }>,
    res: Response
  ) => {
    const { movieId } = req.params;
    const { language } = req.query;

    try {
      const data = await tmdbGet<TmdbCreditsResponse>(`/${TMDB_API_VERSION}/movie/${movieId}/credits`, { language });

      const cast = data.cast.map((member) => ({
        id: member.id,
        name: member.name,
        character: member.character,
        order: member.order,
        profile_path: member.profile_path,
      }));

      res.json({ movie_id: data.id, cast } satisfies CreditsResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);

export default router;
