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

export interface ErrorResponse {
  error: string;
}
