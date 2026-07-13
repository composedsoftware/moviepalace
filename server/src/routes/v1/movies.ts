import { Router, Request, Response } from "express";
import { tmdbGet, imageUrl, handleError } from "../../lib/tmdb";
import {
  TmdbMovieSearchResponse,
  TmdbMovieDetails,
  TmdbCreditsResponse,
  MovieSearchResponse,
  MovieDetails,
  CreditsResponse,
  OverlapResponse,
  ErrorResponse,
  TriviaQuestionResponse,
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
 * GET /v1/movies/overlap
 * Finds actors appearing in both of two movies.
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
router.get(
  "/overlap",
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
      const [search1, search2] = await Promise.all([
        tmdbGet<TmdbMovieSearchResponse>(`/${TMDB_API_VERSION}/search/movie`, { query: movie1, year: year1 }),
        tmdbGet<TmdbMovieSearchResponse>(`/${TMDB_API_VERSION}/search/movie`, { query: movie2, year: year2 }),
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

      const [credits1, credits2] = await Promise.all([
        tmdbGet<TmdbCreditsResponse>(`/${TMDB_API_VERSION}/movie/${m1.id}/credits`),
        tmdbGet<TmdbCreditsResponse>(`/${TMDB_API_VERSION}/movie/${m2.id}/credits`),
      ]);

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
        profile_path: imageUrl(member.profile_path, "w185"),
      }));

      res.json({ movie_id: data.id, cast } satisfies CreditsResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);

router.get(
  "/trivia/:questionId", 
  async (
    req: Request<{ questionId: string }, TriviaQuestionResponse | ErrorResponse, {}, {}>, 
    res: Response
  ) => {
    const { questionId } = req.params;
      
    try {
      res.json({
        question: "Which actor appeared in both movies?",
        movie1: {
          id: 123,
          title: "Movie One",
          overview: "Overview of Movie One",
          release_date: "2020-01-01",
          runtime: 120,
          budget: 10000000,
          revenue: 50000000,
          popularity: 7.5,
          genres: [{ id: 1, name: "Action" }],
          poster_path: null,
          backdrop_path: null,
          imdb_id: "tt1234567",
        },
        movie2: {
          id: 456,
          title: "Movie Two",
          overview: "Overview of Movie Two",
          release_date: "2021-01-01",
          runtime: 110,
          budget: 15000000,
          revenue: 60000000,
          popularity: 8.0,
          genres: [{ id: 2, name: "Comedy" }],
          poster_path: null,
          backdrop_path: null,
          imdb_id: "tt7654321",
        },
        answer: "John Doe",
        actors: [
          {
            id: 1,
            name: "John Doe",
            character: "Character in Movie One",
            order: 0,
            profile_path: null,
          },
          {
            id: 2,
            name: "Jane Smith",
            character: "Character in Movie Two",
            order: 1,
            profile_path: null,
          },
        ],  
      } satisfies TriviaQuestionResponse);
    } catch (err) {
      handleError(res, err);
    }
  }
);


export default router;
