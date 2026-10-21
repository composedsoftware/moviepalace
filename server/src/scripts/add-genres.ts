/**
 * add-genres.ts
 *
 * Upgrades an existing database with genre support:
 *   1. Creates the Genre lookup table (TMDB genre ID -> name) if missing
 *   2. Adds the Movie.genres column (JSON array of genre IDs) if missing
 *   3. Loads every TMDB movie genre into Genre
 *   4. Fills Movie.genres for every movie that doesn't have it yet
 *
 * Safe to re-run: already-populated movies are skipped.
 *
 * Run: npm run db:add-genres
 */

import "dotenv/config";

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { genreIdsJson } from "../lib/genres";
import { TmdbGenre, TmdbMovieDetails } from "../moviepalace-types";

async function ensureSchema() {
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "Genre" (
       "id"   INTEGER NOT NULL PRIMARY KEY,
       "name" TEXT    NOT NULL UNIQUE
     )`
  );

  const cols = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("Movie")`);
  if (!cols.some((c) => c.name === "genres")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Movie" ADD COLUMN "genres" TEXT`);
    console.log("Added Movie.genres column.");
  }
}

async function main() {
  await ensureSchema();

  const { genres } = await tmdbGet<{ genres: TmdbGenre[] }>("/3/genre/movie/list");
  for (const g of genres) {
    await prisma.genre.upsert({
      where: { id: g.id },
      create: { id: g.id, name: g.name },
      update: { name: g.name },
    });
  }
  console.log(`Genre table: ${genres.length} genre(s) loaded.\n`);

  const movies = await prisma.movie.findMany({
    where: { genres: null },
    select: { id: true, title: true },
    orderBy: { id: "asc" },
  });
  console.log(`${movies.length} movie(s) need genres.\n`);

  let updated = 0;
  let failed = 0;

  for (const movie of movies) {
    try {
      const details = await tmdbGet<TmdbMovieDetails>(`/3/movie/${movie.id}`);
      await prisma.movie.update({
        where: { id: movie.id },
        data: { genres: genreIdsJson(details.genres) },
      });
      updated++;
      const names = details.genres.map((g) => g.name).join(", ") || "none";
      console.log(`  [${updated}/${movies.length}] "${movie.title}" — ${names}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ "${movie.title}" (${movie.id}): ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone. Updated ${updated}${failed ? `, failed ${failed}` : ""}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
