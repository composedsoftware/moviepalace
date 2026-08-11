// ─── TMDB API response shapes ────────────────────────────────────────────────
// These mirror the structures returned by the TMDB API (tmdb-api.json spec).

export interface TmdbMovieSearchResult {
  id: number;
  title: string;
  release_date: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
}

export interface TmdbMovieSearchResponse {
  page: number;
  total_results: number;
  total_pages: number;
  results: TmdbMovieSearchResult[];
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  runtime: number;
  budget: number;
  revenue: number;
  popularity: number;
  genres: TmdbGenre[];
  poster_path: string | null;
  backdrop_path: string | null;
  imdb_id: string | null;
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  order: number;
  profile_path: string | null;
}

export interface TmdbCreditsResponse {
  id: number;
  cast: TmdbCastMember[];
}

export interface TmdbKeyword {
  id: number;
  name: string;
}

export interface TmdbKeywordsResponse {
  id: number;
  keywords: TmdbKeyword[];
}

// ─── Shaped API response shapes (what our server returns to clients) ─────────

export interface MovieSearchResult {
  id: number;
  title: string;
  release_date: string;
  overview: string;
  popularity: number;
  poster_path: string | null;
}

export interface MovieSearchResponse {
  page: number;
  total_results: number;
  total_pages: number;
  results: MovieSearchResult[];
}

export interface MovieDetails {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  runtime: number;
  budget: number;
  revenue: number;
  popularity: number;
  genres: TmdbGenre[];
  poster_path: string | null;
  backdrop_path: string | null;
  imdb_id: string | null;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  order: number;
  profile_path: string | null;
}

export interface CreditsResponse {
  movie_id: number;
  cast: CastMember[];
}

export interface OverlapActor {
  id: number;
  name: string;
  character_in_movie1: string;
  character_in_movie2: string;
  profile_path: string | null;
}

export interface OverlapResponse {
  movie1: { id: number; title: string; release_date: string };
  movie2: { id: number; title: string; release_date: string };
  overlap_count: number;
  overlap: OverlapActor[];
}

export interface TriviaQuestionResponse {
  question: string;
  movie1: MovieDetails;
  movie2: MovieDetails;
  answer: string;
  actors: CastMember[];
}

export interface ErrorResponse {
  error: string;
}

// ─── Question API types ───────────────────────────────────────────────────────

export interface CreateQuestionRequest {
  type: string;
  difficulty: "easy" | "medium" | "hard";
  payload: Record<string, unknown>;
  movieIds?: number[];
}

export interface QuestionResponse {
  id: number;
  type: string;
  difficulty: string;
  payload: Record<string, unknown>;
  createdAt: string;
  movies: { id: number; title: string }[];
}

export interface UpdateQuestionRequest {
  type?: string;
  difficulty?: "easy" | "medium" | "hard";
  payload?: Record<string, unknown>;
  movieIds?: number[];
}

export interface QuestionListResponse {
  total: number;
  limit: number;
  offset: number;
  questions: QuestionResponse[];
}

// ─── cast_links payload ──────────────────────────────────────────────────────
// The shape seed-cast-links.ts writes: seven films in order, joined by six
// actor links between adjacent positions.

export interface CastLinksChainEntry {
  pos: number;
  film: string;
  tmdb_id: number | null;
}

export interface CastLinksLink {
  from_pos: number;
  to_pos: number;
  intended_actor: string;
}

export interface CastLinksPayload {
  puzzle_number: number;
  chain: CastLinksChainEntry[];
  links: CastLinksLink[];
}

// ─── Admin movie catalogue ───────────────────────────────────────────────────

/** A movie cached in our database — the only IDs a question can be linked to. */
export interface StoredMovie {
  id: number;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  overview: string | null;
  keywords: string[];
}

export interface StoredMovieListResponse {
  total: number;
  movies: StoredMovie[];
}

/** A single question with its movies expanded, for the admin detail view. */
export interface QuestionDetailResponse extends Omit<QuestionResponse, "movies"> {
  movies: StoredMovie[];
}
