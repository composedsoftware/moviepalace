/**
 * populate-genre.ts
 *
 * Finds N of the most popular movies in a TMDB genre that are not yet in the
 * Movie table and adds them, including full details, keywords, genres, and
 * top-billed cast. Finishes by rebuilding the Keyword table and re-sorting
 * Movie.keywords. Only movies with a poster are added (the game needs one).
 *
 * The genre can be a name (case-insensitive) or a TMDB genre ID.
 *
 * Usage:
 *   npm run db:populate-genre -- Horror           → adds 100 horror movies
 *   npm run db:populate-genre -- "Science Fiction" 50
 *   npm run db:populate-genre -- 27 25            → by genre ID
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { addMovieFromTmdb, rebuildKeywordTable, sortAllKeywords } from "../lib/catalog";
import { TmdbGenre } from "../moviepalace-types";

const genreArg = process.argv[2];
const TARGET = Math.max(1, parseInt(process.argv[3] ?? "100", 10));

// Skip obscure titles with almost no votes; they make poor game material.
const MIN_VOTES = 100;

interface TmdbDiscoverResult {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
}

interface TmdbDiscoverResponse {
  page: number;
  results: TmdbDiscoverResult[];
  total_pages: number;
}

async function resolveGenre(arg: string): Promise<TmdbGenre> {
  const { genres } = await tmdbGet<{ genres: TmdbGenre[] }>("/3/genre/movie/list");
  const wanted = arg.trim().toLowerCase();
  const match = genres.find((g) => String(g.id) === wanted || g.name.toLowerCase() === wanted);
  if (!match) {
    console.error(`Unknown genre "${arg}". Valid genres:`);
    console.error(genres.map((g) => `  ${g.name} (${g.id})`).join("\n"));
    process.exit(1);
  }
  return match;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!genreArg) {
    console.error('Usage: npm run db:populate-genre -- <genre name or ID> [count]');
    process.exit(1);
  }

  const genre = await resolveGenre(genreArg);
  console.log(`\nGenre: ${genre.name} (${genre.id}) — target: ${TARGET} new movie(s)\n`);

  const existing = await prisma.movie.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((m) => m.id));
  console.log(`Movies already in DB: ${existingIds.size}\n`);

  // ── Phase 1: Collect candidates from TMDB discover, most popular first ──
  const candidates: TmdbDiscoverResult[] = [];
  const seen = new Set<number>(); // results shift between pages, so de-dupe
  let page = 1;
  let totalPages = 1;

  while (candidates.length < TARGET && page <= totalPages) {
    const discover = await tmdbGet<TmdbDiscoverResponse>("/3/discover/movie", {
      with_genres: genre.id,
      sort_by: "popularity.desc",
      "vote_count.gte": MIN_VOTES,
      page,
    });
    totalPages = Math.min(discover.total_pages, 500); // TMDB caps paging at 500

    for (const movie of discover.results) {
      if (existingIds.has(movie.id) || seen.has(movie.id) || !movie.poster_path) continue;
      seen.add(movie.id);
      candidates.push(movie);
      if (candidates.length >= TARGET) break;
    }

    console.log(`  Page ${page}/${totalPages} scanned — ${candidates.length}/${TARGET} candidates found`);
    page++;
  }

  if (candidates.length === 0) {
    console.log(`\nNo new ${genre.name} movies found — DB may already contain them all.`);
    await prisma.$disconnect();
    return;
  }

  if (candidates.length < TARGET) {
    console.log(`\nOnly ${candidates.length} new ${genre.name} movie(s) available (wanted ${TARGET}).`);
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
  console.log(`  Genre   : ${genre.name}`);
  console.log(`  Added   : ${added}`);
  if (failed > 0) console.log(`  Failed  : ${failed}`);
  console.log(`  DB total: ${existingIds.size + added} movie(s)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
