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
  popularity?: number;
  known_for_department?: string;
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

// ─── Actor types ──────────────────────────────────────────────────────────────

export interface ActorResponse {
  id: number;
  name: string;
  profilePath: string | null;
  popularity: number | null;
  knownForDepartment: string | null;
}

export interface MovieWithCast {
  id: number;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  overview: string | null;
  keywords: string[];
  topCast: ActorResponse[];
}

export interface QuestionWithMoviesResponse {
  id: number;
  type: string;
  difficulty: string;
  payload: Record<string, unknown>;
  createdAt: string;
  movies: MovieWithCast[];
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

// ─── Question payload types ───────────────────────────────────────────────────────

export interface SharedActorPayload {
  question: string;
  choices: string[];
  correct_index: number;
}  

export interface MovieDetailsPayload {
  question: string;
  choices: string[];
  correct_index: number;
}

export interface CastLinksChainEntry {
  pos: number;
  film: string;
  tmdb_id: number;
}

export interface CastLinksLinksEntry {
  from_pos: number;
  to_pos: number;
  intended_actor: string;
}

export interface CastLinksPayload {
  puzzle_number: number;
  chain: CastLinksChainEntry[];
  links: CastLinksLinksEntry[];
  type: "shared_actor" | "movie_detail" | "cast_links";
}