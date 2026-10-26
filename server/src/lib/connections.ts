import prisma from "./db";

/**
 * Connections puzzle generator, run against the local database only.
 *
 * Builds a chain of films where each adjacent pair shares a top-billed actor.
 * Ported from the TMDB-backed "Connections Explorer" prototype; the rules that
 * needed data we don't store are approximated:
 *   - vote-count floor: dropped (the catalog is already TMDB popular films)
 *   - collection / production-company checks: replaced by cast overlap and a
 *     title-stem check, which catch most sequels and franchise entries
 */

export const MAX_BILLING = 8;    // the connector must be billed in the top 9 of BOTH films (topCast index 0-8)
export const MIN_ACTOR_POP = 5;  // ...and be a recognizable name
const MAX_SHARED_PREV = 1;       // films sharing 2+ top-billed actors back to back are likely sequels
const MAX_SHARED_ANY = 2;        // ...and 3+ with any earlier film in the chain
const ATTEMPTS = 25;

export interface ChainStep {
  id: number;
  title: string;
  year: string | null;
  posterUrl: string | null;
  castIds: number[];        // top-billed actor IDs, so the page can accept any shared actor as a correct guess
  via?: { id: number; name: string };
}

interface GraphMovie {
  id: number;
  title: string;
  year: string | null;
  posterPath: string | null;
  cast: number[];           // top-billed actor IDs, billing order
  stem: string;
}

interface Graph {
  movies: Map<number, GraphMovie>;
  actors: Map<number, { name: string; popularity: number }>;
  filmsByActor: Map<number, number[]>; // actor ID -> movie IDs where they're within MAX_BILLING
}

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}

/** "The Godfather Part II" -> "godfather", "Toy Story 3" -> "toy story", "Alien: Covenant" -> "alien" */
export function titleStem(title: string): string {
  return title
    .toLowerCase()
    .split(/:| - /)[0]
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+(part\s+)?([0-9]+|[ivx]+)$/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export function posterUrl(posterPath: string | null): string | null {
  return posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : null;
}

export async function loadGraph(): Promise<Graph> {
  const [movieRows, actorRows] = await Promise.all([
    prisma.movie.findMany({
      where: { topCast: { not: null } },
      select: { id: true, title: true, releaseDate: true, posterPath: true, topCast: true },
    }),
    prisma.actor.findMany({ select: { id: true, name: true, popularity: true } }),
  ]);

  const movies = new Map<number, GraphMovie>();
  const filmsByActor = new Map<number, number[]>();
  for (const m of movieRows) {
    const cast = parseIds(m.topCast);
    if (!cast.length) continue;
    movies.set(m.id, {
      id: m.id,
      title: m.title,
      year: m.releaseDate?.slice(0, 4) || null,
      posterPath: m.posterPath,
      cast,
      stem: titleStem(m.title),
    });
    cast.slice(0, MAX_BILLING + 1).forEach((actorId) => {
      const list = filmsByActor.get(actorId) ?? [];
      list.push(m.id);
      filmsByActor.set(actorId, list);
    });
  }

  const actors = new Map(actorRows.map((a) => [a.id, { name: a.name, popularity: a.popularity ?? 0 }]));
  return { movies, actors, filmsByActor };
}

// Weighted shuffle (Efraimidis-Spirakis): key = U^(1/w), largest keys first.
// A higher weight means "tried earlier more often", never "always first".
function weightedShuffle<T>(items: T[], weight: (x: T) => number): T[] {
  return items
    .map((x) => ({ x, key: Math.random() ** (1 / Math.max(weight(x), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((o) => o.x);
}

function sharedCast(a: GraphMovie, b: GraphMovie): number {
  const set = new Set(a.cast);
  return b.cast.filter((id) => set.has(id)).length;
}

function walk(graph: Graph, length: number, avoid: Set<number>): ChainStep[] {
  const usedActors = new Set<number>();
  const chain: GraphMovie[] = [];
  const steps: ChainStep[] = [];

  // Stands in for the prototype's collection / production-company rule.
  function fits(next: GraphMovie): boolean {
    if (avoid.has(next.id)) return false;
    const prev = chain[chain.length - 1];
    if (prev && sharedCast(prev, next) > MAX_SHARED_PREV) return false;
    return chain.every((m) =>
      m.id !== next.id && m.stem !== next.stem && sharedCast(m, next) <= MAX_SHARED_ANY);
  }

  const all = [...graph.movies.values()];
  if (!all.length) return steps;
  const fresh = all.filter((m) => !avoid.has(m.id));
  const seeds = fresh.length ? fresh : all;
  let current = seeds[Math.floor(Math.random() * seeds.length)];
  chain.push(current);
  steps.push({
    id: current.id,
    title: current.title,
    year: current.year,
    posterUrl: posterUrl(current.posterPath),
    castIds: current.cast,
  });

  while (steps.length < length) {
    const cast = weightedShuffle(
      current.cast.slice(0, MAX_BILLING + 1).filter((id) =>
        !usedActors.has(id) && (graph.actors.get(id)?.popularity ?? 0) >= MIN_ACTOR_POP),
      (id) => 1 / graph.actors.get(id)!.popularity // inverse: megastars still appear, just less
    ).slice(0, 10);

    let next: GraphMovie | undefined;
    let viaId: number | undefined;
    for (const actorId of cast) {
      const films = (graph.filmsByActor.get(actorId) ?? [])
        .map((id) => graph.movies.get(id)!)
        .filter(fits);
      if (films.length) {
        next = films[Math.floor(Math.random() * films.length)];
        viaId = actorId;
        break;
      }
    }
    if (!next || viaId === undefined) break; // dead end: this seed cannot reach the target length

    usedActors.add(viaId);
    chain.push(next);
    steps.push({
      id: next.id,
      title: next.title,
      year: next.year,
      posterUrl: posterUrl(next.posterPath),
      castIds: next.cast,
      via: { id: viaId, name: graph.actors.get(viaId)!.name },
    });
    current = next;
  }
  return steps;
}

/** Generate a chain of `length` films, keeping the longest of several attempts. */
export async function generateChain(length: number, avoid: Set<number>): Promise<ChainStep[]> {
  const graph = await loadGraph();
  let best: ChainStep[] = [];
  for (let attempt = 0; attempt < ATTEMPTS && best.length < length; attempt++) {
    const steps = walk(graph, length, avoid);
    if (steps.length > best.length) best = steps;
  }
  return best;
}
