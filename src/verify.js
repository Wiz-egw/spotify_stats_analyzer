import {
  buildAnalysisContext,
  formatPlaytime,
  parseTopLimit,
  rankAlbums,
  rankArtistDailyPeaks,
  rankArtistStreaks,
  rankArtistsPT,
  rankArtistsTP,
  rankSongDailyPeaks,
  rankSongsPT,
  rankSongsTP,
  totalPlayCount,
  totalPlaytime,
  uniqueAlbums,
  uniqueTracks,
} from "./analysis.js";

const fixture = [
  { ts: "2024-01-01T12:00:00Z", ms_played: 60000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:a" },
  { ts: "2024-01-02T12:00:00Z", ms_played: 31000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:a" },
  { ts: "2024-01-03T12:00:00Z", ms_played: 29000, master_metadata_track_name: "B", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:b" },
  { ts: "2024-01-04T12:00:00Z", ms_played: 45000, master_metadata_track_name: "C", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:c" },
  { ts: "2024-01-05T12:00:00Z", ms_played: 47000, master_metadata_track_name: "D", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:d" },
  { ts: "2024-01-06T12:00:00Z", ms_played: 48000, master_metadata_track_name: "E", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:e" },
  { ts: "2024-01-07T12:00:00Z", ms_played: 31000, master_metadata_track_name: "F", master_metadata_album_artist_name: "Y", master_metadata_album_album_name: "Album2", spotify_track_uri: "spotify:track:f" },
  { ts: "2024-02-01T12:00:00Z", ms_played: 32000, master_metadata_track_name: "G", master_metadata_album_artist_name: "Y", master_metadata_album_album_name: "Album2", spotify_track_uri: "spotify:track:g" },
  { ts: "2024-02-02T12:00:00Z", ms_played: 33000, master_metadata_track_name: "H", master_metadata_album_artist_name: "Z", master_metadata_album_album_name: "Album3", spotify_track_uri: "spotify:track:h" },
  { ts: "2024-02-03T12:00:00Z", ms_played: 30000, master_metadata_track_name: "I", master_metadata_album_artist_name: "Z", master_metadata_album_album_name: "Album3", spotify_track_uri: "spotify:track:i" },
  { ts: "2024-03-01T12:00:00Z", ms_played: 120000, master_metadata_track_name: "J", master_metadata_album_artist_name: "Z", master_metadata_album_album_name: "Album3", spotify_track_uri: "spotify:track:j" },
  { ts: "2023-12-31T12:00:00Z", ms_played: 35000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", master_metadata_album_album_name: "Album1", spotify_track_uri: "spotify:track:a" },
];

const localReferenceHour = new Date(fixture[0].ts).getHours();
const localReferenceHourLabel = formatHourLabel(localReferenceHour);

const checks = [
  {
    name: "Top limit parser matches Flask defaults",
    run: () => {
      const invalid = parseTopLimit("garbage");
      const formerAll = parseTopLimit("all");
      return {
        invalid,
        formerAll,
      };
    },
    expected: {
      invalid: { limit: 10, selectedTopLimit: "10" },
      formerAll: { limit: 10, selectedTopLimit: "10" },
    },
  },
  {
    name: "Music-only analysis excludes podcast-style rows",
    run: () => {
      const context = buildAnalysisContext({
        allData: [
          { ts: "2024-01-01T12:00:00Z", ms_played: 180000, master_metadata_track_name: "Song A", master_metadata_album_artist_name: "Artist A", master_metadata_album_album_name: "Album A", spotify_track_uri: "spotify:track:a" },
          { ts: "2024-01-02T12:00:00Z", ms_played: 240000, master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null, spotify_track_uri: null },
        ],
        topLimitValue: "10",
        timezoneLabel: "UTC",
      });

      return {
        totalRecordCount: context.totalRecordCount,
        filteredRecordCount: context.filteredRecordCount,
        totalPlaytime: context.totalPlaytime,
        totalPlayCount: context.totalPlayCount,
        uniqueTracks: context.uniqueTracks,
        songsPT: context.songsPT,
      };
    },
    expected: {
      totalRecordCount: 1,
      filteredRecordCount: 1,
      totalPlaytime: "03m",
      totalPlayCount: 1,
      uniqueTracks: 1,
      songsPT: [
        { track: "Song A", artist: "Artist A", playtime: "03m", rank: 1, uri: "spotify:track:a" },
      ],
    },
  },
  {
    name: "Song ranking by playtime (top 5) matches Flask output",
    run: () => rankSongsPT(fixture, 5),
    expected: [
      { track: "A", artist: "X", playtime: "02m", rank: 1, uri: "spotify:track:a" },
      { track: "J", artist: "Z", playtime: "02m", rank: 2, uri: "spotify:track:j" },
      { track: "E", artist: "X", playtime: "00m", rank: 3, uri: "spotify:track:e" },
      { track: "D", artist: "X", playtime: "00m", rank: 4, uri: "spotify:track:d" },
      { track: "C", artist: "X", playtime: "00m", rank: 5, uri: "spotify:track:c" },
    ],
  },
  {
    name: "Song ranking by play count keeps >30000 threshold and tie ranks",
    run: () => rankSongsTP(fixture, 5),
    expected: [
      { track: "A", artist: "X", times_played: 3, rank: 1, uri: "spotify:track:a" },
      { track: "C", artist: "X", times_played: 1, rank: 2, uri: "spotify:track:c" },
      { track: "D", artist: "X", times_played: 1, rank: 2, uri: "spotify:track:d" },
      { track: "E", artist: "X", times_played: 1, rank: 2, uri: "spotify:track:e" },
      { track: "F", artist: "Y", times_played: 1, rank: 2, uri: "spotify:track:f" },
    ],
  },
  {
    name: "Artist rankings match Flask for playtime and playcount thresholds",
    run: () => ({
      artistsPT: rankArtistsPT(fixture),
      artistsTP: rankArtistsTP(fixture),
    }),
    expected: {
      artistsPT: [
        { artist: "X", playtime: "04m", rank: 1 },
        { artist: "Z", playtime: "03m", rank: 2 },
        { artist: "Y", playtime: "01m", rank: 3 },
      ],
      artistsTP: [
        { artist: "X", times_played: 6, rank: 1 },
        { artist: "Y", times_played: 2, rank: 2 },
        { artist: "Z", times_played: 2, rank: 2 },
      ],
    },
  },
  {
    name: "Daily peak tables keep >30000 inclusion and per-day grouping",
    run: () => {
      const dailyFixture = [
        { ts: "2024-01-01T10:00:00Z", ms_played: 30000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", spotify_track_uri: "spotify:track:a" },
        { ts: "2024-01-01T11:00:00Z", ms_played: 31000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", spotify_track_uri: "spotify:track:a" },
        { ts: "2024-01-01T12:00:00Z", ms_played: 32000, master_metadata_track_name: "A", master_metadata_album_artist_name: "X", spotify_track_uri: "spotify:track:a" },
        { ts: "2024-01-01T13:00:00Z", ms_played: 33000, master_metadata_track_name: "B", master_metadata_album_artist_name: "X", spotify_track_uri: "spotify:track:b" },
        { ts: "2024-01-01T14:00:00Z", ms_played: 34000, master_metadata_track_name: "C", master_metadata_album_artist_name: "Y", spotify_track_uri: "spotify:track:c" },
        { ts: "2024-01-01T15:00:00Z", ms_played: 35000, master_metadata_track_name: "C", master_metadata_album_artist_name: "Y", spotify_track_uri: "spotify:track:c" },
        { ts: "2024-01-02T10:00:00Z", ms_played: 36000, master_metadata_track_name: "D", master_metadata_album_artist_name: "Z", spotify_track_uri: "spotify:track:d" },
        { ts: "2024-01-02T11:00:00Z", ms_played: 37000, master_metadata_track_name: "D", master_metadata_album_artist_name: "Z", spotify_track_uri: "spotify:track:d" },
        { ts: "2024-01-02T12:00:00Z", ms_played: 29000, master_metadata_track_name: "E", master_metadata_album_artist_name: "Z", spotify_track_uri: "spotify:track:e" },
        { ts: "2024-01-02T13:00:00Z", ms_played: 30000, master_metadata_track_name: "F", master_metadata_album_artist_name: "Z", spotify_track_uri: "spotify:track:f" },
      ];

      return {
        songs: rankSongDailyPeaks(dailyFixture),
        artists: rankArtistDailyPeaks(dailyFixture),
      };
    },
    expected: {
      songs: [
        { track: "A", artist: "X", times_played: 2, date: "Jan 01, 2024", rank: 1, uri: "spotify:track:a" },
        { track: "C", artist: "Y", times_played: 2, date: "Jan 01, 2024", rank: 1, uri: "spotify:track:c" },
        { track: "D", artist: "Z", times_played: 2, date: "Jan 02, 2024", rank: 1, uri: "spotify:track:d" },
        { track: "B", artist: "X", times_played: 1, date: "Jan 01, 2024", rank: 2, uri: "spotify:track:b" },
      ],
      artists: [
        { artist: "X", times_played: 3, date: "Jan 01, 2024", rank: 1 },
        { artist: "Y", times_played: 2, date: "Jan 01, 2024", rank: 2 },
        { artist: "Z", times_played: 2, date: "Jan 02, 2024", rank: 2 },
      ],
    },
  },
  {
    name: "Album ranking keeps engagement score behavior and album eligibility",
    run: () => rankAlbums(fixture),
    expected: [
      { album: "Album1", artist: "X", playtime: "04m", rank: 1, uri: "spotify:track:a" },
    ],
  },
  {
    name: "Summary counters keep >30000 distinctions for plays, tracks, and albums",
    run: () => ({
      totalPlaytime: totalPlaytime(fixture),
      totalPlayCount: totalPlayCount(fixture),
      uniqueTracks: uniqueTracks(fixture),
      uniqueAlbums: uniqueAlbums(fixture),
    }),
    expected: {
      totalPlaytime: "09m",
      totalPlayCount: 10,
      uniqueTracks: 8,
      uniqueAlbums: 1,
    },
  },
  {
    name: "Large hour playtime strings include thousands separators",
    run: () => ({
      cardPlaytime: formatPlaytime(1234 * 3600000 + 5 * 60000),
    }),
    expected: {
      cardPlaytime: "1,234h 05m",
    },
  },
  {
    name: "Artist streak ranking keeps consecutive >30000 play logic and tie ranking behavior",
    run: () => rankArtistStreaks(fixture, "UTC"),
    expected: [
      {
        rank: 1,
        artist: "X",
        play_count: 6,
        unique_songs: 4,
        first_play: "Dec 31, 2023, 11:59 AM",
        last_play: "Jan 06, 2024, 12:00 PM",
      },
      {
        rank: 2,
        artist: "Y",
        play_count: 2,
        unique_songs: 2,
        first_play: "Jan 07, 2024, 11:59 AM",
        last_play: "Feb 01, 2024, 12:00 PM",
      },
      {
        rank: 2,
        artist: "Z",
        play_count: 2,
        unique_songs: 2,
        first_play: "Feb 02, 2024, 11:59 AM",
        last_play: "Mar 01, 2024, 12:00 PM",
      },
    ],
  },
  {
    name: "Artist streak ranking breaks play-count ties by higher unique song totals",
    run: () => rankArtistStreaks([
      { ts: "2024-01-01T10:00:00Z", ms_played: 31000, master_metadata_track_name: "A1", master_metadata_album_artist_name: "Artist A" },
      { ts: "2024-01-01T10:05:00Z", ms_played: 32000, master_metadata_track_name: "A2", master_metadata_album_artist_name: "Artist A" },
      { ts: "2024-01-01T10:10:00Z", ms_played: 33000, master_metadata_track_name: "B1", master_metadata_album_artist_name: "Artist B" },
      { ts: "2024-01-01T10:15:00Z", ms_played: 34000, master_metadata_track_name: "B1", master_metadata_album_artist_name: "Artist B" },
    ], "UTC"),
    expected: [
      {
        rank: 1,
        artist: "Artist A",
        play_count: 2,
        unique_songs: 2,
        first_play: "Jan 01, 2024, 9:59 AM",
        last_play: "Jan 01, 2024, 10:05 AM",
      },
      {
        rank: 2,
        artist: "Artist B",
        play_count: 2,
        unique_songs: 1,
        first_play: "Jan 01, 2024, 10:09 AM",
        last_play: "Jan 01, 2024, 10:15 AM",
      },
    ],
  },
  {
    name: "Category top limit applies to streak and daily peak rankings",
    run: () => {
      const context = buildAnalysisContext({
        allData: Array.from({ length: 11 }, (_, index) => ({
          ts: `2024-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
          ms_played: 30000 + index,
          master_metadata_track_name: `Song ${index + 1}`,
          master_metadata_album_artist_name: `Artist ${index + 1}`,
          spotify_track_uri: `spotify:track:${index + 1}`,
        })),
        startDate: "",
        endDate: "",
        topLimitValue: "10",
        timezoneLabel: "UTC",
      });

      return {
        context: {
          songDailyPeaksCount: context.songDailyPeaks.length,
          artistDailyPeaksCount: context.artistDailyPeaks.length,
          listeningStreaksCount: context.listeningStreaks.length,
          artistStreaksCount: context.artistStreaks.length,
          selectedTopLimit: context.selectedTopLimit,
        },
      };
    },
    expected: {
      context: {
        songDailyPeaksCount: 10,
        artistDailyPeaksCount: 10,
        listeningStreaksCount: 10,
        artistStreaksCount: 10,
        selectedTopLimit: "10",
      },
    },
  },
  {
    name: "Date filters and templates match the Flask context",
    run: () => {
      const context = buildAnalysisContext({
        allData: fixture,
        startDate: "2024-02-01",
        endDate: "2024-02-29",
        topLimitValue: "10",
        timezoneLabel: "UTC",
      });

      return {
        analysisRange: context.analysisRange,
        filteredRecordCount: context.filteredRecordCount,
        topLimitSummary: context.topLimitSummary,
        quickRangeTemplates: context.quickRangeTemplates,
        yearlyRangeTemplates: context.yearlyRangeTemplates,
      };
    },
    expected: {
      analysisRange: "Feb 01, 2024 to Feb 29, 2024",
      filteredRecordCount: 3,
      topLimitSummary: "Showing top 10 items in each category.",
      quickRangeTemplates: [
        { label: "All time", start: "", end: "" },
        { label: "Last 3 months", start: "2023-12-31", end: "2024-03-01" },
        { label: "Last 6 months", start: "2023-12-31", end: "2024-03-01" },
      ],
      yearlyRangeTemplates: [
        { label: "2024", start: "2024-01-01", end: "2024-03-01" },
        { label: "2023", start: "2023-12-31", end: "2023-12-31" },
      ],
    },
  },
  {
    name: "Temporal listening activity buckets match Flask values",
    run: () => {
      const context = buildAnalysisContext({
        allData: fixture,
        startDate: "",
        endDate: "",
        topLimitValue: "10",
        timezoneLabel: "UTC",
      });

      const yearly = context.temporalChartData.yearly;
      const monthlyNonZero = context.temporalChartData.monthly.filter((entry) => entry.playtime_ms || entry.play_count);
      const localReferenceHourBucket = context.temporalChartData.hourly[localReferenceHour];

      return { yearly, monthlyNonZero, localReferenceHourBucket };
    },
    expected: {
      yearly: [
        { label: "2023", playtime_ms: 35000, play_count: 1, listening_activity: 8.46 },
        { label: "2024", playtime_ms: 506000, play_count: 10, listening_activity: 100 },
      ],
      monthlyNonZero: [
        { label: "Jan", playtime_ms: 291000, play_count: 6, listening_activity: 100 },
        { label: "Feb", playtime_ms: 95000, play_count: 3, listening_activity: 41.32 },
        { label: "Mar", playtime_ms: 120000, play_count: 1, listening_activity: 28.95 },
        { label: "Dec", playtime_ms: 35000, play_count: 1, listening_activity: 14.35 },
      ],
      localReferenceHourBucket: { label: localReferenceHourLabel, playtime_ms: 541000, play_count: 11, listening_activity: 100 },
    },
  },
];

const output = document.getElementById("verify-output");
const results = checks.map(runCheck);
const passCount = results.filter((result) => result.passed).length;

const summaryCard = document.createElement("article");
summaryCard.className = `verify-item ${passCount === checks.length ? "pass" : "fail"}`;
summaryCard.innerHTML = `
  <strong>${passCount}/${checks.length} checks passed</strong>
  <div>${passCount === checks.length
    ? "The JS implementation is currently aligned with the expected Flask behavior for this fixture set."
    : "One or more parity checks failed. Review details below."
  }</div>
`;
output.append(summaryCard);

results.forEach((result) => {
  const node = document.createElement("article");
  node.className = `verify-item ${result.passed ? "pass" : "fail"}`;
  node.innerHTML = `
    <strong>${escapeHtml(result.name)}</strong>
    <div>${result.passed ? "PASS" : "FAIL"}</div>
    ${result.passed ? "" : `<pre>${escapeHtml(result.diff)}</pre>`}
  `;
  output.append(node);
});

function runCheck(check) {
  const actual = check.run();
  const expected = check.expected;
  const passed = deepEqual(actual, expected);
  return {
    name: check.name,
    passed,
    diff: passed ? "" : `Expected:\n${pretty(expected)}\n\nActual:\n${pretty(actual)}`,
  };
}

function deepEqual(left, right) {
  return pretty(left) === pretty(right);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function formatHourLabel(hour) {
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 || 12;
  return `${hour12}${suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
