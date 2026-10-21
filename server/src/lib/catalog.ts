import prisma from "./db";
import { tmdbGet } from "./tmdb";
import { genreIdsJson, upsertGenres } from "./genres";
import {
  TmdbMovieDetails,
  TmdbKeywordsResponse,
  TmdbCreditsResponse,
  TmdbCastMember,
} from "../moviepalace-types";

export const TOP_CAST_LIMIT = 10;

interface StoredKeyword { id: number; name: string; }

/**
 * Fetch a movie's details, keywords and credits from TMDB and upsert the Movie
 * row (all fields), its genres, and its top-billed Actor rows.
 */
export async function addMovieFromTmdb(tmdbId: number): Promise<{
  details: TmdbMovieDetails;
  keywords: StoredKeyword[];
  topCast: TmdbCastMember[];
}> {
  const [details, kwResponse, credits] = await Promise.all([
    tmdbGet<TmdbMovieDetails>(`/3/movie/${tmdbId}`),
    tmdbGet<TmdbKeywordsResponse>(`/3/movie/${tmdbId}/keywords`),
    tmdbGet<TmdbCreditsResponse>(`/3/movie/${tmdbId}/credits`),
  ]);

  const keywords = kwResponse.keywords.map((k) => ({ id: k.id, name: k.name }));
  const topCast = credits.cast
    .sort((a, b) => a.order - b.order)
    .slice(0, TOP_CAST_LIMIT);
  const topCastIds = topCast.map((a) => a.id);

  await upsertGenres(details.genres);
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
      genres: genreIdsJson(details.genres),
    },
    update: {
      title: details.title,
      releaseDate: details.release_date || null,
      posterPath: details.poster_path || null,
      overview: details.overview || null,
      keywords: JSON.stringify(keywords),
      topCast: JSON.stringify(topCastIds),
      genres: genreIdsJson(details.genres),
      fetchedAt: new Date(),
    },
  });

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

  return { details, keywords, topCast };
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
  } catch { return []; }
}

/** Rebuild the Keyword table from every Movie.keywords value. Returns the distinct keyword count. */
export async function rebuildKeywordTable(): Promise<number> {
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

/** Re-sort every Movie.keywords by Keyword.movieCount descending. Returns how many movies were updated. */
export async function sortAllKeywords(): Promise<number> {
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
