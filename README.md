# Spotify Stats Analyzer

Spotify Stats Analyzer is a browser-based tool for exploring your Spotify Extended Streaming History export.

## What It Does

- Summarizes your listening history with playtime, play count, skip count, unique tracks, artists, and albums
- Ranks your top songs, artists, albums, streaks, and daily peaks
- Visualizes listening patterns across years, months, weekdays, and hours
- Lets you re-filter the same loaded data by date range and top-limit without re-uploading

## Privacy

Your Spotify ZIP is processed entirely in the browser. The app does not upload your listening history to a backend server.

## What You Need

Request your Spotify `Extended Streaming History` export, then upload the ZIP directly into the analyzer.

The included [instructions page](./instructions.html) explains how to request the correct export from Spotify.

## Browser Support

This app depends on the browser `DecompressionStream` API for ZIP handling, so it works best in modern Chromium-based browsers.

## Notes

- This project is independent and is not affiliated with, endorsed by, or sponsored by Spotify.
- Artwork is loaded opportunistically from Spotify's public oEmbed metadata when available.
