/**
 * sync-actors.ts
 *
 * Fetches top-billed cast from TMDB for every Movie in the database.
 * For each movie:
 *   - Upserts each actor into the Actor table.
 *   - Stores an ordered JSON array of actor IDs in Movie.topCast.
 *
 * "Top-billed" is the first TOP_CAST_LIMIT entries in the credits response,
 * sorted by the TMDB `order` field (0 = highest billing).
 *
 * Safe to re-run — movies with topCast already set are skipped unless
 * --force is passed.
 *
 * Run:         npm run db:sync-actors
 * Force-refresh: npm run db:sync-actors -- --force
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { TmdbCreditsResponse } from "../moviepalace-types";

const TOP_CAST_LIMIT = 10;
const force = process.argv.includes("--force");

async function main() {
  const movies = await prisma.movie.findMany({ orderBy: { id: "asc" } });
  const toSync = force ? movies : movies.filter((m) => m.topCast === null);

  console.log(
    `${movies.length} movie(s) in database. ` +
    `${toSync.length} need actor sync${force ? " (--force)" : ""}.\n`
  );

  let updated = 0;
  let failed = 0;

  for (const movie of toSync) {
    try {
      const credits = await tmdbGet<TmdbCreditsResponse>(`/3/movie/${movie.id}/credits`);

      const topCast = credits.cast
        .sort((a, b) => a.order - b.order)
        .slice(0, TOP_CAST_LIMIT);

      // Upsert each actor — update name/profile in case TMDB data has changed
      for (const member of topCast) {
        await prisma.actor.upsert({
          where: { id: member.id },
          create: {
            id: member.id,
            name: member.name,
            profilePath: member.profile_path ?? null,
            popularity: member.popularity ?? null,
            knownForDepartment: member.known_for_department ?? null,
          },
          update: {
            name: member.name,
            profilePath: member.profile_path ?? null,
            popularity: member.popularity ?? null,
            knownForDepartment: member.known_for_department ?? null,
            fetchedAt: new Date(),
          },
        });
      }

      const actorIds = topCast.map((m) => m.id);
      await prisma.movie.update({
        where: { id: movie.id },
        data: { topCast: JSON.stringify(actorIds) },
      });

      const names = topCast.slice(0, 3).map((m) => m.name).join(", ");
      console.log(`  ✓ "${movie.title}" — ${topCast.length} actor(s): ${names}${topCast.length > 3 ? "…" : ""}`);
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
