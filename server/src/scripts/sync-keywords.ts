/**
 * sync-keywords.ts
 *
 * Fetches keyword data from TMDB for every Movie in the database and stores
 * the keyword names as a JSON array in Movie.keywords.
 *
 * Safe to re-run — movies that already have keywords are skipped unless
 * --force is passed as a CLI argument.
 *
 * Run: npm run db:sync-keywords
 * Run (force refresh all): npm run db:sync-keywords -- --force
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { TmdbKeywordsResponse } from "../moviepalace-types";

const force = process.argv.includes("--force");

async function main() {
  const movies = await prisma.movie.findMany({
    orderBy: { id: "asc" },
  });

  const toSync = force ? movies : movies.filter((m) => m.keywords === null);

  console.log(
    `${movies.length} movie(s) in database. ` +
    `${toSync.length} need keyword sync${force ? " (--force)" : ""}.\n`
  );

  let updated = 0;
  let failed = 0;

  for (const movie of toSync) {
    try {
      const response = await tmdbGet<TmdbKeywordsResponse>(
        `/3/movie/${movie.id}/keywords`
      );

      const keywordNames = response.keywords.map((k) => k.name);

      await prisma.movie.update({
        where: { id: movie.id },
        data: { keywords: JSON.stringify(keywordNames) },
      });

      console.log(`  ✓ "${movie.title}" — ${keywordNames.length} keyword(s): ${keywordNames.slice(0, 5).join(", ")}${keywordNames.length > 5 ? "…" : ""}`);
      updated++;
    } catch (err) {
      console.error(`  ✗ "${movie.title}" (${movie.id}): ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone. ${updated} updated, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
