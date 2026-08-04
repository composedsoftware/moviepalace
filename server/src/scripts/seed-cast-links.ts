/**
 * seed-cast-links.ts
 *
 * Populates the Question table with "cast_links" puzzle entries from the
 * Claude-created Puzzles spreadsheet.  For each puzzle it:
 *   1. Searches TMDB for every film title to resolve its canonical ID.
 *   2. Upserts Movie records.
 *   3. Inserts a Question record with a structured payload.
 *   4. Links all 7 movies to the question via QuestionMovie.
 *
 * Run: npm run db:seed-cast-links
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";
import { tmdbGet } from "../lib/tmdb";
import { TmdbMovieSearchResponse, TmdbMovieDetails } from "../moviepalace-types";

// ─── Puzzle data from spreadsheet ────────────────────────────────────────────

interface PuzzleLink {
  from_pos: number;
  to_pos: number;
  intended_actor: string;
}

interface FilmEntry {
  title: string;
  year?: number;    // added for TMDB disambiguation when needed
  tmdb_id?: number; // bypass search when the year alone isn't enough
}

interface PuzzleEntry {
  puzzle: number;
  difficulty: "easy" | "medium" | "hard";
  films: FilmEntry[];  // ordered, length 7
  links: PuzzleLink[]; // length 6, one per adjacent pair
}

const PUZZLES: PuzzleEntry[] = [
  {
    puzzle: 1,
    difficulty: "medium",
    films: [
      { title: "Jurassic Park", year: 1993 },
      { title: "Pulp Fiction", year: 1994 },
      { title: "Gattaca", year: 1997 },
      { title: "Training Day", year: 2001 },
      { title: "Philadelphia", year: 1993 },
      { title: "Cast Away", year: 2000 },
      { title: "As Good as It Gets", year: 1997 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Samuel L. Jackson" },
      { from_pos: 2, to_pos: 3, intended_actor: "Uma Thurman" },
      { from_pos: 3, to_pos: 4, intended_actor: "Ethan Hawke" },
      { from_pos: 4, to_pos: 5, intended_actor: "Denzel Washington" },
      { from_pos: 5, to_pos: 6, intended_actor: "Tom Hanks" },
      { from_pos: 6, to_pos: 7, intended_actor: "Helen Hunt" },
    ],
  },
  {
    puzzle: 2,
    difficulty: "medium",
    films: [
      { title: "The Matrix", year: 1999 },
      { title: "Memento", year: 2000 },
      { title: "L.A. Confidential", year: 1997 },
      { title: "Gladiator", year: 2000 },
      { title: "Walk the Line", year: 2005 },
      { title: "Legally Blonde", year: 2001 },
      { title: "The Royal Tenenbaums", year: 2001 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Carrie-Anne Moss" },
      { from_pos: 2, to_pos: 3, intended_actor: "Guy Pearce" },
      { from_pos: 3, to_pos: 4, intended_actor: "Russell Crowe" },
      { from_pos: 4, to_pos: 5, intended_actor: "Joaquin Phoenix" },
      { from_pos: 5, to_pos: 6, intended_actor: "Reese Witherspoon" },
      { from_pos: 6, to_pos: 7, intended_actor: "Luke Wilson" },
    ],
  },
  {
    puzzle: 3,
    difficulty: "hard",
    films: [
      { title: "Jaws", year: 1975 },
      { title: "Close Encounters of the Third Kind", year: 1977 },
      { title: "Young Frankenstein", year: 1974 },
      { title: "Blazing Saddles", year: 1974 },
      { title: "Clue", year: 1985 },
      { title: "The Rocky Horror Picture Show", year: 1975 },
      { title: "Thelma & Louise", year: 1991 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Richard Dreyfuss" },
      { from_pos: 2, to_pos: 3, intended_actor: "Teri Garr" },
      { from_pos: 3, to_pos: 4, intended_actor: "Gene Wilder" },
      { from_pos: 4, to_pos: 5, intended_actor: "Madeline Kahn" },
      { from_pos: 5, to_pos: 6, intended_actor: "Tim Curry" },
      { from_pos: 6, to_pos: 7, intended_actor: "Susan Sarandon" },
    ],
  },
  {
    puzzle: 4,
    difficulty: "medium",
    films: [
      { title: "Get Out", year: 2017 },
      { title: "Black Panther", year: 2018 },
      { title: "Creed", year: 2015 },
      { title: "Rocky", year: 1976 },
      { title: "The Godfather Part II", year: 1974 },
      { title: "Taxi Driver", year: 1976 },
      { title: "The Silence of the Lambs", year: 1991 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Daniel Kaluuya" },
      { from_pos: 2, to_pos: 3, intended_actor: "Michael B. Jordan" },
      { from_pos: 3, to_pos: 4, intended_actor: "Sylvester Stallone" },
      { from_pos: 4, to_pos: 5, intended_actor: "Talia Shire" },
      { from_pos: 5, to_pos: 6, intended_actor: "Robert De Niro" },
      { from_pos: 6, to_pos: 7, intended_actor: "Jodie Foster" },
    ],
  },
  {
    puzzle: 5,
    difficulty: "easy",
    films: [
      { title: "Shrek", year: 2001 },
      { title: "There's Something About Mary", year: 1998 },
      { title: "Zoolander", year: 2001 },
      { title: "Wedding Crashers", year: 2005 },
      { title: "A Star Is Born", year: 2018 },
      { title: "House of Gucci", year: 2021 },
      { title: "Marriage Story", year: 2019 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Cameron Diaz" },
      { from_pos: 2, to_pos: 3, intended_actor: "Ben Stiller" },
      { from_pos: 3, to_pos: 4, intended_actor: "Owen Wilson" },
      { from_pos: 4, to_pos: 5, intended_actor: "Bradley Cooper" },
      { from_pos: 5, to_pos: 6, intended_actor: "Lady Gaga" },
      { from_pos: 6, to_pos: 7, intended_actor: "Adam Driver" },
    ],
  },
  {
    puzzle: 6,
    difficulty: "medium",
    films: [
      { title: "Blade Runner", year: 1982 },
      { title: "Star Wars: A New Hope", year: 1977 },
      { title: "When Harry Met Sally...", year: 1989 },
      { title: "The Princess Bride", year: 1987 },
      { title: "Forrest Gump", year: 1994 },
      { title: "Apollo 13", year: 1995 },
      { title: "A Few Good Men", year: 1992 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Harrison Ford" },
      { from_pos: 2, to_pos: 3, intended_actor: "Carrie Fisher" },
      { from_pos: 3, to_pos: 4, intended_actor: "Billy Crystal" },
      { from_pos: 4, to_pos: 5, intended_actor: "Robin Wright" },
      { from_pos: 5, to_pos: 6, intended_actor: "Gary Sinise" },
      { from_pos: 6, to_pos: 7, intended_actor: "Kevin Bacon" },
    ],
  },
  {
    puzzle: 7,
    difficulty: "medium",
    films: [
      { title: "Raging Bull", year: 1980 },
      { title: "Goodfellas", year: 1990 },
      { title: "Home Alone", year: 1990 },
      { title: "Beetlejuice", year: 1988 },
      { title: "Batman", year: 1989 },
      { title: "One Flew Over the Cuckoo's Nest", year: 1975 },
      { title: "Matilda", year: 1996 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Robert De Niro" },
      { from_pos: 2, to_pos: 3, intended_actor: "Joe Pesci" },
      { from_pos: 3, to_pos: 4, intended_actor: "Catherine O'Hara" },
      { from_pos: 4, to_pos: 5, intended_actor: "Michael Keaton" },
      { from_pos: 5, to_pos: 6, intended_actor: "Jack Nicholson" },
      { from_pos: 6, to_pos: 7, intended_actor: "Danny DeVito" },
    ],
  },
  {
    puzzle: 8,
    difficulty: "easy",
    films: [
      { title: "The Lord of the Rings: The Fellowship of the Ring", year: 2001 },
      { title: "X-Men", year: 2000, tmdb_id: 36657 },
      { title: "Les Misérables", year: 2012 },
      { title: "The Devil Wears Prada", year: 2006 },
      { title: "Mamma Mia!", year: 2008 },
      { title: "The King's Speech", year: 2010 },
      { title: "Pirates of the Caribbean: The Curse of the Black Pearl", year: 2003 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Ian McKellen" },
      { from_pos: 2, to_pos: 3, intended_actor: "Hugh Jackman" },
      { from_pos: 3, to_pos: 4, intended_actor: "Anne Hathaway" },
      { from_pos: 4, to_pos: 5, intended_actor: "Meryl Streep" },
      { from_pos: 5, to_pos: 6, intended_actor: "Colin Firth" },
      { from_pos: 6, to_pos: 7, intended_actor: "Geoffrey Rush" },
    ],
  },
  {
    puzzle: 9,
    difficulty: "medium",
    films: [
      { title: "Fight Club", year: 1999 },
      { title: "Ocean's Eleven", year: 2001 },
      { title: "Good Will Hunting", year: 1997 },
      { title: "Mrs. Doubtfire", year: 1993 },
      { title: "GoldenEye", year: 1995 },
      { title: "Shakespeare in Love", year: 1998 },
      { title: "Iron Man", year: 2008 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Brad Pitt" },
      { from_pos: 2, to_pos: 3, intended_actor: "Matt Damon" },
      { from_pos: 3, to_pos: 4, intended_actor: "Robin Williams" },
      { from_pos: 4, to_pos: 5, intended_actor: "Pierce Brosnan" },
      { from_pos: 5, to_pos: 6, intended_actor: "Judi Dench" },
      { from_pos: 6, to_pos: 7, intended_actor: "Gwyneth Paltrow" },
    ],
  },
  {
    puzzle: 10,
    difficulty: "medium",
    films: [
      { title: "A Nightmare on Elm Street", year: 1984 },
      { title: "Edward Scissorhands", year: 1990 },
      { title: "Girl, Interrupted", year: 1999 },
      { title: "Mr. & Mrs. Smith", year: 2005 },
      { title: "Old School", year: 2003 },
      { title: "Anchorman: The Legend of Ron Burgundy", year: 2004 },
      { title: "The 40-Year-Old Virgin", year: 2005 },
    ],
    links: [
      { from_pos: 1, to_pos: 2, intended_actor: "Johnny Depp" },
      { from_pos: 2, to_pos: 3, intended_actor: "Winona Ryder" },
      { from_pos: 3, to_pos: 4, intended_actor: "Angelina Jolie" },
      { from_pos: 4, to_pos: 5, intended_actor: "Vince Vaughn" },
      { from_pos: 5, to_pos: 6, intended_actor: "Will Ferrell" },
      { from_pos: 6, to_pos: 7, intended_actor: "Steve Carell" },
    ],
  },
];

// ─── TMDB lookup ─────────────────────────────────────────────────────────────

// Cache keyed by "title|year" so duplicate lookups only fetch once
const movieCache = new Map<string, TmdbMovieDetails>();

async function fetchMovie(film: FilmEntry): Promise<TmdbMovieDetails> {
  const cacheKey = `${film.tmdb_id ?? film.title}|${film.year ?? ""}`;
  if (movieCache.has(cacheKey)) return movieCache.get(cacheKey)!;

  let movieId: number;

  if (film.tmdb_id) {
    movieId = film.tmdb_id;
  } else {
    const search = await tmdbGet<TmdbMovieSearchResponse>("/3/search/movie", {
      query: film.title,
      ...(film.year ? { year: film.year } : {}),
    });
    if (!search.results.length) {
      throw new Error(`No TMDB result for "${film.title}"`);
    }
    movieId = search.results[0].id;
  }

  const details = await tmdbGet<TmdbMovieDetails>(`/3/movie/${movieId}`);
  movieCache.set(cacheKey, details);
  return details;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding ${PUZZLES.length} cast_links puzzles...\n`);

  for (const puzzle of PUZZLES) {
    console.log(`Puzzle ${puzzle.puzzle} (${puzzle.difficulty})`);

    // Skip if already seeded (payload contains this puzzle_number)
    const existing = await prisma.question.findFirst({
      where: { type: "cast_links", payload: { contains: `"puzzle_number":${puzzle.puzzle}` } },
    });
    if (existing) {
      console.log(`  Already exists as Question ID ${existing.id}, skipping.\n`);
      continue;
    }

    // Resolve all films to TMDB movie details
    const resolvedFilms: { film: FilmEntry; tmdb: TmdbMovieDetails | null }[] = [];
    for (const film of puzzle.films) {
      try {
        const tmdb = await fetchMovie(film);
        resolvedFilms.push({ film, tmdb });
        console.log(`  ✓ "${tmdb.title}" (TMDB ${tmdb.id})`);
      } catch (err) {
        console.error(`  ✗ "${film.title}": ${err instanceof Error ? err.message : err}`);
        resolvedFilms.push({ film, tmdb: null });
      }
    }

    // Upsert Movie records for any successfully resolved films
    for (const { tmdb } of resolvedFilms) {
      if (!tmdb) continue;
      await prisma.movie.upsert({
        where: { id: tmdb.id },
        update: {},
        create: {
          id: tmdb.id,
          title: tmdb.title,
          releaseDate: tmdb.release_date,
          posterPath: tmdb.poster_path,
          overview: tmdb.overview,
        },
      });
    }

    // Build structured payload
    const payload = {
      puzzle_number: puzzle.puzzle,
      chain: resolvedFilms.map(({ film, tmdb }, i) => ({
        pos: i + 1,
        film: film.title,
        tmdb_id: tmdb?.id ?? null,
      })),
      links: puzzle.links,
    };

    // Insert Question
    const movieIds = resolvedFilms
      .filter((f) => f.tmdb !== null)
      .map((f) => f.tmdb!.id);

    const question = await prisma.question.create({
      data: {
        type: "cast_links",
        difficulty: puzzle.difficulty,
        payload: JSON.stringify(payload),
        movies: {
          create: movieIds.map((movieId) => ({ movieId })),
        },
      },
    });

    console.log(`  → Question ID ${question.id} created with ${movieIds.length}/7 movies linked.\n`);
  }

  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
