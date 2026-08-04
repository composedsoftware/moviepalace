/**
 * sync-movies.ts
 *
 * Ensures Movie and QuestionMovie tables are fully in sync with the Question table.
 * Safe to re-run at any time — all writes are upserts.
 *
 * Supports all question types:
 *   cast_links   — TMDB IDs are embedded in the payload chain array
 *   shared_actor — movie titles extracted from question text via regex
 *   movie_detail — movie title extracted from question text via regex
 *
 * Run: npm run db:sync-movies
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { TmdbMovieSearchResponse, TmdbMovieDetails } from "../moviepalace-types";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MovieRef {
  title: string;
  year?: string;
  tmdb_id?: number; // when already known, skips the search step
}

interface CastLinksPayload {
  chain: { pos: number; film: string; tmdb_id: number | null }[];
}

interface TextQuestionPayload {
  question: string;
}

// ─── Payload parsers ─────────────────────────────────────────────────────────

function refsFromCastLinks(payload: string): MovieRef[] {
  const { chain } = JSON.parse(payload) as CastLinksPayload;
  return chain
    .filter((c) => c.tmdb_id !== null)
    .map((c) => ({ title: c.film, tmdb_id: c.tmdb_id! }));
}

function refsFromSharedActor(payload: string): MovieRef[] {
  const { question } = JSON.parse(payload) as TextQuestionPayload;

  // "in both Title (YEAR) and Title (YEAR)"
  const withYears = question.match(
    /in both (.+?)\s*\((\d{4})\)\s*and\s*(.+?)\s*\((\d{4})\)/i
  );
  if (withYears) {
    return [
      { title: withYears[1].trim(), year: withYears[2] },
      { title: withYears[3].trim(), year: withYears[4] },
    ];
  }

  // "in both X and Y?" — split on the last " and "
  const withoutYears = question.match(/in both (.+?)\?/i);
  if (withoutYears) {
    const combined = withoutYears[1];
    const lastAnd = combined.lastIndexOf(" and ");
    if (lastAnd !== -1) {
      return [
        { title: combined.substring(0, lastAnd).trim() },
        { title: combined.substring(lastAnd + 5).trim() },
      ];
    }
  }

  return [];
}

function refsFromMovieDetail(payload: string): MovieRef[] {
  const { question } = JSON.parse(payload) as TextQuestionPayload;
  const m = question.match(/was (.+?) released/i);
  return m ? [{ title: m[1].trim() }] : [];
}

function extractRefs(type: string, payload: string): MovieRef[] {
  if (type === "cast_links")   return refsFromCastLinks(payload);
  if (type === "shared_actor") return refsFromSharedActor(payload);
  if (type === "movie_detail") return refsFromMovieDetail(payload);
  return [];
}

// ─── TMDB fetch ───────────────────────────────────────────────────────────────

const tmdbCache = new Map<string, TmdbMovieDetails>();

async function fetchMovie(ref: MovieRef): Promise<TmdbMovieDetails> {
  const key = ref.tmdb_id ? String(ref.tmdb_id) : `${ref.title}|${ref.year ?? ""}`;
  if (tmdbCache.has(key)) return tmdbCache.get(key)!;

  let id: number;
  if (ref.tmdb_id) {
    id = ref.tmdb_id;
  } else {
    const search = await tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", {
      query: ref.title,
      ...(ref.year ? { year: ref.year } : {}),
    });
    if (!search.results.length) throw new Error(`No TMDB result for "${ref.title}"`);
    id = search.results[0].id;
  }

  const details = await tmdbGet<TmdbMovieDetails>(`/3/movie/${id}`);
  tmdbCache.set(key, details);
  return details;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const questions = await prisma.question.findMany({
    include: { movies: { select: { movieId: true } } },
  });

  console.log(`Syncing movies for ${questions.length} question(s)...\n`);

  let totalUpsertedMovies = 0;
  let totalCreatedLinks = 0;

  for (const question of questions) {
    const linkedIds = new Set(question.movies.map((m) => m.movieId));
    const refs = extractRefs(question.type, question.payload);

    if (!refs.length) {
      console.log(`Q${question.id} [${question.type}] — no movie refs extractable, skipping`);
      continue;
    }

    let newMovies = 0;
    let newLinks = 0;

    for (const ref of refs) {
      let movie: TmdbMovieDetails;
      try {
        movie = await fetchMovie(ref);
      } catch (err) {
        console.error(`  Q${question.id} ✗ "${ref.title}": ${err instanceof Error ? err.message : err}`);
        continue;
      }

      const upsertResult = await prisma.movie.upsert({
        where: { id: movie.id },
        update: {},
        create: {
          id: movie.id,
          title: movie.title,
          releaseDate: movie.release_date,
          posterPath: movie.poster_path,
          overview: movie.overview,
        },
      });
      if (upsertResult.fetchedAt > new Date(Date.now() - 2000)) newMovies++;

      if (!linkedIds.has(movie.id)) {
        await prisma.questionMovie.upsert({
          where: { questionId_movieId: { questionId: question.id, movieId: movie.id } },
          update: {},
          create: { questionId: question.id, movieId: movie.id },
        });
        linkedIds.add(movie.id);
        newLinks++;
      }
    }

    const status =
      newMovies === 0 && newLinks === 0
        ? "already in sync"
        : `+${newMovies} movie(s), +${newLinks} link(s)`;
    console.log(`Q${question.id} [${question.type}] — ${refs.length} movie(s) expected — ${status}`);

    totalUpsertedMovies += newMovies;
    totalCreatedLinks += newLinks;
  }

  console.log(`\nDone. ${totalUpsertedMovies} new movie row(s), ${totalCreatedLinks} new link(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
