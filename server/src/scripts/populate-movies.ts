/**
 * populate-movies.ts
 *
 * Reads all Question records, extracts movie titles from the question text,
 * fetches their details from the TMDB API, and populates the Movie and
 * QuestionMovie tables.
 *
 * Run: npm run db:populate
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import {
  TmdbMovieSearchResponse,
  TmdbMovieDetails,
} from "../moviepalace-types";

// ─── Title extraction ────────────────────────────────────────────────────────

interface MovieRef {
  title: string;
  year?: string;
}

function extractMovieTitles(type: string, payload: string): MovieRef[] {
  const { question } = JSON.parse(payload) as { question: string };

  if (type === "movie_detail") {
    // Pattern: "was Title released"
    const released = question.match(/was (.+?) released/i);
    if (released) return [{ title: released[1].trim() }];
  }

  return [];
}

// ─── TMDB helpers ────────────────────────────────────────────────────────────

async function fetchMovieFromTmdb(ref: MovieRef) {
  const search = await tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", {
    query: ref.title,
    year: ref.year,
  });

  if (!search.results.length) {
    throw new Error(`No TMDB result found for "${ref.title}"`);
  }

  const result = search.results[0];
  const details = await tmdbGet<TmdbMovieDetails>(`/3/movie/${result.id}`);
  return details;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const questions = await prisma.question.findMany({
    include: { movies: true },
  });

  console.log(`Found ${questions.length} question(s) in the database.\n`);

  for (const question of questions) {
    console.log(`Question ${question.id} | ${question.type} | ${question.difficulty}`);

    if (question.movies.length > 0) {
      console.log(`  Already linked to ${question.movies.length} movie(s), skipping.\n`);
      continue;
    }

    const refs = extractMovieTitles(question.type, question.payload);

    if (!refs.length) {
      console.log(`  Could not extract movie titles from question text, skipping.\n`);
      continue;
    }

    for (const ref of refs) {
      try {
        const movie = await fetchMovieFromTmdb(ref);

        await prisma.movie.upsert({
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

        await prisma.questionMovie.upsert({
          where: {
            questionId_movieId: {
              questionId: question.id,
              movieId: movie.id,
            },
          },
          update: {},
          create: {
            questionId: question.id,
            movieId: movie.id,
          },
        });

        console.log(`  ✓ "${movie.title}" (TMDB ID: ${movie.id})`);
      } catch (err) {
        console.error(`  ✗ "${ref.title}": ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log();
  }

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
