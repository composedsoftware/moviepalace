/**
 * import-questions.ts
 *
 * Imports Question and QuestionMovie rows from a JSON file produced by
 * export-questions.ts.  Safe to re-run — all writes are skipped if the
 * row already exists, so running twice is a no-op.
 *
 * Prerequisites: Movie rows referenced by movieIds must already exist.
 * Run `npm run db:sync-movies` first if importing to a fresh database.
 *
 * Usage:
 *   npm run db:import-questions                          → exports/questions.json
 *   npm run db:import-questions -- ./my-backup.json     → custom path
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import prisma from "../lib/db";

const DEFAULT_IN = path.join(process.cwd(), "exports", "questions.json");
const inPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_IN;

interface ExportedQuestion {
  id: number;
  type: string;
  difficulty: string;
  payload: string;
  createdAt: string;
  movieIds: number[];
}

interface ExportFile {
  version: number;
  schema: string;
  exportedAt: string;
  count: number;
  questions: ExportedQuestion[];
}

async function main() {
  if (!fs.existsSync(inPath)) {
    console.error(`File not found: ${inPath}`);
    console.error(`Run "npm run db:export-questions" first to create an export.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf-8");
  const data = JSON.parse(raw) as ExportFile;

  if (data.schema !== "moviepalace") {
    console.error(`Unexpected schema identifier "${data.schema}" — wrong export file?`);
    process.exit(1);
  }

  console.log(`Importing from ${inPath}`);
  console.log(`  Exported at : ${data.exportedAt}`);
  console.log(`  Questions   : ${data.count}\n`);

  // Check which Movie IDs are actually present so we can warn about missing ones
  const allMovieIds = [...new Set(data.questions.flatMap((q) => q.movieIds))];
  const presentMovies = await prisma.movie.findMany({
    where: { id: { in: allMovieIds } },
    select: { id: true },
  });
  const presentMovieSet = new Set(presentMovies.map((m) => m.id));

  const missingMovieIds = allMovieIds.filter((id) => !presentMovieSet.has(id));
  if (missingMovieIds.length > 0) {
    console.warn(
      `  Warning: ${missingMovieIds.length} referenced movie ID(s) are not in the Movie table.`
    );
    console.warn(`  Run "npm run db:sync-all" after import to populate them.\n`);
  }

  let created = 0;
  let skipped = 0;
  let linksCreated = 0;
  let linksSkipped = 0;

  for (const q of data.questions) {
    const existing = await prisma.question.findUnique({ where: { id: q.id } });

    if (existing) {
      console.log(`  Q${q.id} [${q.type}] — already exists, skipping`);
      skipped++;
    } else {
      await prisma.question.create({
        data: {
          id: q.id,
          type: q.type,
          difficulty: q.difficulty,
          payload: q.payload,
          createdAt: new Date(q.createdAt),
        },
      });
      console.log(`  Q${q.id} [${q.type}] — created`);
      created++;
    }

    // Upsert movie links — idempotent regardless of whether question was new
    for (const movieId of q.movieIds) {
      if (!presentMovieSet.has(movieId)) {
        linksSkipped++;
        continue; // can't create FK reference to a missing movie
      }

      const linkExists = await prisma.questionMovie.findUnique({
        where: { questionId_movieId: { questionId: q.id, movieId } },
      });

      if (linkExists) {
        linksSkipped++;
      } else {
        await prisma.questionMovie.create({
          data: { questionId: q.id, movieId },
        });
        linksCreated++;
      }
    }
  }

  console.log(`\nDone.`);
  console.log(`  Questions : ${created} created, ${skipped} already existed`);
  console.log(`  Links     : ${linksCreated} created, ${linksSkipped} skipped`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
