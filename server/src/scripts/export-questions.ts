/**
 * export-questions.ts
 *
 * Exports all rows from the Question table (plus their QuestionMovie links)
 * to a JSON file that can be re-imported with import-questions.ts.
 *
 * Usage:
 *   npm run db:export-questions                          → exports/questions.json
 *   npm run db:export-questions -- ./my-backup.json     → custom path
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import prisma from "../lib/db";

const DEFAULT_OUT = path.join(process.cwd(), "exports", "questions.json");
const outPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT;

async function main() {
  const questions = await prisma.question.findMany({
    include: { movies: { select: { movieId: true } } },
    orderBy: { id: "asc" },
  });

  const payload = {
    version: 1,
    schema: "moviepalace",
    exportedAt: new Date().toISOString(),
    count: questions.length,
    questions: questions.map((q) => ({
      id: q.id,
      type: q.type,
      difficulty: q.difficulty,
      payload: q.payload,
      createdAt: q.createdAt.toISOString(),
      movieIds: q.movies.map((m) => m.movieId),
    })),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log(`Exported ${questions.length} question(s) to ${outPath}`);

  // Summary by type
  const byType = new Map<string, number>();
  for (const q of questions) byType.set(q.type, (byType.get(q.type) ?? 0) + 1);
  for (const [type, count] of [...byType.entries()].sort()) {
    console.log(`  ${String(count).padStart(3)}  ${type}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
