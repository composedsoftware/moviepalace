import { Router, Request, Response } from "express";
import prisma from "../../lib/db";
import { imageUrl } from "../../lib/tmdb";
import {
  CreateQuestionRequest,
  UpdateQuestionRequest,
  QuestionResponse,
  QuestionListResponse,
  QuestionDetailResponse,
  StoredMovie,
  StoredMovieListResponse,
  ErrorResponse,
} from "../../moviepalace-types";

const router = Router();

const VALID_DIFFICULTIES = ["easy", "medium", "hard"] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Shared include so every question read returns the same shape
const questionInclude = {
  movies: {
    include: { movie: { select: { id: true, title: true } } },
  },
} as const;

type QuestionRow = {
  id: number;
  type: string;
  difficulty: string;
  payload: string;
  createdAt: Date;
  movies: { movie: { id: number; title: string } }[];
};

function toQuestionResponse(question: QuestionRow): QuestionResponse {
  return {
    id: question.id,
    type: question.type,
    difficulty: question.difficulty,
    payload: parseJsonObject(question.payload),
    createdAt: question.createdAt.toISOString(),
    movies: question.movies.map((qm) => qm.movie),
  };
}

/** Payload and keywords are stored as JSON strings; a hand-edited row shouldn't 500 the list. */
function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _raw: parsed };
  } catch {
    return { _unparseable: raw };
  }
}

function parseKeywords(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

type MovieRow = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  overview: string | null;
  keywords: string | null;
};

function toStoredMovie(movie: MovieRow): StoredMovie {
  return {
    id: movie.id,
    title: movie.title,
    releaseDate: movie.releaseDate,
    posterUrl: imageUrl(movie.posterPath, "w342"),
    overview: movie.overview,
    keywords: parseKeywords(movie.keywords),
  };
}

const movieSelect = {
  id: true,
  title: true,
  releaseDate: true,
  posterPath: true,
  overview: true,
  keywords: true,
} as const;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function isValidDifficulty(value: unknown): value is (typeof VALID_DIFFICULTIES)[number] {
  return typeof value === "string" && VALID_DIFFICULTIES.includes(value as (typeof VALID_DIFFICULTIES)[number]);
}

/**
 * GET /v1/admin/questions
 *
 * Lists stored questions, newest first.
 *
 * Query params:
 *   limit      (optional, default 50, max 200)
 *   offset     (optional, default 0)
 *   type       (optional) - filter by question type, e.g. "cast_links"
 *   difficulty (optional) - "easy" | "medium" | "hard"
 *
 * Returns: QuestionListResponse
 */
router.get(
  "/questions",
  async (
    req: Request<{}, QuestionListResponse | ErrorResponse, {}, { limit?: string; offset?: string; type?: string; difficulty?: string }>,
    res: Response
  ) => {
    const { type, difficulty } = req.query;

    if (difficulty && !isValidDifficulty(difficulty)) {
      res.status(400).json({ error: '"difficulty" must be "easy", "medium", or "hard"' } satisfies ErrorResponse);
      return;
    }

    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const where = { ...(type && { type }), ...(difficulty && { difficulty }) };

    const [total, questions] = await Promise.all([
      prisma.question.count({ where }),
      prisma.question.findMany({
        where,
        include: questionInclude,
        orderBy: { id: "asc" },
        take: limit,
        skip: offset,
      }),
    ]);

    res.json({
      total,
      limit,
      offset,
      questions: questions.map(toQuestionResponse),
    } satisfies QuestionListResponse);
  }
);

/**
 * GET /v1/admin/questions/:questionId
 *
 * A single question with its linked movies expanded (posters, keywords) so the
 * admin UI can render the puzzle chain without extra round trips.
 *
 * Returns: QuestionDetailResponse
 */
router.get(
  "/questions/:questionId",
  async (
    req: Request<{ questionId: string }, QuestionDetailResponse | ErrorResponse>,
    res: Response
  ) => {
    const questionId = Number.parseInt(req.params.questionId, 10);

    if (Number.isNaN(questionId)) {
      res.status(400).json({ error: '"questionId" must be an integer' } satisfies ErrorResponse);
      return;
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { movies: { include: { movie: { select: movieSelect } } } },
    });

    if (!question) {
      res.status(404).json({ error: `No question with ID ${questionId}` } satisfies ErrorResponse);
      return;
    }

    res.json({
      id: question.id,
      type: question.type,
      difficulty: question.difficulty,
      payload: parseJsonObject(question.payload),
      createdAt: question.createdAt.toISOString(),
      movies: question.movies.map((qm) => toStoredMovie(qm.movie)),
    } satisfies QuestionDetailResponse);
  }
);

/**
 * PUT /v1/admin/questions/:questionId
 *
 * Updates an existing question. Every field is optional — only what's sent is
 * changed. Passing "movieIds" replaces the question's movie links wholesale.
 *
 * Returns: QuestionResponse
 */
router.put(
  "/questions/:questionId",
  async (
    req: Request<{ questionId: string }, QuestionResponse | ErrorResponse, UpdateQuestionRequest>,
    res: Response
  ) => {
    const questionId = Number.parseInt(req.params.questionId, 10);

    if (Number.isNaN(questionId)) {
      res.status(400).json({ error: '"questionId" must be an integer' } satisfies ErrorResponse);
      return;
    }

    const { type, difficulty, payload, movieIds } = req.body;

    if (type !== undefined && (typeof type !== "string" || !type.trim())) {
      res.status(400).json({ error: '"type" must be a non-empty string' } satisfies ErrorResponse);
      return;
    }

    if (difficulty !== undefined && !isValidDifficulty(difficulty)) {
      res.status(400).json({ error: '"difficulty" must be "easy", "medium", or "hard"' } satisfies ErrorResponse);
      return;
    }

    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      res.status(400).json({ error: '"payload" must be an object' } satisfies ErrorResponse);
      return;
    }

    if (movieIds !== undefined && (!Array.isArray(movieIds) || movieIds.some((id) => !Number.isInteger(id)))) {
      res.status(400).json({ error: '"movieIds" must be an array of integers' } satisfies ErrorResponse);
      return;
    }

    const existing = await prisma.question.findUnique({ where: { id: questionId } });
    if (!existing) {
      res.status(404).json({ error: `No question with ID ${questionId}` } satisfies ErrorResponse);
      return;
    }

    try {
      // Links are replaced as a set, so drop and recreate inside one transaction
      const question = await prisma.$transaction(async (tx) => {
        if (movieIds !== undefined) {
          await tx.questionMovie.deleteMany({ where: { questionId } });
          if (movieIds.length) {
            await tx.questionMovie.createMany({
              data: [...new Set(movieIds)].map((movieId) => ({ questionId, movieId })),
            });
          }
        }

        return tx.question.update({
          where: { id: questionId },
          data: {
            ...(type !== undefined && { type }),
            ...(difficulty !== undefined && { difficulty }),
            ...(payload !== undefined && { payload: JSON.stringify(payload) }),
          },
          include: questionInclude,
        });
      });

      res.json(toQuestionResponse(question) satisfies QuestionResponse);
    } catch (err) {
      if (isPrismaForeignKeyError(err)) {
        res.status(422).json({ error: "One or more movieIds do not exist. Add the movies first." } satisfies ErrorResponse);
        return;
      }
      throw err;
    }
  }
);

/**
 * GET /v1/admin/movies
 *
 * Lists movies already cached in our database. A question can only link to
 * these IDs, so the admin UI picks from here rather than searching TMDB.
 *
 * Query params:
 *   query (optional) - title substring filter
 *   limit (optional, default 50, max 200)
 *
 * Returns: StoredMovieListResponse
 */
router.get(
  "/movies",
  async (
    req: Request<{}, StoredMovieListResponse | ErrorResponse, {}, { query?: string; limit?: string }>,
    res: Response
  ) => {
    const { query } = req.query;
    const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const where = query ? { title: { contains: query } } : {};

    const [total, movies] = await Promise.all([
      prisma.movie.count({ where }),
      prisma.movie.findMany({
        where,
        select: movieSelect,
        orderBy: { title: "asc" },
        take: limit,
      }),
    ]);

    res.json({ total, movies: movies.map(toStoredMovie) } satisfies StoredMovieListResponse);
  }
);

/**
 * POST /v1/questions
 *
 * Creates a new pre-built quiz question and persists it to the database.
 *
 * Body:
 *   type       (required) - question category, e.g. "shared_actor"
 *   difficulty (required) - "easy" | "medium" | "hard"
 *   payload    (required) - the full question object the client will receive
 *   movieIds   (optional) - TMDB movie IDs to link to this question (must already exist in the Movie table)
 *
 * Returns: QuestionResponse
 */
router.post(
  "/question",
  async (
    req: Request<{}, QuestionResponse | ErrorResponse, CreateQuestionRequest>,
    res: Response
  ) => {
    const { type, difficulty, payload, movieIds } = req.body;

    if (!type || typeof type !== "string") {
      res.status(400).json({ error: '"type" is required and must be a string' } satisfies ErrorResponse);
      return;
    }

    if (!difficulty || !VALID_DIFFICULTIES.includes(difficulty)) {
      res.status(400).json({ error: '"difficulty" must be "easy", "medium", or "hard"' } satisfies ErrorResponse);
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      res.status(400).json({ error: '"payload" is required and must be an object' } satisfies ErrorResponse);
      return;
    }

    try {
      const question = await prisma.question.create({
        data: {
          type,
          difficulty,
          payload: JSON.stringify(payload),
          ...(movieIds?.length && {
            movies: {
              create: movieIds.map((movieId) => ({ movieId })),
            },
          }),
        },
        include: questionInclude,
      });

      res.status(201).json(toQuestionResponse(question) satisfies QuestionResponse);
    } catch (err) {
      // Prisma throws a specific error code when a foreign key constraint fails
      if (isPrismaForeignKeyError(err)) {
        res.status(422).json({ error: "One or more movieIds do not exist. Add the movies first." } satisfies ErrorResponse);
        return;
      }
      throw err;
    }
  }
);

function isPrismaForeignKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2003"
  );
}

export default router;
