/**
 * populate-keywords.ts
 *
 * Rebuilds the Keyword table from the {id, name} objects stored in
 * Movie.keywords by sync-keywords.ts. Each row records the TMDB keyword ID,
 * its name, and how many movies in our catalog carry it.
 *
 * This is a full rebuild — existing Keyword rows are deleted and reinserted
 * every run, so it always reflects the current Movie data.
 *
 * Run: npm run db:populate-keywords
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";

interface StoredKeyword {
  id: number;
  name: string;
}

function parseKeywords(raw: string | null): StoredKeyword[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((k) => {
      if (k && typeof k === "object" && "id" in k && "name" in k &&
          typeof (k as StoredKeyword).id === "number" &&
          typeof (k as StoredKeyword).name === "string") {
        return [{ id: (k as StoredKeyword).id, name: (k as StoredKeyword).name }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

async function main() {
  const movies = await prisma.movie.findMany({
    select: { id: true, title: true, keywords: true },
  });

  // Tally keyword frequency — keyed by TMDB keyword ID
  const counts = new Map<number, { name: string; count: number }>();

  for (const movie of movies) {
    const keywords = parseKeywords(movie.keywords);
    if (keywords.length === 0 && movie.keywords !== null) {
      console.warn(`  ⚠ Could not parse keywords for "${movie.title}" (${movie.id}) — run db:sync-keywords --force`);
    }
    for (const kw of keywords) {
      const existing = counts.get(kw.id);
      counts.set(kw.id, { name: kw.name, count: (existing?.count ?? 0) + 1 });
    }
  }

  const sorted = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count);

  console.log(`${movies.length} movie(s) scanned. ${sorted.length} distinct keyword(s) found.\n`);

  // Full rebuild
  await prisma.keyword.deleteMany();
  await prisma.keyword.createMany({
    data: sorted.map(([id, { name, count }]) => ({ id, name, movieCount: count })),
  });

  console.log(`Top 20 keywords by frequency:`);
  for (const [id, { name, count }] of sorted.slice(0, 20)) {
    console.log(`  ${String(count).padStart(3)}  ${name.padEnd(35)} (TMDB ID: ${id})`);
  }
  console.log(`\nDone. ${sorted.length} keyword(s) written to the Keyword table.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
