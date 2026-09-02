/**
 * sort-movie-keywords.ts
 *
 * Re-sorts the keywords array in every Movie row by movieCount descending
 * (most common/least film-specific keywords first).
 *
 * Run: npm run db:sort-movie-keywords
 */

import dotenv from "dotenv";
dotenv.config();
import prisma from "../lib/db";

async function main() {
  // Build a movieCount lookup from the Keyword table
  const keywordRows = await prisma.keyword.findMany({ select: { id: true, movieCount: true } });
  const countMap = new Map(keywordRows.map((k) => [k.id, k.movieCount]));

  const movies = await prisma.movie.findMany({ select: { id: true, title: true, keywords: true } });
  console.log(`Sorting keywords for ${movies.length} movie(s)…\n`);

  let updated = 0;
  for (const movie of movies) {
    if (!movie.keywords) continue;
    try {
      const kws = JSON.parse(movie.keywords) as { id: number; name: string }[];
      const sorted = [...kws].sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0));
      await prisma.movie.update({
        where: { id: movie.id },
        data: { keywords: JSON.stringify(sorted) },
      });
      console.log(`  ✓ "${movie.title}"`);
      updated++;
    } catch {
      console.warn(`  ⚠ Could not process "${movie.title}" (${movie.id})`);
    }
  }

  console.log(`\nDone. ${updated} movie(s) updated.`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
