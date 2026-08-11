# MoviePalace

## Conventions

### We don't use `.claude/launch.json`

Do not create `.claude/launch.json`, and do not restore it if you notice it's
missing — it is absent on purpose. Nothing in this repo needs it.

Start servers with the npm scripts, which are the supported entry points:

| What | Command | Port comes from |
| --- | --- | --- |
| API | `cd server && npm run dev` | `PORT` in `server/.env` |
| Admin web UI | `cd server && npm run dev:web` | `WEB_PORT` in `server/.env` |
| Prisma Studio | `cd server && npm run db:studio` | chosen by Studio; printed on startup |

If your tooling wants a launch config in order to start or preview a dev
server, **ask first** rather than adding the file. Pointing a browser at an
already-running `npm run dev:web` covers almost every case.

Anything under `.claude/` is local-only and must not be committed.

### Ports live in `server/.env`, not in this file

Do not hardcode or memorize port numbers, and do not copy them into this file —
`server/.env` is the single source of truth. To find out where something runs:

1. Read `server/.env` for `PORT` / `WEB_PORT`.
2. If the variable isn't set, the fallback is the `??` default in the source
   that reads it — `src/moviepalace-server.ts` for the API, `src/webServer.ts`
   for the admin UI. Read the value there; don't assume it.
3. Prisma Studio ignores both. It picks its own port and prints its URL on
   startup — read that output.

`server/.env` is gitignored, so it differs per machine. Never state a port as
fact without checking it first.
