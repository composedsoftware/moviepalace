import prisma from "./db";
import { TmdbGenre } from "../moviepalace-types";

/** Value for Movie.genres: a JSON array of TMDB genre IDs. */
export function genreIdsJson(genres: TmdbGenre[] | undefined): string {
  return JSON.stringify((genres ?? []).map((g) => g.id));
}

/** Keep the Genre lookup table current with genres seen on a TMDB movie. */
export async function upsertGenres(genres: TmdbGenre[] | undefined): Promise<void> {
  for (const g of genres ?? []) {
    await prisma.genre.upsert({
      where: { id: g.id },
      create: { id: g.id, name: g.name },
      update: { name: g.name },
    });
  }
}
