/**
 * populate-popular.ts
 *
 * Finds N popular movies from TMDB that are not yet in the Movie table and
 * adds them, including full details, keywords, and top-billed cast.
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
import {
  TmdbMovieDetails,
  TmdbKeywordsResponse,
  TmdbCreditsResponse,
} from "../moviepalace-types";

const TARGET = Math.max(1, parseInt(process.argv[2] ?? "100", 10));
const TOP_CAST_LIMIT = 10;

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

// ─── Keyword table rebuild (mirrors populate-keywords.ts) ─────────────────────

interface StoredKeyword { id: number; name: string; }

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
  } catch { return []; }
}

async function rebuildKeywordTable() {
  const movies = await prisma.movie.findMany({ select: { keywords: true } });
  const counts = new Map<number, { name: string; count: number }>();

  for (const movie of movies) {
    for (const kw of parseKeywords(movie.keywords)) {
      const existing = counts.get(kw.id);
      counts.set(kw.id, { name: kw.name, count: (existing?.count ?? 0) + 1 });
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  await prisma.keyword.deleteMany();
  await prisma.keyword.createMany({
    data: sorted.map(([id, { name, count }]) => ({ id, name, movieCount: count })),
  });
  return sorted.length;
}

// ─── Sort Movie.keywords by movieCount desc (mirrors sort-movie-keywords.ts) ──

async function sortAllKeywords() {
  const kwRows = await prisma.keyword.findMany({ select: { id: true, movieCount: true } });
  const countMap = new Map(kwRows.map((k) => [k.id, k.movieCount]));

  const movies = await prisma.movie.findMany({ select: { id: true, keywords: true } });
  let updated = 0;

  for (const movie of movies) {
    if (!movie.keywords) continue;
    try {
      const kws = JSON.parse(movie.keywords) as StoredKeyword[];
      const sorted = [...kws].sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0));
      await prisma.movie.update({
        where: { id: movie.id },
        data: { keywords: JSON.stringify(sorted) },
      });
      updated++;
    } catch { /* skip malformed rows */ }
  }

  return updated;
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
      // Fetch details, keywords, and credits in parallel
      const [details, kwResponse, credits] = await Promise.all([
        tmdbGet<TmdbMovieDetails>(`/3/movie/${candidate.id}`),
        tmdbGet<TmdbKeywordsResponse>(`/3/movie/${candidate.id}/keywords`),
        tmdbGet<TmdbCreditsResponse>(`/3/movie/${candidate.id}/credits`),
      ]);

      const keywords = kwResponse.keywords.map((k) => ({ id: k.id, name: k.name }));
      const topCast = credits.cast
        .sort((a, b) => a.order - b.order)
        .slice(0, TOP_CAST_LIMIT);
      const topCastIds = topCast.map((a) => a.id);

      // Upsert Movie
      await prisma.movie.upsert({
        where: { id: details.id },
        create: {
          id: details.id,
          title: details.title,
          releaseDate: details.release_date || null,
          posterPath: details.poster_path || null,
          overview: details.overview || null,
          keywords: JSON.stringify(keywords),
          topCast: JSON.stringify(topCastIds),
        },
        update: {
          title: details.title,
          releaseDate: details.release_date || null,
          posterPath: details.poster_path || null,
          overview: details.overview || null,
          keywords: JSON.stringify(keywords),
          topCast: JSON.stringify(topCastIds),
          fetchedAt: new Date(),
        },
      });

      // Upsert top-cast Actors
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
