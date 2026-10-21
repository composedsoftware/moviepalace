/**
 * populate-popular.ts
 *
 * Finds N popular movies from TMDB that are not yet in the Movie table and
 * adds them, including full details, keywords, genres, and top-billed cast.
 * Finishes by rebuilding the Keyword table and re-sorting Movie.keywords.
 *
 * Usage:
 *   npm run db:populate-popular          → adds 100 movies
 *   npm run db:populate-popular -- 50    → adds 50 movies
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { addMovieFromTmdb, rebuildKeywordTable, sortAllKeywords } from "../lib/catalog";

const TARGET = Math.max(1, parseInt(process.argv[2] ?? "100", 10));

interface TmdbPopularResult {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
}

interface TmdbPopularResponse {
  page: number;
  results: TmdbPopularResult[];
  total_pages: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nTarget: ${TARGET} new popular movie(s)\n`);

  // Load all existing movie IDs so we know what to skip
  const existing = await prisma.movie.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((m) => m.id));
  console.log(`Movies already in DB: ${existingIds.size}\n`);

  // ── Phase 1: Collect candidate IDs from TMDB popular pages ──────────────
  const candidates: TmdbPopularResult[] = [];
  let page = 1;
  let totalPages = 1;

  while (candidates.length < TARGET && page <= totalPages) {
    const popular = await tmdbGet<TmdbPopularResponse>("/3/movie/popular", { page });
    totalPages = popular.total_pages;

    for (const movie of popular.results) {
      if (!existingIds.has(movie.id)) {
        candidates.push(movie);
        if (candidates.length >= TARGET) break;
      }
    }

    console.log(`  Page ${page}/${totalPages} scanned — ${candidates.length}/${TARGET} candidates found`);
    page++;
  }

  if (candidates.length === 0) {
    console.log("\nNo new movies found in TMDB popular list — DB may already contain them all.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFetching details for ${candidates.length} movie(s)…\n`);

  // ── Phase 2: Fetch details + keywords + credits, then upsert ────────────
  let added = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const { details, keywords, topCast } = await addMovieFromTmdb(candidate.id);

      added++;
      const year = details.release_date?.slice(0, 4) ?? "?";
      const castPreview = topCast.slice(0, 3).map((a) => a.name).join(", ");
      console.log(`  [${String(added).padStart(3)}/${candidates.length}] "${details.title}" (${year}) — ${keywords.length} kw, cast: ${castPreview}…`);

    } catch (err) {
      failed++;
      console.error(`  ✗ "${candidate.title}" (${candidate.id}): ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Phase 3: Rebuild Keyword table ───────────────────────────────────────
  console.log(`\nRebuilding Keyword table…`);
  const kwCount = await rebuildKeywordTable();
  console.log(`  ${kwCount} distinct keyword(s) across all movies`);

  // ── Phase 4: Re-sort Movie.keywords by movieCount desc ───────────────────
  console.log(`\nSorting Movie.keywords by specificity…`);
  const sortedMovies = await sortAllKeywords();
  console.log(`  ${sortedMovies} movie(s) updated`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(48)}`);
  console.log(`Done.`);
  console.log(`  Added   : ${added}`);
  if (failed > 0) console.log(`  Failed  : ${failed}`);
  console.log(`  DB total: ${existingIds.size + added} movie(s)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
