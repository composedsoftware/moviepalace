/**
 * moviepalace-server.ts
 *
 * Express entry point for the MoviePalace API.
 *
 * Routes:
 *   /v1/movies/search
 *   /v1/movies/overlap
 *   /v1/movies/:movieId
 *   /v1/movies/:movieId/credits
 *
 * Run (dev):  npm run dev
 * Run (prod): npm run build && npm start
 */

import express from "express";
import dotenv from "dotenv";
import moviesV1 from "./routes/v1/movies";
import questionsV1 from "./routes/v1/questions";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

if (!process.env.TMDB_TOKEN) {
  console.error("Error: TMDB_TOKEN environment variable is not set.");
  process.exit(1);
}

app.use("/v1/movies", moviesV1);
app.use("/v1/questions", questionsV1);

app.listen(PORT, () => {
  console.log(`MoviePalace API running at http://localhost:${PORT}`);
  console.log(`  GET /v1/movies/search?query=Inception`);
  console.log(`  GET /v1/movies/642`);
  console.log(`  GET /v1/movies/642/credits`);
  console.log(`  GET /v1/movies/overlap?movie1=Butch+Cassidy...&movie2=Donnie+Darko`);
  console.log(`  POST /v1/questions`);
});
