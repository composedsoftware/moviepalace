/**
 * webServer.ts
 *
 * Serves the MoviePalace admin web page and the API it talks to from a single
 * origin, so the browser needs no CORS setup.
 *
 *   /            → client/admin/web (static)
 *   /v1/admin/*  → admin router (questions, movies)
 *   /v1/movies/* → public movie router (TMDB-backed)
 *
 * Run (dev): npm run dev:web
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import moviesV1 from "./routes/v1/movies";
import adminV1 from "./routes/v1/admin";

dotenv.config();

const app = express();
const PORT = process.env.WEB_PORT ?? 4000;

// The admin UI reads and writes our own database and never calls TMDB directly,
// so it stays usable without a token — only /v1/movies needs one.
if (!process.env.TMDB_TOKEN) {
  console.warn("Warning: TMDB_TOKEN is not set — /v1/movies routes will fail.");
}

app.use(express.json());

app.use("/v1/movies", moviesV1);
app.use("/v1/admin", adminV1);

const webRoot = path.join(__dirname, "../../client/admin/web");
app.use(express.static(webRoot));

app.listen(PORT, () => {
  console.log(`MoviePalace admin running at http://localhost:${PORT}`);
  console.log(`  serving ${webRoot}`);
});
