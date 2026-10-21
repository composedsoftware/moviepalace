/**
 * create-tables.ts
 *
 * Creates every table the app uses, empty. Safe to re-run (IF NOT EXISTS);
 * existing tables and their data are left untouched.
 * Mirrors prisma/schema.prisma (not prisma/migrations, which is out of date).
 *
 * Run: npm run db:create-tables
 */

/// <reference types="node" />
import "dotenv/config";
import { createClient } from "@libsql/client";

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Movie" (
    "id"          INTEGER  NOT NULL PRIMARY KEY,
    "title"       TEXT     NOT NULL,
    "releaseDate" TEXT,
    "posterPath"  TEXT,
    "overview"    TEXT,
    "keywords"    TEXT,
    "topCast"     TEXT,
    "fetchedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Keyword" (
    "id"         INTEGER NOT NULL PRIMARY KEY,
    "name"       TEXT    NOT NULL UNIQUE,
    "movieCount" INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Actor" (
    "id"                 INTEGER  NOT NULL PRIMARY KEY,
    "name"               TEXT     NOT NULL,
    "profilePath"        TEXT,
    "popularity"         REAL,
    "knownForDepartment" TEXT,
    "fetchedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Question" (
    "id"         INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type"       TEXT     NOT NULL,
    "difficulty" TEXT     NOT NULL,
    "payload"    TEXT     NOT NULL,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "QuestionMovie" (
    "questionId" INTEGER NOT NULL,
    "movieId"    INTEGER NOT NULL,
    PRIMARY KEY ("questionId", "movieId"),
    CONSTRAINT "QuestionMovie_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionMovie_movieId_fkey"    FOREIGN KEY ("movieId")    REFERENCES "Movie"    ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
];

async function main() {
  const client = createClient({ url: process.env.DATABASE_URL! });
  await client.batch(STATEMENTS, "write");
  client.close();
  console.log(`Tables ready in ${process.env.DATABASE_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
