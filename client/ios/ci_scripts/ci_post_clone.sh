#!/bin/sh
# Xcode Cloud runs this after cloning. It writes the gitignored Secrets.swift
# from the TMDB_API_KEY secret environment variable set on the workflow.
set -e

if [ -z "$TMDB_API_KEY" ]; then
  echo "warning: TMDB_API_KEY is not set; building without a TMDB key"
fi

cat > "$(dirname "$0")/../moviepalace/Secrets.swift" <<EOF
enum Secrets {
    static let tmdbAPIKey = "$TMDB_API_KEY"
}
EOF
