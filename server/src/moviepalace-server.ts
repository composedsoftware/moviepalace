/**
 * moviepalace-server.ts
 *
 * Express entry point for the MoviePalace API.
 *
 * Routes:
 *   GET  /v1/movies/search?query=&year=
 *   GET  /v1/movies/random
 *   GET  /v1/movies/question/:questionId
 *   GET  /v1/movies/:movieId
 *   GET  /v1/movies/:movieId/credits
 *
 *   GET  /v1/admin/questions?type=&difficulty=&limit=&offset=
 *   GET  /v1/admin/questions/:questionId
 *   PUT  /v1/admin/questions/:questionId
 *   POST /v1/admin/question
 *   GET  /v1/admin/movies?query=&limit=
 *
 * Pages:
 *   GET  /blurred-poster  — movie poster guessing tool
 *
 * Run (dev):  npm run dev
 * Run (prod): npm run build && npm start
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import moviesV1 from "./routes/v1/movies";
import adminV1 from "./routes/v1/admin";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

if (!process.env.TMDB_TOKEN) {
  console.error("Error: TMDB_TOKEN environment variable is not set.");
  process.exit(1);
}

app.use("/v1/movies", moviesV1);
app.use("/v1/admin", adminV1);

app.use("/blurred-poster", express.static(path.join(__dirname, "blurred-poster")));

app.listen(PORT, () => {
  console.log(`MoviePalace API running at http://localhost:${PORT}`);
  console.log(``);
  console.log(`  Movies`);
  console.log(`    GET  /v1/movies/search?query=Inception`);
  console.log(`    GET  /v1/movies/random`);
  console.log(`    GET  /v1/movies/question/14`);
  console.log(`    GET  /v1/movies/27205`);
  console.log(`    GET  /v1/movies/27205/credits`);
  console.log(``);
  console.log(`  Admin`);
  console.log(`    GET  /v1/admin/questions?type=cast_links&difficulty=easy`);
  console.log(`    GET  /v1/admin/questions/14`);
  console.log(`    PUT  /v1/admin/questions/14`);
  console.log(`    POST /v1/admin/question`);
  console.log(`    GET  /v1/admin/movies?query=Jurassic`);
  console.log(``);
  console.log(`  Pages`);
  console.log(`    http://localhost:${PORT}/blurred-poster`);
});
