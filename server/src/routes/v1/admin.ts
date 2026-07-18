import { Router, Request, Response } from "express";
import prisma from "../../lib/db";
import {
  CreateQuestionRequest,
  QuestionResponse,
  ErrorResponse,
} from "../../moviepalace-types";

const router = Router();

const VALID_DIFFICULTIES = ["easy", "medium", "hard"] as const;

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
        include: {
          movies: {
            include: { movie: { select: { id: true, title: true } } },
          },
        },
      });

      res.status(201).json({
        id: question.id,
        type: question.type,
        difficulty: question.difficulty,
        payload: JSON.parse(question.payload) as Record<string, unknown>,
        createdAt: question.createdAt.toISOString(),
        movies: question.movies.map((qm) => qm.movie),
      } satisfies QuestionResponse);
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
