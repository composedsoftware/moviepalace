/**
 * add-movie.ts
 *
 * Adds a single movie to the database by title search and populates all
 * associated tables (Movie, Actor, Keyword).
 *
 * Usage: npm run db:add-movie -- "Movie Title"
 *    or: npm run db:add-movie -- "Movie Title" 1982   (year disambiguates)
 *
 * Steps:
 *   1. Search TMDB for the title (+ optional year)
 *   2. Fetch full details, keywords, and top-billed credits
 *   3. Upsert the Movie row with all fields populated
 *   4. Upsert each top-cast Actor
 *   5. Rebuild the Keyword table from the full Movie catalog
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import {
  TmdbMovieSearchResponse,
  TmdbMovieDetails,
  TmdbKeywordsResponse,
  TmdbCreditsResponse,
} from "../moviepalace-types";

const TOP_CAST_LIMIT = 10;

const [, , titleArg, yearArg] = process.argv;

if (!titleArg) {
  console.error('Usage: npm run db:add-movie -- "Movie Title" [year]');
  process.exit(1);
}

async function rebuildKeywords() {
  const movies = await prisma.movie.findMany({ select: { keywords: true } });
  const counts = new Map<number, { name: string; count: number }>();

  for (const movie of movies) {
    if (!movie.keywords) continue;
    try {
      const kws = JSON.parse(movie.keywords) as { id: number; name: string }[];
      for (const kw of kws) {
        const existing = counts.get(kw.id);
        counts.set(kw.id, { name: kw.name, count: (existing?.count ?? 0) + 1 });
      }
    } catch { /* skip malformed rows */ }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  await prisma.keyword.deleteMany();
  await prisma.keyword.createMany({
    data: sorted.map(([id, { name, count }]) => ({ id, name, movieCount: count })),
  });
  console.log(`  Keyword table rebuilt — ${sorted.length} distinct keyword(s).`);
}

async function main() {
  // 1. Search
  console.log(`\nSearching TMDB for "${titleArg}"${yearArg ? ` (${yearArg})` : ""}…`);
  const search = await tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", {
    query: titleArg,
    ...(yearArg ? { year: yearArg } : {}),
  });

  if (!search.results.length) {
    console.error(`No TMDB results found for "${titleArg}".`);
    process.exit(1);
  }

  const hit = search.results[0];
  console.log(`  Found: "${hit.title}" (${hit.release_date?.slice(0, 4) ?? "?"}) — TMDB ID ${hit.id}`);

  // 2. Fetch details, keywords, credits in parallel
  const [details, kwResponse, credits] = await Promise.all([
    tmdbGet<TmdbMovieDetails>(`/3/movie/${hit.id}`),
    tmdbGet<TmdbKeywordsResponse>(`/3/movie/${hit.id}/keywords`),
    tmdbGet<TmdbCreditsResponse>(`/3/movie/${hit.id}/credits`),
  ]);

  const keywords = kwResponse.keywords.map((k) => ({ id: k.id, name: k.name }));
  const topCast = credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, TOP_CAST_LIMIT);
  const topCastIds = topCast.map((a) => a.id);

  // 3. Upsert Movie
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
  console.log(`\n  Movie upserted: "${details.title}" (ID ${details.id})`);
  console.log(`  ${keywords.length} keyword(s), ${topCast.length} top-cast actor(s)`);

  // 4. Upsert Actors
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
  const castNames = topCast.slice(0, 5).map((a) => a.name).join(", ");
  console.log(`  Actors upserted: ${castNames}${topCast.length > 5 ? "…" : ""}`);

  // 5. Rebuild Keyword table
  console.log(`\n  Rebuilding Keyword table…`);
  await rebuildKeywords();

  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
