export const TOP_LIMIT_CHOICES = ["10", "20", "50", "100"];
export const DEFAULT_TOP_LIMIT = "10";
export const PLAY_COUNT_THRESHOLD_MS = 30000;
export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MIN_ALBUM_LENGTH = 4;
const MIN_AVG_PLAYS = 1.5;
const MAX_STREAK_BREAK_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STREAK_LIMIT = Number.parseInt(DEFAULT_TOP_LIMIT, 10);
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeStreamingRecord(item) {
  return {
    ts: typeof item?.ts === "string" ? item.ts : "",
    ms_played: normalizeMilliseconds(item?.ms_played),
    master_metadata_track_name: item?.master_metadata_track_name ?? null,
    master_metadata_album_artist_name: item?.master_metadata_album_artist_name ?? null,
    master_metadata_album_album_name: item?.master_metadata_album_album_name ?? null,
    spotify_track_uri: item?.spotify_track_uri ?? null,
  };
}

export function isMusicRecord(item) {
  return hasDisplayValue(item?.master_metadata_track_name) && hasDisplayValue(item?.master_metadata_album_artist_name);
}

export function filterMusicStreamingData(streamingData) {
  return streamingData.filter(isMusicRecord);
}

export function parseTopLimit(value) {
  let normalizedValue = String(value || DEFAULT_TOP_LIMIT).trim().toLowerCase();
  if (!TOP_LIMIT_CHOICES.includes(normalizedValue)) {
    normalizedValue = DEFAULT_TOP_LIMIT;
  }

  return { limit: Number.parseInt(normalizedValue, 10), selectedTopLimit: normalizedValue };
}

export function formatTopLimitSummary(selectedTopLimit) {
  return `Showing top ${selectedTopLimit} items in each category.`;
}

export function buildTopLimitTemplates() {
  return TOP_LIMIT_CHOICES.map((option) => ({
    value: option,
    label: option,
  }));
}

export function parseSpotifyTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp;
}

export function parseDateInput(value) {
  if (!value) {
    return "";
  }

  const match = String(value).trim().match(ISO_DATE_PATTERN);
  if (!match) {
    return "";
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const maxDay = daysInMonth(year, month);

  if (month < 1 || month > 12 || day < 1 || day > maxDay) {
    return "";
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function filterStreamingDataByDate(streamingData, startDate = "", endDate = "") {
  if (!startDate && !endDate) {
    return streamingData;
  }

  return streamingData.filter((item) => {
    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      return false;
    }

    const playedOn = getLocalDateKey(playedAt);
    if (startDate && playedOn < startDate) {
      return false;
    }
    if (endDate && playedOn > endDate) {
      return false;
    }

    return true;
  });
}

export function formatAnalysisRange(startDate = "", endDate = "") {
  if (startDate && endDate) {
    if (startDate === endDate) {
      return formatDateLabel(startDate);
    }
    return `${formatDateLabel(startDate)} to ${formatDateLabel(endDate)}`;
  }

  if (startDate) {
    return `From ${formatDateLabel(startDate)}`;
  }

  if (endDate) {
    return `Up to ${formatDateLabel(endDate)}`;
  }

  return "All time";
}

export function subtractMonths(anchorDate, months) {
  const parsed = parseDateParts(anchorDate);
  if (!parsed) {
    return "";
  }

  let { year, month, day } = parsed;
  month -= months;

  while (month <= 0) {
    month += 12;
    year -= 1;
  }

  day = Math.min(day, daysInMonth(year, month));
  return buildIsoDate(year, month, day);
}

export function getAvailableDateMetadata(streamingData) {
  let earliestDate = "";
  let latestDate = "";
  const availableYears = new Set();

  for (const item of streamingData) {
    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      continue;
    }

    const playedOn = getLocalDateKey(playedAt);
    if (!earliestDate || playedOn < earliestDate) {
      earliestDate = playedOn;
    }
    if (!latestDate || playedOn > latestDate) {
      latestDate = playedOn;
    }
    availableYears.add(playedAt.getFullYear());
  }

  return {
    earliestDate,
    latestDate,
    availableYears: Array.from(availableYears).sort((left, right) => right - left),
  };
}

export function buildRangeTemplates(earliestDate, latestDate, availableYears) {
  const quickTemplates = [{ label: "All time", start: "", end: "" }];

  if (earliestDate && latestDate) {
    for (const months of [3, 6]) {
      let startDate = subtractMonths(latestDate, months);
      if (startDate < earliestDate) {
        startDate = earliestDate;
      }

      quickTemplates.push({
        label: `Last ${months} months`,
        start: startDate,
        end: latestDate,
      });
    }
  }

  const yearlyTemplates = [];
  if (earliestDate && latestDate) {
    for (const year of availableYears) {
      const startDate = earliestDate > `${year}-01-01` ? earliestDate : `${year}-01-01`;
      const endDate = latestDate < `${year}-12-31` ? latestDate : `${year}-12-31`;

      yearlyTemplates.push({
        label: String(year),
        start: startDate,
        end: endDate,
      });
    }
  }

  return { quickTemplates, yearlyTemplates };
}

export function buildTemporalChartData(streamingData) {
  const yearlyTotals = new Map();
  const monthlyTotals = MONTH_LABELS.map((label) => ({ label, playtime_ms: 0, play_count: 0 }));
  const weekdayTotals = WEEKDAY_LABELS.map((label) => ({ label, playtime_ms: 0, play_count: 0 }));
  const hourlyTotals = Array.from({ length: 24 }, (_, hour) => ({
    label: formatHourLabel(hour),
    playtime_ms: 0,
    play_count: 0,
  }));

  for (const item of streamingData) {
    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      continue;
    }

    const msPlayed = normalizeMilliseconds(item.ms_played);
    const countsAsPlay = msPlayed >= PLAY_COUNT_THRESHOLD_MS;
    const year = playedAt.getFullYear();

    if (!yearlyTotals.has(year)) {
      yearlyTotals.set(year, {
        label: String(year),
        playtime_ms: 0,
        play_count: 0,
      });
    }

    const yearBucket = yearlyTotals.get(year);
    yearBucket.playtime_ms += msPlayed;
    monthlyTotals[playedAt.getMonth()].playtime_ms += msPlayed;
    weekdayTotals[getMondayFirstWeekday(playedAt)].playtime_ms += msPlayed;
    hourlyTotals[playedAt.getHours()].playtime_ms += msPlayed;

    if (countsAsPlay) {
      yearBucket.play_count += 1;
      monthlyTotals[playedAt.getMonth()].play_count += 1;
      weekdayTotals[getMondayFirstWeekday(playedAt)].play_count += 1;
      hourlyTotals[playedAt.getHours()].play_count += 1;
    }
  }

  const yearlyEntries = Array.from(yearlyTotals.entries())
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);

  return {
    yearly: addListeningActivity(yearlyEntries),
    monthly: addListeningActivity(monthlyTotals),
    weekday: addListeningActivity(weekdayTotals),
    hourly: addListeningActivity(hourlyTotals),
  };
}

export function rankSongsPT(streamingData, limit = null) {
  const songTotals = new Map();
  const songUris = new Map();

  for (const item of streamingData) {
    const track = item.master_metadata_track_name ?? null;
    const artist = item.master_metadata_album_artist_name ?? null;
    const key = serializeTuple(track, artist);

    songTotals.set(key, (songTotals.get(key) || 0) + normalizeMilliseconds(item.ms_played));
    if (!songUris.has(key) && item.spotify_track_uri) {
      songUris.set(key, item.spotify_track_uri);
    }
  }

  const songs = Array.from(songTotals.entries()).map(([key, playtimeMs]) => {
    const [track, artist] = deserializeTuple(key);
    return {
      track,
      artist,
      playtimeMs,
      uri: songUris.get(key) || null,
    };
  });

  songs.sort((left, right) => right.playtimeMs - left.playtimeMs);

  let currentRank = 0;
  let previousPlaytime = null;
  for (const song of songs) {
    if (song.playtimeMs !== previousPlaytime) {
      currentRank += 1;
      previousPlaytime = song.playtimeMs;
    }

    song.rank = currentRank;
    song.playtime = formatPlaytime(song.playtimeMs);
  }

  return applyLimit(
    songs.map((song) => ({
      track: song.track,
      artist: song.artist,
      playtime: song.playtime,
      rank: song.rank,
      uri: song.uri,
    })),
    limit,
  );
}

export function rankSongsTP(streamingData, limit = null) {
  const songTotals = new Map();
  const songUris = new Map();

  for (const item of streamingData) {
    const msPlayed = normalizeMilliseconds(item.ms_played);
    if (msPlayed <= 30000) {
      continue;
    }

    const track = item.master_metadata_track_name ?? null;
    const artist = item.master_metadata_album_artist_name ?? null;
    const key = serializeTuple(track, artist);

    songTotals.set(key, (songTotals.get(key) || 0) + 1);
    if (!songUris.has(key) && item.spotify_track_uri) {
      songUris.set(key, item.spotify_track_uri);
    }
  }

  const songs = Array.from(songTotals.entries()).map(([key, timesPlayed]) => {
    const [track, artist] = deserializeTuple(key);
    return {
      track,
      artist,
      timesPlayed,
      uri: songUris.get(key) || null,
    };
  });

  songs.sort((left, right) => right.timesPlayed - left.timesPlayed);

  let currentRank = 0;
  let previousTimesPlayed = null;
  for (const song of songs) {
    if (song.timesPlayed !== previousTimesPlayed) {
      currentRank += 1;
      previousTimesPlayed = song.timesPlayed;
    }

    song.rank = currentRank;
  }

  return applyLimit(
    songs.map((song) => ({
      track: song.track,
      artist: song.artist,
      times_played: song.timesPlayed,
      rank: song.rank,
      uri: song.uri,
    })),
    limit,
  );
}

export function rankArtistsPT(streamingData, limit = null) {
  const artistTotals = new Map();

  for (const item of streamingData) {
    const artist = item.master_metadata_album_artist_name ?? null;
    artistTotals.set(artist, (artistTotals.get(artist) || 0) + normalizeMilliseconds(item.ms_played));
  }

  const artists = Array.from(artistTotals.entries()).map(([artist, playtimeMs]) => ({
    artist,
    playtimeMs,
  }));

  artists.sort((left, right) => right.playtimeMs - left.playtimeMs);

  let currentRank = 0;
  let previousPlaytime = null;
  for (const artist of artists) {
    if (artist.playtimeMs !== previousPlaytime) {
      currentRank += 1;
      previousPlaytime = artist.playtimeMs;
    }

    artist.rank = currentRank;
    artist.playtime = formatPlaytime(artist.playtimeMs);
  }

  return applyLimit(
    artists.map((artist) => ({
      artist: artist.artist,
      playtime: artist.playtime,
      rank: artist.rank,
    })),
    limit,
  );
}

export function rankArtistsTP(streamingData, limit = null) {
  const artistTotals = new Map();

  for (const item of streamingData) {
    if (normalizeMilliseconds(item.ms_played) <= 30000) {
      continue;
    }

    const artist = item.master_metadata_album_artist_name ?? null;
    artistTotals.set(artist, (artistTotals.get(artist) || 0) + 1);
  }

  const artists = Array.from(artistTotals.entries()).map(([artist, timesPlayed]) => ({
    artist,
    timesPlayed,
  }));

  artists.sort((left, right) => right.timesPlayed - left.timesPlayed);

  let currentRank = 0;
  let previousTimesPlayed = null;
  for (const artist of artists) {
    if (artist.timesPlayed !== previousTimesPlayed) {
      currentRank += 1;
      previousTimesPlayed = artist.timesPlayed;
    }

    artist.rank = currentRank;
  }

  return applyLimit(
    artists.map((artist) => ({
      artist: artist.artist,
      times_played: artist.timesPlayed,
      rank: artist.rank,
    })),
    limit,
  );
}

export function rankSongDailyPeaks(streamingData, limit = null) {
  const dailySongTotals = new Map();
  const songUris = new Map();

  for (const item of streamingData) {
    const msPlayed = normalizeMilliseconds(item.ms_played);
    if (msPlayed <= PLAY_COUNT_THRESHOLD_MS) {
      continue;
    }

    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      continue;
    }

    const track = item.master_metadata_track_name ?? null;
    const artist = item.master_metadata_album_artist_name ?? null;
    const playedOn = getLocalDateKey(playedAt);
    const key = serializeTuple(track, artist, playedOn);
    const songKey = serializeTuple(track, artist);

    dailySongTotals.set(key, (dailySongTotals.get(key) || 0) + 1);
    if (!songUris.has(songKey) && item.spotify_track_uri) {
      songUris.set(songKey, item.spotify_track_uri);
    }
  }

  const peaks = Array.from(dailySongTotals.entries()).map(([key, timesPlayed]) => {
    const [track, artist, playedOn] = deserializeTuple(key);
    return {
      track,
      artist,
      playedOn,
      timesPlayed,
      uri: songUris.get(serializeTuple(track, artist)) || null,
    };
  });

  peaks.sort((left, right) =>
    right.timesPlayed - left.timesPlayed
    || left.playedOn.localeCompare(right.playedOn)
    || displaySortValue(left.track).localeCompare(displaySortValue(right.track))
    || displaySortValue(left.artist).localeCompare(displaySortValue(right.artist)),
  );

  let currentRank = 0;
  let previousTimesPlayed = null;
  for (const peak of peaks) {
    if (peak.timesPlayed !== previousTimesPlayed) {
      currentRank += 1;
      previousTimesPlayed = peak.timesPlayed;
    }

    peak.rank = currentRank;
  }

  return applyLimit(
    peaks.map((peak) => ({
      track: peak.track,
      artist: peak.artist,
      times_played: peak.timesPlayed,
      date: formatDateLabel(peak.playedOn),
      rank: peak.rank,
      uri: peak.uri,
    })),
    limit,
  );
}

export function rankArtistDailyPeaks(streamingData, limit = null) {
  const dailyArtistTotals = new Map();

  for (const item of streamingData) {
    const msPlayed = normalizeMilliseconds(item.ms_played);
    if (msPlayed <= PLAY_COUNT_THRESHOLD_MS) {
      continue;
    }

    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      continue;
    }

    const artist = item.master_metadata_album_artist_name ?? null;
    const playedOn = getLocalDateKey(playedAt);
    const key = serializeTuple(artist, playedOn);
    dailyArtistTotals.set(key, (dailyArtistTotals.get(key) || 0) + 1);
  }

  const peaks = Array.from(dailyArtistTotals.entries()).map(([key, timesPlayed]) => {
    const [artist, playedOn] = deserializeTuple(key);
    return {
      artist,
      playedOn,
      timesPlayed,
    };
  });

  peaks.sort((left, right) =>
    right.timesPlayed - left.timesPlayed
    || left.playedOn.localeCompare(right.playedOn)
    || displaySortValue(left.artist).localeCompare(displaySortValue(right.artist)),
  );

  let currentRank = 0;
  let previousTimesPlayed = null;
  for (const peak of peaks) {
    if (peak.timesPlayed !== previousTimesPlayed) {
      currentRank += 1;
      previousTimesPlayed = peak.timesPlayed;
    }

    peak.rank = currentRank;
  }

  return applyLimit(
    peaks.map((peak) => ({
      artist: peak.artist,
      times_played: peak.timesPlayed,
      date: formatDateLabel(peak.playedOn),
      rank: peak.rank,
    })),
    limit,
  );
}

export function calculateAlbumEngagement(playtimes, playcounts) {
  if (!playtimes.length || !playcounts.length) {
    return 0;
  }

  const totalPlaytime = playtimes.reduce((sum, value) => sum + value, 0);
  if (totalPlaytime === 0) {
    return 0;
  }

  const trackCount = playtimes.length;
  if (trackCount < MIN_ALBUM_LENGTH) {
    return 0;
  }

  const proportions = playtimes.map((playtime) => playtime / totalPlaytime);
  let entropy = 0;
  for (const proportion of proportions) {
    if (proportion > 0) {
      entropy -= proportion * Math.log(proportion);
    }
  }

  const evenness = trackCount > 1 ? entropy / Math.log(trackCount) : 1;
  const averagePlays = playcounts.reduce((sum, value) => sum + value, 0) / trackCount;
  const depthBonus = averagePlays < MIN_AVG_PLAYS ? 0.7 : Math.pow(averagePlays, 0.6);
  const breadthBonus = Math.sqrt(trackCount);

  return totalPlaytime * evenness * depthBonus * breadthBonus;
}

export function rankAlbums(streamingData, limit = null) {
  const albumTotals = new Map();
  const albumTracks = new Map();
  const albumTrackPlaytime = new Map();
  const albumTrackCount = new Map();
  const albumTrackUri = new Map();

  for (const item of streamingData) {
    const msPlayed = normalizeMilliseconds(item.ms_played);
    if (msPlayed <= 30000) {
      continue;
    }

    const album = item.master_metadata_album_album_name;
    const artist = item.master_metadata_album_artist_name;
    const track = item.master_metadata_track_name;
    const trackUri = item.spotify_track_uri;

    if (!album || !artist || !track) {
      continue;
    }

    const key = serializeTuple(album, artist);
    if (!albumTracks.has(key)) {
      albumTracks.set(key, new Set());
      albumTrackPlaytime.set(key, new Map());
      albumTrackCount.set(key, new Map());
      albumTrackUri.set(key, new Map());
    }

    albumTracks.get(key).add(track);
    albumTotals.set(key, (albumTotals.get(key) || 0) + msPlayed);

    const playtimeMap = albumTrackPlaytime.get(key);
    const countMap = albumTrackCount.get(key);
    playtimeMap.set(track, (playtimeMap.get(track) || 0) + msPlayed);
    countMap.set(track, (countMap.get(track) || 0) + 1);

    if (trackUri && !albumTrackUri.get(key).has(track)) {
      albumTrackUri.get(key).set(track, trackUri);
    }
  }

  const validKeys = Array.from(albumTracks.entries())
    .filter((entry) => entry[1].size >= MIN_ALBUM_LENGTH)
    .map((entry) => entry[0]);

  const albums = [];
  for (const key of validKeys) {
    const [album, artist] = deserializeTuple(key);
    const playtimeMap = albumTrackPlaytime.get(key);
    const countMap = albumTrackCount.get(key);
    const playtimesList = Array.from(playtimeMap.values());
    const playcountsList = Array.from(countMap.values());
    const score = calculateAlbumEngagement(playtimesList, playcountsList);
    const totalPlaytime = albumTotals.get(key) || 0;

    let uri = null;
    if (playtimesList.length) {
      const maxPlaytime = Math.max(...playtimesList);
      const mostPlayedIndex = playtimesList.indexOf(maxPlaytime);
      const mostPlayedTrack = Array.from(playtimeMap.keys())[mostPlayedIndex];
      uri = albumTrackUri.get(key).get(mostPlayedTrack) || null;
    }

    albums.push({
      album,
      artist,
      totalPlaytime,
      uri,
      score,
    });
  }

  albums.sort((left, right) => right.score - left.score);

  let currentRank = 0;
  let previousScore = null;
  for (const album of albums) {
    if (album.score !== previousScore) {
      currentRank += 1;
      previousScore = album.score;
    }

    album.rank = currentRank;
    album.playtime = formatPlaytime(album.totalPlaytime);
  }

  return applyLimit(
    albums.map((album) => ({
      album: album.album,
      artist: album.artist,
      playtime: album.playtime,
      rank: album.rank,
      uri: album.uri,
    })),
    limit,
  );
}

export function rankListeningStreaks(streamingData, timezoneLabel = "UTC", limit = DEFAULT_STREAK_LIMIT) {
  const formatDateTime = createDateTimeFormatter(timezoneLabel);
  const plays = streamingData
    .map((item) => {
      const endedAt = parseSpotifyTimestamp(item.ts);
      const msPlayed = normalizeMilliseconds(item.ms_played);
      if (!endedAt || msPlayed <= 0) {
        return null;
      }

      const endedAtMs = endedAt.getTime();
      return {
        startedAtMs: endedAtMs - msPlayed,
        observedEndMs: endedAtMs,
        playtimeMs: msPlayed,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => left.startedAtMs - right.startedAtMs);

  if (!plays.length) {
    return [];
  }

  const streaks = [];
  let currentStreak = {
    startedAtMs: plays[0].startedAtMs,
    observedEndMs: plays[0].observedEndMs,
    displayEndMs: plays[0].startedAtMs + plays[0].playtimeMs,
    playtimeMs: plays[0].playtimeMs,
  };

  for (let index = 1; index < plays.length; index += 1) {
    const play = plays[index];
    const gapMs = play.startedAtMs - currentStreak.observedEndMs;

    if (gapMs <= MAX_STREAK_BREAK_MS) {
      currentStreak.observedEndMs = Math.max(currentStreak.observedEndMs, play.observedEndMs);
      currentStreak.displayEndMs += Math.max(0, gapMs) + play.playtimeMs;
      currentStreak.playtimeMs += play.playtimeMs;
      continue;
    }

    streaks.push(finalizeListeningStreak(currentStreak));
    currentStreak = {
      startedAtMs: play.startedAtMs,
      observedEndMs: play.observedEndMs,
      displayEndMs: play.startedAtMs + play.playtimeMs,
      playtimeMs: play.playtimeMs,
    };
  }

  streaks.push(finalizeListeningStreak(currentStreak));
  streaks.sort((left, right) => right.playtimeMs - left.playtimeMs || left.startedAtMs - right.startedAtMs);

  let currentRank = 0;
  let previousPlaytime = null;
  for (const streak of streaks) {
    if (streak.playtimeMs !== previousPlaytime) {
      currentRank += 1;
      previousPlaytime = streak.playtimeMs;
    }

    streak.rank = currentRank;
    streak.playtime = formatPlaytime(streak.playtimeMs);
  }

  return applyLimit(streaks, limit).map((streak) => ({
      rank: streak.rank,
      playtime: formatPlaytime(streak.playtimeMs),
      start_datetime: formatDateTime(streak.startedAtMs),
      end_datetime: formatDateTime(streak.endedAtMs),
    }));
}

export function rankArtistStreaks(streamingData, timezoneLabel = "UTC", limit = DEFAULT_STREAK_LIMIT) {
  const formatDateTime = createDateTimeFormatter(timezoneLabel);
  const plays = streamingData
    .map((item) => {
      const endedAt = parseSpotifyTimestamp(item.ts);
      const msPlayed = normalizeMilliseconds(item.ms_played);
      if (!endedAt || msPlayed <= PLAY_COUNT_THRESHOLD_MS) {
        return null;
      }

      const artist = item.master_metadata_album_artist_name ?? null;
      const track = item.master_metadata_track_name ?? null;
      const endedAtMs = endedAt.getTime();

      return {
        artist,
        artistKey: serializeTuple(artist),
        songKey: serializeTuple(track, artist),
        startedAtMs: endedAtMs - msPlayed,
        endedAtMs,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => left.endedAtMs - right.endedAtMs || left.startedAtMs - right.startedAtMs);

  if (!plays.length) {
    return [];
  }

  const streaks = [];
  let currentStreak = createArtistStreak(plays[0]);

  for (let index = 1; index < plays.length; index += 1) {
    const play = plays[index];
    if (play.artistKey === currentStreak.artistKey) {
      currentStreak.playCount += 1;
      currentStreak.lastPlayEndMs = play.endedAtMs;
      currentStreak.uniqueSongKeys.add(play.songKey);
      continue;
    }

    streaks.push(finalizeArtistStreak(currentStreak));
    currentStreak = createArtistStreak(play);
  }

  streaks.push(finalizeArtistStreak(currentStreak));
  streaks.sort((left, right) =>
    right.playCount - left.playCount
    || right.uniqueSongs - left.uniqueSongs
    || left.firstPlayStartMs - right.firstPlayStartMs,
  );

  let currentRank = 0;
  let previousPlayCount = null;
  let previousUniqueSongs = null;
  for (const streak of streaks) {
    if (streak.playCount !== previousPlayCount || streak.uniqueSongs !== previousUniqueSongs) {
      currentRank += 1;
      previousPlayCount = streak.playCount;
      previousUniqueSongs = streak.uniqueSongs;
    }

    streak.rank = currentRank;
  }

  return applyLimit(streaks, limit).map((streak) => ({
      rank: streak.rank,
      artist: streak.artist,
      play_count: streak.playCount,
      unique_songs: streak.uniqueSongs,
      first_play: formatDateTime(streak.firstPlayStartMs),
      last_play: formatDateTime(streak.lastPlayEndMs),
    }));
}

export function totalPlaytime(streamingData) {
  const totalMilliseconds = streamingData.reduce((sum, item) => sum + normalizeMilliseconds(item.ms_played), 0);
  return formatPlaytime(totalMilliseconds);
}

export function artistCount(streamingData) {
  const artists = new Set();
  for (const item of streamingData) {
    artists.add(item.master_metadata_album_artist_name ?? null);
  }

  return artists.size;
}

export function totalPlayCount(streamingData) {
  let total = 0;
  for (const item of streamingData) {
    if (normalizeMilliseconds(item.ms_played) > PLAY_COUNT_THRESHOLD_MS) {
      total += 1;
    }
  }

  return total;
}

export function totalSkipCount(streamingData) {
  let total = 0;
  for (const item of streamingData) {
    if (normalizeMilliseconds(item.ms_played) <= PLAY_COUNT_THRESHOLD_MS) {
      total += 1;
    }
  }

  return total;
}

export function uniqueTracks(streamingData) {
  const tracks = new Set();
  for (const item of streamingData) {
    tracks.add(serializeTuple(item.master_metadata_track_name ?? null, item.master_metadata_album_artist_name ?? null));
  }

  return tracks.size;
}

export function uniqueAlbums(streamingData) {
  const albumTracks = new Map();

  for (const item of streamingData) {
    const album = item.master_metadata_album_album_name;
    const artist = item.master_metadata_album_artist_name;
    const track = item.master_metadata_track_name;
    if (!album || !artist || !track) {
      continue;
    }

    const key = serializeTuple(album, artist);
    if (!albumTracks.has(key)) {
      albumTracks.set(key, new Set());
    }

    albumTracks.get(key).add(track);
  }

  let total = 0;
  for (const trackSet of albumTracks.values()) {
    if (trackSet.size >= MIN_ALBUM_LENGTH) {
      total += 1;
    }
  }

  return total;
}

export function buildDailyListeningInsights(streamingData, startDate = "", endDate = "") {
  if (!streamingData.length) {
    return {
      averagePlaytime: "0s",
      averagePlaytimeDayPercentage: "0",
      averagePlayCount: "0",
      biggestListeningDay: null,
    };
  }

  const dailyTotals = new Map();
  let totalPlaytimeMs = 0;
  let totalCountedPlays = 0;
  let firstDate = "";
  let lastDate = "";

  for (const item of streamingData) {
    const playedAt = parseSpotifyTimestamp(item.ts);
    if (!playedAt) {
      continue;
    }

    const playedOn = getLocalDateKey(playedAt);
    const msPlayed = normalizeMilliseconds(item.ms_played);
    const countsAsPlay = msPlayed > PLAY_COUNT_THRESHOLD_MS;

    if (!firstDate || playedOn < firstDate) {
      firstDate = playedOn;
    }
    if (!lastDate || playedOn > lastDate) {
      lastDate = playedOn;
    }

    totalPlaytimeMs += msPlayed;
    if (countsAsPlay) {
      totalCountedPlays += 1;
    }

    if (!dailyTotals.has(playedOn)) {
      dailyTotals.set(playedOn, {
        playtimeMs: 0,
        playCount: 0,
        artists: new Set(),
      });
    }

    const dayTotals = dailyTotals.get(playedOn);
    dayTotals.playtimeMs += msPlayed;
    dayTotals.playCount += 1;
    dayTotals.artists.add(item.master_metadata_album_artist_name ?? null);
  }

  const dayCount = resolveAnalysisDayCount(startDate, endDate, firstDate, lastDate);
  const averagePlaytimeMs = dayCount ? totalPlaytimeMs / dayCount : 0;
  const averagePlayCount = dayCount ? totalCountedPlays / dayCount : 0;

  let biggestListeningDay = null;
  for (const [date, totals] of dailyTotals.entries()) {
    if (
      !biggestListeningDay
      || totals.playtimeMs > biggestListeningDay.playtimeMs
      || (
        totals.playtimeMs === biggestListeningDay.playtimeMs
        && (
          totals.playCount > biggestListeningDay.playCount
          || (
            totals.playCount === biggestListeningDay.playCount
            && (
              totals.artists.size > biggestListeningDay.artists.size
              || (
                totals.artists.size === biggestListeningDay.artists.size
                && date.localeCompare(biggestListeningDay.date) < 0
              )
            )
          )
        )
      )
    ) {
      biggestListeningDay = {
        date,
        playtimeMs: totals.playtimeMs,
        playCount: totals.playCount,
        artistCount: totals.artists.size,
      };
    }
  }

  return {
    averagePlaytime: formatNarrativePlaytime(averagePlaytimeMs),
    averagePlaytimeDayPercentage: formatPercentageOfDay(averagePlaytimeMs),
    averagePlayCount: formatIntegerValue(averagePlayCount),
    biggestListeningDay: biggestListeningDay
      ? {
          date: formatDateLabel(biggestListeningDay.date),
          playtime: formatNarrativePlaytime(biggestListeningDay.playtimeMs),
          dayPercentage: formatPercentageOfDay(biggestListeningDay.playtimeMs),
          playCount: formatIntegerValue(biggestListeningDay.playCount),
          uniqueArtists: formatIntegerValue(biggestListeningDay.artistCount),
        }
      : null,
  };
}

export function buildAnalysisContext({
  allData,
  startDate = "",
  endDate = "",
  topLimitValue = DEFAULT_TOP_LIMIT,
  timezoneLabel = "UTC",
}) {
  const musicData = filterMusicStreamingData(allData);
  const normalizedStartDate = parseDateInput(startDate);
  const normalizedEndDate = parseDateInput(endDate);
  const { limit, selectedTopLimit } = parseTopLimit(topLimitValue);
  const filteredData = filterStreamingDataByDate(musicData, normalizedStartDate, normalizedEndDate);
  const { earliestDate, latestDate, availableYears } = getAvailableDateMetadata(musicData);
  const { quickTemplates, yearlyTemplates } = buildRangeTemplates(earliestDate, latestDate, availableYears);
  const dailyListeningInsights = buildDailyListeningInsights(filteredData, normalizedStartDate, normalizedEndDate);

  return {
    songsPT: rankSongsPT(filteredData, limit),
    songsTP: rankSongsTP(filteredData, limit),
    songDailyPeaks: rankSongDailyPeaks(filteredData, limit),
    albumsPT: rankAlbums(filteredData, limit),
    artistsPT: rankArtistsPT(filteredData, limit),
    artistsTP: rankArtistsTP(filteredData, limit),
    artistDailyPeaks: rankArtistDailyPeaks(filteredData, limit),
    totalPlaytime: totalPlaytime(filteredData),
    uniqueArtists: artistCount(filteredData),
    totalPlayCount: totalPlayCount(filteredData),
    totalSkipCount: totalSkipCount(filteredData),
    uniqueTracks: uniqueTracks(filteredData),
    uniqueAlbums: uniqueAlbums(filteredData),
    dailyListeningInsights,
    listeningStreaks: rankListeningStreaks(filteredData, timezoneLabel, limit),
    artistStreaks: rankArtistStreaks(filteredData, timezoneLabel, limit),
    analysisRange: formatAnalysisRange(normalizedStartDate, normalizedEndDate),
    analysisTimezone: timezoneLabel,
    selectedTopLimit,
    topLimitSummary: formatTopLimitSummary(selectedTopLimit),
    topLimitTemplates: buildTopLimitTemplates(),
    hasResults: filteredData.length > 0,
    selectedStartDate: normalizedStartDate,
    selectedEndDate: normalizedEndDate,
    availableDateRange: earliestDate ? formatAnalysisRange(earliestDate, latestDate) : "No dated listening history found",
    dataMinDate: earliestDate,
    dataMaxDate: latestDate,
    temporalChartData: buildTemporalChartData(filteredData),
    quickRangeTemplates: quickTemplates,
    yearlyRangeTemplates: yearlyTemplates,
    rangeAnchorDate: latestDate ? formatDateLabel(latestDate) : null,
    filteredRecordCount: filteredData.length,
    totalRecordCount: musicData.length,
  };
}

export function formatPlaytime(milliseconds) {
  const safeMilliseconds = normalizeMilliseconds(milliseconds);
  const hours = Math.floor(safeMilliseconds / 3600000);
  const minutes = Math.floor((safeMilliseconds % 3600000) / 60000);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${String(minutes).padStart(2, "0")}m`;
}

export function formatHourLabel(hour) {
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 || 12;
  return `${hour12}${suffix}`;
}

function formatNarrativePlaytime(milliseconds) {
  const safeMilliseconds = normalizeMilliseconds(milliseconds);
  const totalSeconds = Math.max(0, Math.round(safeMilliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

function finalizeListeningStreak(streak) {
  return {
    startedAtMs: streak.startedAtMs,
    endedAtMs: streak.displayEndMs,
    playtimeMs: streak.playtimeMs,
  };
}

function createArtistStreak(play) {
  return {
    artist: play.artist,
    artistKey: play.artistKey,
    playCount: 1,
    uniqueSongKeys: new Set([play.songKey]),
    firstPlayStartMs: play.startedAtMs,
    lastPlayEndMs: play.endedAtMs,
  };
}

function finalizeArtistStreak(streak) {
  return {
    artist: streak.artist,
    artistKey: streak.artistKey,
    playCount: streak.playCount,
    uniqueSongs: streak.uniqueSongKeys.size,
    firstPlayStartMs: streak.firstPlayStartMs,
    lastPlayEndMs: streak.lastPlayEndMs,
  };
}

function addListeningActivity(entries) {
  const maxPlaytime = Math.max(...entries.map((entry) => entry.playtime_ms), 0);
  const maxPlaycount = Math.max(...entries.map((entry) => entry.play_count), 0);

  return entries.map((entry) => {
    const playtimeRatio = maxPlaytime ? entry.playtime_ms / maxPlaytime : 0;
    const playcountRatio = maxPlaycount ? entry.play_count / maxPlaycount : 0;

    return {
      ...entry,
      listening_activity: roundTo(((playtimeRatio + playcountRatio) / 2) * 100, 2),
    };
  });
}

function applyLimit(items, limit) {
  return limit == null ? items : items.slice(0, limit);
}

function formatDateLabel(value) {
  const parsed = parseDateParts(value);
  if (!parsed) {
    return value;
  }

  return `${MONTH_LABELS[parsed.month - 1]} ${String(parsed.day).padStart(2, "0")}, ${parsed.year}`;
}

function createDateTimeFormatter(timezoneLabel) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezoneLabel || "UTC",
  });

  return (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return formatter.format(date);
  };
}

function parseDateParts(value) {
  const match = String(value || "").match(ISO_DATE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
  };
}

function buildIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveAnalysisDayCount(startDate, endDate, firstDate, lastDate) {
  const spanStart = startDate || firstDate;
  const spanEnd = endDate || lastDate;

  if (!spanStart || !spanEnd) {
    return 0;
  }

  const parsedStart = parseDateParts(spanStart);
  const parsedEnd = parseDateParts(spanEnd);
  if (!parsedStart || !parsedEnd) {
    return 0;
  }

  const startUtc = Date.UTC(parsedStart.year, parsedStart.month - 1, parsedStart.day);
  const endUtc = Date.UTC(parsedEnd.year, parsedEnd.month - 1, parsedEnd.day);

  return Math.max(1, Math.floor((endUtc - startUtc) / DAY_MS) + 1);
}

function getLocalDateKey(date) {
  return buildIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function getMondayFirstWeekday(date) {
  return (date.getDay() + 6) % 7;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatDecimalValue(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(roundTo(value, 2));
}

function formatIntegerValue(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatPercentageOfDay(milliseconds) {
  return formatIntegerValue((normalizeMilliseconds(milliseconds) / DAY_MS) * 100);
}

function serializeTuple(...parts) {
  return JSON.stringify(parts);
}

function deserializeTuple(value) {
  return JSON.parse(value);
}

function normalizeMilliseconds(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function displaySortValue(value) {
  return value == null || value === "" ? "" : String(value);
}

function hasDisplayValue(value) {
  return value != null && String(value).trim() !== "";
}
