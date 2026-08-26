import { Router, Request, Response } from "express";
import { tmdbGet, handleError } from "../../lib/tmdb";
import prisma from "../../lib/db";
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
