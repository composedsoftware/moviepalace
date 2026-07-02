import fetch from "node-fetch";
import { Response } from "express";
import { ErrorResponse } from "../moviepalace-types";

export const TMDB_BASE = "https://api.themoviedb.org";

/** Custom error class that carries the HTTP status code from TMDB responses. */
export class TmdbApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "TmdbApiError";
  }
}

/**
 * Make an authenticated GET request to the TMDB API.
 * @param path   - e.g. "/3/search/movie"
 * @param params - query string parameters (undefined/null/"" values are omitted)
 */
export async function tmdbGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const token = process.env.TMDB_TOKEN;

  const url = new URL(TMDB_BASE + path);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { status_message?: string };
    throw new TmdbApiError(body.status_message ?? "TMDB API error", response.status);
  }

  return response.json() as Promise<T>;
}

/** Resolve a TMDB image path to a full URL, or return null. */
export function imageUrl(path: string | null, size: string): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

/** Send a typed error response, using the status code from TmdbApiError when available. */
export function handleError(res: Response, err: unknown): void {
  if (err instanceof TmdbApiError) {
    res.status(err.status).json({ error: err.message } satisfies ErrorResponse);
  } else if (err instanceof Error) {
    res.status(500).json({ error: err.message } satisfies ErrorResponse);
  } else {
    res.status(500).json({ error: "An unexpected error occurred" } satisfies ErrorResponse);
  }
}
