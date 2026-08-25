/**
 * migrate-cast-links-actors.ts
 *
 * One-time migration for cast_links questions.
 *
 * For every link in the chain (from_pos → to_pos), computes which actors appear
 * in both films' topCast, then replaces:
 *
 *   { from_pos, to_pos, intended_actor: "Name" }
 *
 * with:
 *
 *   { from_pos, to_pos, possible_actors: [{ id, name }, ...] }
 *
 * Actors are ordered by their topCast billing position in the first film.
 * Logs a warning for any link where the overlap is empty (actor not in top 10).
 *
 * Safe to re-run: questions whose links already use possible_actors are skipped.
 *
 * Run: npm run db:migrate-cast-links-actors
 */

import dotenv from "dotenv";
dotenv.config();

import prisma from "../lib/db";

interface ChainEntry {
  pos: number;
  film: string;
  tmdb_id: number | null;
}

interface OldLink {
  from_pos: number;
  to_pos: number;
  intended_actor?: string;
  possible_actors?: { id: number; name: string }[];
}

interface CastLinksPayload {
  puzzle_number: number;
  chain: ChainEntry[];
  links: OldLink[];
}

function parseIds(raw: string | null): number[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number")
      : [];
  } catch {
    return [];
  }
}

async function main() {
  const questions = await prisma.question.findMany({ where: { type: "cast_links" } });
  console.log(`Found ${questions.length} cast_links question(s).\n`);

  let migrated = 0;
  let skipped = 0;

  for (const q of questions) {
    const payload = JSON.parse(q.payload) as CastLinksPayload;

    // Skip if already migrated (first link already has possible_actors)
    if (payload.links[0]?.possible_actors !== undefined) {
      console.log(`  – Puzzle ${payload.puzzle_number}: already migrated, skipping.`);
      skipped++;
      continue;
    }

    // Build pos → tmdb_id map from the chain
    const posToTmdbId = new Map<number, number>(
      payload.chain
        .filter((e): e is ChainEntry & { tmdb_id: number } => e.tmdb_id !== null)
        .map((e) => [e.pos, e.tmdb_id])
    );

    // Fetch topCast for every movie referenced in this puzzle
    const tmdbIds = [...new Set(posToTmdbId.values())];
    const movies = await prisma.movie.findMany({
      where: { id: { in: tmdbIds } },
      select: { id: true, topCast: true },
    });
    const movieCastMap = new Map(movies.map((m) => [m.id, parseIds(m.topCast)]));

    // Fetch all actors referenced across all movies in one query
    const allActorIds = [...new Set(movies.flatMap((m) => parseIds(m.topCast)))];
    const actorRows = await prisma.actor.findMany({ where: { id: { in: allActorIds } } });
    const actorMap = new Map(actorRows.map((a) => [a.id, a]));

    // Build updated links
    const updatedLinks = payload.links.map((link) => {
      const movie1Id = posToTmdbId.get(link.from_pos);
      const movie2Id = posToTmdbId.get(link.to_pos);

      if (!movie1Id || !movie2Id) {
        console.warn(`    ⚠ Puzzle ${payload.puzzle_number} link ${link.from_pos}→${link.to_pos}: missing tmdb_id`);
        return { from_pos: link.from_pos, to_pos: link.to_pos, possible_actors: [] };
      }

      const cast1 = movieCastMap.get(movie1Id) ?? [];
      const cast2Set = new Set(movieCastMap.get(movie2Id) ?? []);

      // Intersection, preserving billing order from film 1
      const overlap = cast1
        .filter((id) => cast2Set.has(id))
        .map((id) => actorMap.get(id))
        .filter((a): a is NonNullable<typeof a> => a !== undefined)
        .map((a) => ({ id: a.id, name: a.name }));

      const film1 = payload.chain.find((e) => e.pos === link.from_pos)?.film ?? `pos ${link.from_pos}`;
      const film2 = payload.chain.find((e) => e.pos === link.to_pos)?.film ?? `pos ${link.to_pos}`;

      if (overlap.length === 0) {
        console.warn(
          `    ⚠ Puzzle ${payload.puzzle_number} "${film1}" → "${film2}": ` +
          `no overlap in top cast (intended: ${link.intended_actor ?? "unknown"})`
        );
      } else {
        const names = overlap.map((a) => a.name).join(", ");
        console.log(`    ✓ "${film1}" → "${film2}": [${names}]`);
      }

      return { from_pos: link.from_pos, to_pos: link.to_pos, possible_actors: overlap };
    });

    const updatedPayload: CastLinksPayload = {
      ...payload,
      links: updatedLinks,
    };

    await prisma.question.update({
      where: { id: q.id },
      data: { payload: JSON.stringify(updatedPayload) },
    });

    console.log(`  Puzzle ${payload.puzzle_number} (Q${q.id}): updated.\n`);
    migrated++;
  }

  console.log(`\nDone. ${migrated} migrated, ${skipped} skipped.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
