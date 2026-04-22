import { DEFAULT_TOP_LIMIT, PLAY_COUNT_THRESHOLD_MS, parseDateInput } from "./analysis.js";
import { renderTemporalCharts } from "./charts.js";

const app = document.getElementById("app");
const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const SPOTIFY_OEMBED_ENDPOINT = "https://open.spotify.com/oembed";
const ARTWORK_REQUEST_CONCURRENCY = 6;
const PLAY_COUNT_THRESHOLD_SECONDS = Math.round(PLAY_COUNT_THRESHOLD_MS / 1000);
const JUMP_TARGETS = [
  { id: "songs-playtime-section", label: "Top Songs By Playtime" },
  { id: "songs-play-count-section", label: "Top Songs By Play Count" },
  { id: "artists-playtime-section", label: "Top Artists By Playtime" },
  { id: "artists-play-count-section", label: "Top Artists By Play Count" },
  { id: "albums-section", label: "Top Albums" },
  { id: "charts-section", label: "Charts" },
  { id: "listening-streaks-section", label: "Top Listening Streaks" },
  { id: "artist-streaks-section", label: "Top Artist Streaks" },
  { id: "song-daily-peaks-section", label: "Single Song Daily Peaks" },
  { id: "artist-daily-peaks-section", label: "Single Artist Daily Peaks" },
];
const PLAYTIME_RANKING_COPY = `Ranked by total listening time. All music plays are included, even if they are shorter than ${PLAY_COUNT_THRESHOLD_SECONDS} seconds.`;
const STRICT_PLAY_COUNT_COPY = `Only plays longer than ${PLAY_COUNT_THRESHOLD_SECONDS} seconds are included.`;
const TABLE_INFO_TEXT = {
  songsPT: PLAYTIME_RANKING_COPY,
  songsTP: `Ranked by number of counted plays. ${STRICT_PLAY_COUNT_COPY}`,
  artistsPT: `Ranked by total listening time across all songs. All music plays are included, even if they are shorter than ${PLAY_COUNT_THRESHOLD_SECONDS} seconds.`,
  artistsTP: `Ranked by number of counted plays across all songs. ${STRICT_PLAY_COUNT_COPY}`,
  albumsPT: `Ranked by quality of engagement, not raw playtime. ${STRICT_PLAY_COUNT_COPY} Albums need at least 4 distinct tracks to qualify.`,
  listeningStreaks: "Ranked by uninterrupted listening time. All plays with positive playtime are included, and a streak breaks after a gap longer than 5 minutes.",
  artistStreaks: `Ranked by consecutive same-artist plays in listening order. Gap between plays is not considered. A streak is broken only when a different artist is played. ${STRICT_PLAY_COUNT_COPY} Ties break by the number of unique songs.`,
  songDailyPeaks: `Ranked by the most plays for one song in a single local day. ${STRICT_PLAY_COUNT_COPY}`,
  artistDailyPeaks: `Ranked by the most plays for one artist in a single local day. ${STRICT_PLAY_COUNT_COPY}`,
};
const SUMMARY_INFO_TEXT = {
  totalPlaytime: `Total listening time across all music records in the current range. Plays of ${PLAY_COUNT_THRESHOLD_SECONDS} seconds or less are still included here.`,
  totalPlayCount: `Counts only plays longer than ${PLAY_COUNT_THRESHOLD_SECONDS} seconds in the current range and shows skips separately. Plays of ${PLAY_COUNT_THRESHOLD_SECONDS} seconds or less are counted as skips.`,
  uniqueArtists: `Counts distinct artist names across all music records in the current range. Plays of ${PLAY_COUNT_THRESHOLD_SECONDS} seconds or less are still included here.`,
  uniqueTracks: `Counts distinct track and artist combinations across all music records in the current range, including plays of ${PLAY_COUNT_THRESHOLD_SECONDS} seconds or less.`,
  uniqueAlbums: `Counts albums with at least 4 distinct tracks across all music records in the current range, including plays of ${PLAY_COUNT_THRESHOLD_SECONDS} seconds or less.`,
};
const INITIAL_REVEAL_SECTION_IDS = new Set([
  "summary-stats-section",
]);
let worker = null;
let artworkQueue = [];
const artworkByHref = new Map();
const queuedArtworkHrefs = new Set();
const inFlightArtworkHrefs = new Set();
const failedArtworkHrefs = new Set();
let activeArtworkRequests = 0;
let artworkEpoch = 0;
let artworkRenderTimer = 0;
let revealSectionObserver = null;
let infoTooltipAlignmentFrame = 0;

const state = {
  analysis: null,
  errorMessage: "",
  isLoading: false,
  loadingMessage: "",
  activeRequestId: 0,
  workerReady: false,
  timezoneLabel,
  revealedSections: new Set(),
  panels: {
    range: false,
    topLimit: false,
    jumpTo: false,
  },
};

initializeWorker();

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  if (form.matches("[data-upload-form]")) {
    event.preventDefault();
    handleUploadSubmit(form);
    return;
  }

  if (form.matches("[data-range-form]")) {
    event.preventDefault();
    handleRangeSubmit(form);
  }
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const toggleButton = target.closest("[data-toggle-panel]");
  if (toggleButton instanceof HTMLButtonElement) {
    const panelName = toggleButton.dataset.togglePanel;
    if (panelName === "range" || panelName === "topLimit" || panelName === "jumpTo") {
      state.panels[panelName] = !state.panels[panelName];
      render();
    }
    return;
  }

  const jumpButton = target.closest("[data-jump-target]");
  if (jumpButton instanceof HTMLButtonElement) {
    event.preventDefault();
    jumpToSection(jumpButton.dataset.jumpTarget || "");
    return;
  }

  const templateButton = target.closest("[data-template-range]");
  if (templateButton instanceof HTMLButtonElement) {
    event.preventDefault();
    state.panels.range = false;
    runAnalysis({
      startDate: templateButton.dataset.start || "",
      endDate: templateButton.dataset.end || "",
      topLimit: state.analysis?.selectedTopLimit || DEFAULT_TOP_LIMIT,
    });
    return;
  }

  const limitButton = target.closest("[data-top-limit]");
  if (limitButton instanceof HTMLButtonElement) {
    event.preventDefault();
    runAnalysis({
      startDate: state.analysis?.selectedStartDate || "",
      endDate: state.analysis?.selectedEndDate || "",
      topLimit: limitButton.dataset.topLimit || DEFAULT_TOP_LIMIT,
    });
    return;
  }

  const clearButton = target.closest("[data-clear-analysis]");
  if (clearButton instanceof HTMLButtonElement) {
    event.preventDefault();
    if (!ensureWorker()) {
      return;
    }

    worker.postMessage({ type: "clear-data", requestId: nextRequestId() });
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.type === "file" && target.name === "spotify_zip") {
    syncSelectedUploadDisplay(target);
    return;
  }

  if (target.type !== "date") {
    return;
  }

  if (target.id === "start-date" || target.id === "end-date") {
    syncDateBounds("start-date", "end-date");
    return;
  }

  if (target.id === "results-start-date" || target.id === "results-end-date") {
    syncDateBounds("results-start-date", "results-end-date");
  }
});

app.addEventListener("dragover", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.closest("[data-file-dropzone]")) {
    return;
  }

  event.preventDefault();
});

app.addEventListener("drop", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const dropzone = target.closest("[data-file-dropzone]");
  if (!(dropzone instanceof HTMLElement)) {
    return;
  }

  const fileInput = dropzone.querySelector('input[type="file"][name="spotify_zip"]');
  if (!(fileInput instanceof HTMLInputElement) || fileInput.disabled || !event.dataTransfer?.files?.length) {
    return;
  }

  event.preventDefault();
  fileInput.files = event.dataTransfer.files;
  syncSelectedUploadDisplay(fileInput);
});

window.addEventListener("resize", () => {
  scheduleInfoTooltipAlignment();
});

render();

function syncSelectedUploadDisplay(fileInput) {
  const dropzone = fileInput.closest("[data-file-dropzone]");
  if (!(dropzone instanceof HTMLElement)) {
    return;
  }

  const title = dropzone.querySelector(".file-dropzone-title");
  const copy = dropzone.querySelector(".file-dropzone-copy");
  if (!(title instanceof HTMLElement) || !(copy instanceof HTMLElement)) {
    return;
  }

  const fileCount = fileInput.files?.length ?? 0;
  dropzone.classList.toggle("has-file", fileCount > 0);

  if (fileCount === 1) {
    title.textContent = "File selected";
    copy.textContent = fileInput.files?.[0]?.name || "ZIP file selected";
    return;
  }

  if (fileCount > 1) {
    title.textContent = `${fileCount} files selected`;
    copy.textContent = "Only the first ZIP will be analyzed.";
    return;
  }

  title.textContent = "Choose File or Drag And Drop";
  copy.textContent = "ZIP files only";
}

function initializeWorker() {
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    state.workerReady = false;
    state.errorMessage = "This browser could not start the analysis worker. Use a recent Chromium-based browser.";
    render();
    return;
  }

  worker.addEventListener("message", (event) => {
    const { type, requestId, payload } = event.data || {};

    if (type === "ready") {
      state.workerReady = true;
      render();
      return;
    }

    if (requestId && requestId !== state.activeRequestId) {
      return;
    }

    if (type === "status") {
      state.loadingMessage = payload.message;
      render();
      return;
    }

    if (type === "analysis") {
      state.analysis = payload;
      state.errorMessage = "";
      state.isLoading = false;
      state.loadingMessage = "";
      state.revealedSections = createInitialRevealedSections();
      render();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    if (type === "error") {
      state.isLoading = false;
      state.loadingMessage = "";
      state.errorMessage = payload.message;
      render();
      return;
    }

    if (type === "cleared") {
      clearArtworkState();
      state.analysis = null;
      state.errorMessage = "";
      state.isLoading = false;
      state.loadingMessage = "";
      state.revealedSections = new Set();
      state.panels.range = false;
      state.panels.topLimit = false;
      state.panels.jumpTo = false;
      render();
    }
  });
}

async function handleUploadSubmit(form) {
  const fileInput = form.elements.namedItem("spotify_zip");
  const startField = form.elements.namedItem("start_date");
  const endField = form.elements.namedItem("end_date");
  const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
  const startDate = startField instanceof HTMLInputElement ? startField.value : "";
  const endDate = endField instanceof HTMLInputElement ? endField.value : "";

  if (!file) {
    state.errorMessage = "Please choose your Spotify ZIP first.";
    render();
    return;
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    state.errorMessage = "Please upload a ZIP file.";
    render();
    return;
  }

  const validated = validateDateRange(startDate, endDate);
  if (validated.errorMessage) {
    state.errorMessage = validated.errorMessage;
    render();
    return;
  }

  clearArtworkState();
  state.errorMessage = "";
  state.isLoading = true;
  state.loadingMessage = "Reading Spotify ZIP";
  render();

  try {
    if (!ensureWorker()) {
      return;
    }

    const buffer = await file.arrayBuffer();
    const requestId = nextRequestId();
    state.activeRequestId = requestId;

    worker.postMessage(
      {
        type: "parse-upload",
        requestId,
        payload: {
          buffer,
          startDate: validated.startDate,
          endDate: validated.endDate,
          topLimit: DEFAULT_TOP_LIMIT,
          timezoneLabel: state.timezoneLabel,
        },
      },
      [buffer],
    );
  } catch (error) {
    state.isLoading = false;
    state.loadingMessage = "";
    state.errorMessage = error instanceof Error ? error.message : "The ZIP could not be read.";
    render();
  }
}

function handleRangeSubmit(form) {
  const startField = form.elements.namedItem("start_date");
  const endField = form.elements.namedItem("end_date");
  const validated = validateDateRange(
    startField instanceof HTMLInputElement ? startField.value : "",
    endField instanceof HTMLInputElement ? endField.value : "",
  );

  if (validated.errorMessage) {
    state.errorMessage = validated.errorMessage;
    render();
    return;
  }

  state.panels.range = false;
  runAnalysis({
    startDate: validated.startDate,
    endDate: validated.endDate,
    topLimit: state.analysis?.selectedTopLimit || DEFAULT_TOP_LIMIT,
  });
}

function runAnalysis({ startDate, endDate, topLimit }) {
  if (!state.analysis) {
    return;
  }
  if (!ensureWorker()) {
    return;
  }

  state.errorMessage = "";
  state.isLoading = true;
  state.loadingMessage = "Refreshing results";
  render();

  const requestId = nextRequestId();
  state.activeRequestId = requestId;

  worker.postMessage({
    type: "reanalyze",
    requestId,
    payload: {
      startDate,
      endDate,
      topLimit,
      timezoneLabel: state.timezoneLabel,
    },
  });
}

function ensureWorker() {
  if (worker) {
    return true;
  }

  state.isLoading = false;
  state.loadingMessage = "";
  state.errorMessage = "Analysis worker is unavailable in this browser session.";
  render();
  return false;
}

function render() {
  teardownSectionObservers();

  document.title = state.analysis ? "Your Spotify Stats" : "Spotify Stats Analyzer";
  app.innerHTML = state.analysis ? renderResultsView() : renderLandingView();
  scheduleInfoTooltipAlignment();

  if (state.analysis) {
    syncDateBounds("results-start-date", "results-end-date");
    renderTemporalCharts(state.analysis.temporalChartData);
    refreshSectionObservers();
    queueVisibleArtworkFetches(state.analysis);
  } else {
    syncDateBounds("start-date", "end-date");
  }
}

function teardownSectionObservers() {
  if (revealSectionObserver) {
    revealSectionObserver.disconnect();
    revealSectionObserver = null;
  }
}

function createInitialRevealedSections() {
  return new Set(INITIAL_REVEAL_SECTION_IDS);
}

function refreshSectionObservers() {
  if (!state.analysis) {
    return;
  }

  const revealSections = Array.from(document.querySelectorAll("[data-reveal-section]"));

  if (typeof IntersectionObserver === "undefined") {
    revealSections.forEach((section) => {
      section.classList.add("is-visible");
      rememberRevealedSection(section);
    });
    return;
  }

  if (!revealSections.length) {
    return;
  }

  if (prefersReducedMotion()) {
    revealSections.forEach((section) => {
      section.classList.add("is-visible");
      rememberRevealedSection(section);
    });
    return;
  }

  revealSectionObserver = new IntersectionObserver(handleRevealSectionIntersections, {
    rootMargin: "0px 0px -6% 0px",
    threshold: 0.06,
  });

  revealSections.forEach((section) => {
    if (state.revealedSections.has(getRevealSectionKey(section))) {
      section.classList.add("is-visible");
      return;
    }

    revealSectionObserver.observe(section);
  });
}

function handleRevealSectionIntersections(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) {
      continue;
    }

    entry.target.classList.add("is-visible");
    rememberRevealedSection(entry.target);
    revealSectionObserver?.unobserve(entry.target);
  }
}

function getRevealSectionKey(section) {
  return section instanceof HTMLElement ? section.dataset.revealSection || section.id || "" : "";
}

function rememberRevealedSection(section) {
  const revealKey = getRevealSectionKey(section);
  if (revealKey) {
    state.revealedSections.add(revealKey);
  }
}

function shouldRenderSectionVisible(revealKey) {
  return state.revealedSections.has(revealKey)
    || typeof IntersectionObserver === "undefined"
    || prefersReducedMotion();
}

function buildRevealSectionClassName(baseClass, revealKey) {
  return shouldRenderSectionVisible(revealKey)
    ? `${baseClass} reveal-section is-visible`
    : `${baseClass} reveal-section`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearArtworkState() {
  artworkEpoch += 1;
  artworkQueue = [];
  artworkByHref.clear();
  queuedArtworkHrefs.clear();
  inFlightArtworkHrefs.clear();
  failedArtworkHrefs.clear();
  activeArtworkRequests = 0;

  if (artworkRenderTimer) {
    clearTimeout(artworkRenderTimer);
    artworkRenderTimer = 0;
  }
}

function queueVisibleArtworkFetches(analysis) {
  if (!analysis?.hasResults || typeof fetch !== "function") {
    return;
  }

  const nextEntries = [];
  for (const href of collectVisibleArtworkHrefs(analysis)) {
    if (artworkByHref.has(href) || failedArtworkHrefs.has(href) || queuedArtworkHrefs.has(href) || inFlightArtworkHrefs.has(href)) {
      continue;
    }

    queuedArtworkHrefs.add(href);
    nextEntries.push({ href, epoch: artworkEpoch });
  }

  if (!nextEntries.length) {
    return;
  }

  artworkQueue = nextEntries.concat(artworkQueue);
  pumpArtworkQueue();
}

function collectVisibleArtworkHrefs(analysis) {
  const hrefs = new Set();
  const artworkLists = [
    { sectionId: "songs-playtime-section", items: analysis.songsPT },
    { sectionId: "songs-play-count-section", items: analysis.songsTP },
    { sectionId: "song-daily-peaks-section", items: analysis.songDailyPeaks },
    { sectionId: "albums-section", items: analysis.albumsPT },
  ];

  for (const entry of artworkLists) {
    const items = entry.items;
    if (!Array.isArray(items)) {
      continue;
    }

    for (const item of items) {
      const href = safeSpotifyHref(item?.uri);
      if (href) {
        hrefs.add(href);
      }
    }
  }

  return hrefs;
}

function pumpArtworkQueue() {
  while (activeArtworkRequests < ARTWORK_REQUEST_CONCURRENCY && artworkQueue.length) {
    const nextItem = artworkQueue.shift();
    if (!nextItem) {
      return;
    }

    queuedArtworkHrefs.delete(nextItem.href);
    inFlightArtworkHrefs.add(nextItem.href);
    activeArtworkRequests += 1;

    void fetchArtworkForHref(nextItem.href, nextItem.epoch).finally(() => {
      if (nextItem.epoch !== artworkEpoch) {
        return;
      }

      inFlightArtworkHrefs.delete(nextItem.href);
      activeArtworkRequests = Math.max(0, activeArtworkRequests - 1);
      pumpArtworkQueue();
    });
  }
}

async function fetchArtworkForHref(href, epoch) {
  try {
    const response = await fetch(`${SPOTIFY_OEMBED_ENDPOINT}?url=${encodeURIComponent(href)}`, {
      credentials: "omit",
    });
    if (!response.ok) {
      throw new Error(`Spotify oEmbed returned ${response.status}`);
    }

    const payload = await response.json();
    const thumbnailUrl = typeof payload?.thumbnail_url === "string" ? payload.thumbnail_url.trim() : "";
    if (!thumbnailUrl || epoch !== artworkEpoch) {
      return;
    }

    artworkByHref.set(href, thumbnailUrl);
    scheduleArtworkRender();
  } catch (error) {
    if (epoch === artworkEpoch) {
      failedArtworkHrefs.add(href);
    }
  }
}

function scheduleArtworkRender() {
  if (artworkRenderTimer) {
    return;
  }

  artworkRenderTimer = setTimeout(() => {
    artworkRenderTimer = 0;
    render();
  }, 80);
}

function scheduleInfoTooltipAlignment() {
  if (typeof window === "undefined") {
    return;
  }

  if (infoTooltipAlignmentFrame) {
    cancelAnimationFrame(infoTooltipAlignmentFrame);
  }

  infoTooltipAlignmentFrame = requestAnimationFrame(() => {
    infoTooltipAlignmentFrame = 0;
    refreshInfoTooltipAlignment();
  });
}

function refreshInfoTooltipAlignment() {
  if (typeof window === "undefined") {
    return;
  }

  const isCompactViewport = window.innerWidth <= 1024;
  const badges = document.querySelectorAll(".table-info-badge, .summary-info-badge");

  badges.forEach((badge) => {
    if (!(badge instanceof HTMLElement)) {
      return;
    }

    const tooltip = badge.querySelector(".table-info-tooltip");
    if (!(tooltip instanceof HTMLElement)) {
      return;
    }

    resetInfoTooltipAlignment(tooltip);

    if (!isCompactViewport) {
      return;
    }

    const tooltipWidth = tooltip.offsetWidth;
    if (!tooltipWidth) {
      return;
    }

    const viewportGutter = window.innerWidth <= 720 ? 14 : 18;
    const badgeRect = badge.getBoundingClientRect();
    const desiredLeft = badgeRect.left + (badgeRect.width / 2) - (tooltipWidth / 2);
    const maxLeft = Math.max(viewportGutter, window.innerWidth - viewportGutter - tooltipWidth);
    const clampedLeft = clampNumber(desiredLeft, viewportGutter, maxLeft);
    const tooltipLeftWithinBadge = clampedLeft - badgeRect.left;
    const arrowLeft = clampNumber((badgeRect.width / 2) + badgeRect.left - clampedLeft, 18, tooltipWidth - 18);

    tooltip.style.left = `${tooltipLeftWithinBadge}px`;
    tooltip.style.right = "auto";
    tooltip.style.setProperty("--tooltip-x-shift", "0px");
    tooltip.style.setProperty("--tooltip-arrow-left", `${arrowLeft}px`);
    tooltip.style.setProperty("--tooltip-arrow-shift", "0px");
  });
}

function resetInfoTooltipAlignment(tooltip) {
  tooltip.style.removeProperty("left");
  tooltip.style.removeProperty("right");
  tooltip.style.removeProperty("--tooltip-x-shift");
  tooltip.style.removeProperty("--tooltip-arrow-left");
  tooltip.style.removeProperty("--tooltip-arrow-shift");
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function renderLandingView() {
  return `
    <section class="landing-shell">
      <section class="hero-card upload-card">
        <p class="eyebrow">Spotify Streaming History Analysis</p>
        <h1>Upload your Spotify Streaming History ZIP</h1>
        <p class="hero-copy">
          Explore your Spotify music listening history in a fast, privacy-first browser dashboard.
          Your Spotify data stays in your browser and is not uploaded to a server.
          This site is independent and is not affiliated with, endorsed by, or sponsored by Spotify.
          Podcast and audiobook plays are excluded from these stats.
          Leave the dates blank to analyze your full listening history, or use the calendar inputs to focus on a specific period.
        </p>

        <div class="landing-link-row">
          <a href="./instructions.html" class="secondary-link">How to get your Spotify ZIP</a>
        </div>

        ${state.errorMessage ? `<div class="error-banner">${escapeHtml(state.errorMessage)}</div>` : ""}

        <form class="upload-form" data-upload-form>
          <div class="field">
            <span>Spotify data export</span>
            <label class="file-dropzone" data-file-dropzone>
              <input class="file-dropzone-input" type="file" name="spotify_zip" accept=".zip" ${state.isLoading ? "disabled" : ""} required>
              <span class="file-dropzone-title">Choose File or Drag And Drop</span>
              <span class="file-dropzone-copy">ZIP files only</span>
            </label>
          </div>

          <div class="date-range-grid">
            <label class="field">
              <span>Start date</span>
              <input type="date" name="start_date" id="start-date" ${state.isLoading ? "disabled" : ""}>
            </label>

            <label class="field">
              <span>End date</span>
              <input type="date" name="end_date" id="end-date" ${state.isLoading ? "disabled" : ""}>
            </label>
          </div>

          <p class="form-hint">Date filtering uses your browser's local timezone: <strong>${escapeHtml(state.timezoneLabel)}</strong>.</p>
          <button type="submit" class="primary-button" ${state.isLoading || !state.workerReady ? "disabled" : ""}>
            ${state.isLoading ? "Analyzing..." : "Analyze"}
          </button>
        </form>

        <div class="worker-note">
          <strong>Web Worker workflow:</strong> the ZIP is unpacked in a dedicated worker and the parsed listening history stays in this tab's memory.
        </div>

        ${state.isLoading ? `<div class="status-pill">${escapeHtml(state.loadingMessage || "Working...")}</div>` : ""}
      </section>
    </section>
  `;
}

function renderResultsView() {
  const analysis = state.analysis;

  return `
    <section class="hero-card results-hero">
      <div class="results-hero-top">
        <div>
          <p class="eyebrow">Spotify Streaming History Analysis</p>
          <h1>Your Spotify Stats</h1>
          <p class="hero-copy">
            Current range: <strong>${escapeHtml(analysis.analysisRange)}</strong>.
          </p>
          <p class="hero-copy">
          Parsed records stay inside this tab until you replace the ZIP or close it.
          </p>
          <p class="hero-meta">
            ${escapeHtml(analysis.topLimitSummary)}
          </p>
          ${state.isLoading ? `<div class="status-pill">${escapeHtml(state.loadingMessage || "Refreshing results")}</div>` : ""}
          ${state.errorMessage ? `<div class="error-banner">${escapeHtml(state.errorMessage)}</div>` : ""}
        </div>

        <div class="hero-actions">
          <div class="hero-action-row">
            <button
              type="button"
              class="secondary-link action-button ${state.panels.range ? "is-open" : ""}"
              data-toggle-panel="range"
              aria-expanded="${state.panels.range}"
              aria-controls="range-panel"
            >
              Select date range
            </button>
            <button
              type="button"
              class="secondary-link action-button ${state.panels.topLimit ? "is-open" : ""}"
              data-toggle-panel="topLimit"
              aria-expanded="${state.panels.topLimit}"
              aria-controls="top-limit-panel"
            >
              Top x in categories
            </button>
          </div>
          <div class="hero-action-row hero-action-row-secondary">
            <button type="button" class="secondary-link" data-clear-analysis>
              Upload another ZIP
            </button>
            ${analysis.hasResults ? `
              <button
                type="button"
                class="secondary-link action-button ${state.panels.jumpTo ? "is-open" : ""}"
                data-toggle-panel="jumpTo"
                aria-expanded="${state.panels.jumpTo}"
                aria-controls="jump-panel"
              >
                Jump to
              </button>
            ` : ""}
          </div>
        </div>
      </div>

      <div class="inline-control-panel" id="range-panel" ${state.panels.range ? "" : "hidden"}>
        <div class="range-panel-copy">
          <p class="mini-label">Refine Range</p>
          <p class="range-meta">
            Available history: <strong>${escapeHtml(analysis.availableDateRange)}</strong>
            ${analysis.rangeAnchorDate ? ` Last listening date is ${escapeHtml(analysis.rangeAnchorDate)}.` : ""}
          </p>
        </div>

        <form class="refine-form inline-refine-form" data-range-form>
          <div class="date-range-grid compact-date-grid">
            <label class="field compact-field">
              <span>Start date</span>
              <input
                type="date"
                name="start_date"
                id="results-start-date"
                value="${escapeAttribute(analysis.selectedStartDate)}"
                min="${escapeAttribute(analysis.dataMinDate)}"
                max="${escapeAttribute(analysis.dataMaxDate)}"
                data-min="${escapeAttribute(analysis.dataMinDate)}"
                data-max="${escapeAttribute(analysis.dataMaxDate)}"
                ${state.isLoading ? "disabled" : ""}
              >
            </label>

            <label class="field compact-field">
              <span>End date</span>
              <input
                type="date"
                name="end_date"
                id="results-end-date"
                value="${escapeAttribute(analysis.selectedEndDate)}"
                min="${escapeAttribute(analysis.dataMinDate)}"
                max="${escapeAttribute(analysis.dataMaxDate)}"
                data-min="${escapeAttribute(analysis.dataMinDate)}"
                data-max="${escapeAttribute(analysis.dataMaxDate)}"
                ${state.isLoading ? "disabled" : ""}
              >
            </label>
          </div>

          <div class="compact-template-group">
            <div class="template-heading">Quick ranges</div>
            <div class="template-grid">
              ${analysis.quickRangeTemplates.map(renderRangeTemplateButton).join("")}
            </div>
          </div>

          ${analysis.yearlyRangeTemplates.length ? `
            <div class="compact-template-group">
              <div class="template-heading">By year</div>
              <div class="template-grid year-grid">
                ${analysis.yearlyRangeTemplates.map((template) => renderRangeTemplateButton(template, "template-button template-button-year")).join("")}
              </div>
            </div>
          ` : ""}

          <button type="submit" class="primary-button compact-submit" ${state.isLoading ? "disabled" : ""}>
            Apply custom range
          </button>
        </form>
      </div>

      <div class="inline-control-panel" id="top-limit-panel" ${state.panels.topLimit ? "" : "hidden"}>
        <div class="range-panel-copy">
          <p class="mini-label">Top X In Categories</p>
          <p class="range-meta">
            ${escapeHtml(analysis.topLimitSummary)} Choose how many items should appear in every ranking list, including streaks.
          </p>
        </div>

        <div class="template-grid limit-grid">
          ${analysis.topLimitTemplates.map((template) => `
            <button
              type="button"
              class="template-button ${template.value === analysis.selectedTopLimit ? "is-active" : ""}"
              data-top-limit="${escapeAttribute(template.value)}"
              ${state.isLoading ? "disabled" : ""}
            >
              ${escapeHtml(template.label)}
            </button>
          `).join("")}
        </div>
      </div>

      ${analysis.hasResults ? `
        <div class="inline-control-panel" id="jump-panel" ${state.panels.jumpTo ? "" : "hidden"}>
          <div class="range-panel-copy">
            <p class="mini-label">Jump To</p>
            <p class="range-meta">
              Jump directly to any ranking table or the charts section.
            </p>
          </div>

          <div class="template-grid jump-grid">
            ${JUMP_TARGETS.map(renderJumpTargetButton).join("")}
          </div>
        </div>
      ` : ""}
    </section>

    ${analysis.hasResults ? `
      <section class="${buildRevealSectionClassName("summary-stats", "summary-stats-section")}" data-reveal-section="summary-stats-section">
        <h2>Your Listening Summary</h2>

        <div class="stats-grid">
          ${renderStatCard("Total Playtime", analysis.totalPlaytime, "across all tracks", SUMMARY_INFO_TEXT.totalPlaytime)}
          ${renderStatCard(
            "Total Play Count",
            analysis.totalPlayCount.toLocaleString(),
            `track plays (+${analysis.totalSkipCount.toLocaleString()} skips)`,
            SUMMARY_INFO_TEXT.totalPlayCount,
          )}
          ${renderStatCard("Unique Artists", analysis.uniqueArtists.toLocaleString(), "different artists", SUMMARY_INFO_TEXT.uniqueArtists)}
          ${renderStatCard("Unique Tracks", analysis.uniqueTracks.toLocaleString(), "different tracks", SUMMARY_INFO_TEXT.uniqueTracks)}
          ${renderStatCard("Unique Albums", analysis.uniqueAlbums.toLocaleString(), "different albums", SUMMARY_INFO_TEXT.uniqueAlbums)}
        </div>
      </section>

      ${renderTableSection("Top Songs By Playtime", ["Rank", "Song", "Playtime"], analysis.songsPT, renderSongRow, "", TABLE_INFO_TEXT.songsPT, "songs-playtime-section")}
      ${renderTableSection("Top Songs By Play Count", ["Rank", "Song", "Play Count"], analysis.songsTP, renderSongCountRow, "", TABLE_INFO_TEXT.songsTP, "songs-play-count-section")}
      ${renderTableSection("Top Artists By Playtime", ["Rank", "Artist", "Playtime"], analysis.artistsPT, renderArtistRow, "", TABLE_INFO_TEXT.artistsPT, "artists-playtime-section")}
      ${renderTableSection("Top Artists By Play Count", ["Rank", "Artist", "Play Count"], analysis.artistsTP, renderArtistCountRow, "", TABLE_INFO_TEXT.artistsTP, "artists-play-count-section")}
      ${renderTableSection("Top Albums", ["Rank", "Album", "Playtime"], analysis.albumsPT, renderAlbumRow, "", TABLE_INFO_TEXT.albumsPT, "albums-section")}

      ${renderChartsSection()}

      ${renderDailyInsightsCard(analysis.dailyListeningInsights)}

      ${renderTableSection(
        "Most Plays Of A Single Song In One Day",
        ["Rank", "Song", "Play Count", "Date"],
        analysis.songDailyPeaks,
        renderSongDailyPeakRow,
        "daily-peak-table",
        TABLE_INFO_TEXT.songDailyPeaks,
        "song-daily-peaks-section",
      )}

      ${renderTableSection(
        "Most Plays Of A Single Artist In One Day",
        ["Rank", "Artist", "Play Count", "Date"],
        analysis.artistDailyPeaks,
        renderArtistDailyPeakRow,
        "daily-peak-table",
        TABLE_INFO_TEXT.artistDailyPeaks,
        "artist-daily-peaks-section",
      )}

      ${renderTableSection(
        "Top Listening Streaks",
        ["Rank", "Playtime", "Start", "End"],
        analysis.listeningStreaks,
        renderListeningStreakRow,
        "streak-table",
        TABLE_INFO_TEXT.listeningStreaks,
        "listening-streaks-section",
      )}

      ${renderTableSection(
        "Top Artist Streaks",
        ["Rank", "Artist", "Play Count", "Unique Songs", "First Play", "Last Play"],
        analysis.artistStreaks,
        renderArtistStreakRow,
        "artist-streak-table",
        TABLE_INFO_TEXT.artistStreaks,
        "artist-streaks-section",
      )}

      <p class="spotify-attribution">
        Song and album artwork, when available, is loaded from Spotify preview metadata and links back to Spotify.
      </p>
    ` : `
      <section class="empty-state">
        <h2>No music listening data found for that range</h2>
        <p>Expand the date range or top-x panels to adjust the results without uploading the ZIP again. Podcast and audiobook plays are excluded.</p>
      </section>
    `}
  `;
}

function renderStatCard(label, value, subtext, infoText = "") {
  return `
    <div class="stat-card">
      <div class="stat-label-row">
        <div class="stat-label">${escapeHtml(label)}</div>
        ${infoText ? renderInfoBadge(label, infoText, "summary-info-badge") : ""}
      </div>
      <div class="stat-value">${escapeHtml(String(value))}</div>
      <div class="stat-subtext">${escapeHtml(subtext)}</div>
    </div>
  `;
}

function renderChartsSection() {
  const revealKey = "charts-section";

  return `
    <section class="${buildRevealSectionClassName("chart-section", revealKey)}" id="charts-section" data-reveal-section="${escapeAttribute(revealKey)}">
      <div class="chart-section-header">
        <h2>Charts</h2>
        <p class="chart-section-copy">
          Bars show total playtime for each time bucket. Tap or hover any bar to see both playtime and play count.
        </p>
      </div>

      <div class="chart-grid">
        ${renderChartCard("Playtime Per Year", "yearly")}
        ${renderChartCard("Playtime Per Month Of Year", "monthly")}
        ${renderChartCard("Playtime Per Day Of Week", "weekday")}
        ${renderChartCard("Playtime Per Hour Of Day", "hourly")}
      </div>
    </section>
  `;
}

function renderDailyInsightsCard(insights) {
  const revealKey = "daily-listening-section";
  const biggestDayCopy = insights?.biggestListeningDay
    ? `Your biggest listening day is ${insights.biggestListeningDay.date}. You listened for ${insights.biggestListeningDay.playtime} (${insights.biggestListeningDay.dayPercentage}% of the day), you played ${insights.biggestListeningDay.playCount} tracks and you heard ${insights.biggestListeningDay.uniqueArtists} artists.`
    : "We couldn't determine a biggest listening day for this range.";

  return `
    <section class="${buildRevealSectionClassName("daily-insights-card", revealKey)}" id="daily-listening-section" data-reveal-section="${escapeAttribute(revealKey)}">
      <h2>Daily Listening</h2>

      <div class="daily-insights-grid">
        <article class="daily-insight-item">
          <p class="daily-insight-label">Daily Playtime</p>
          <p class="daily-insight-copy">On average, you listen for ${escapeHtml(insights?.averagePlaytime || "0s")} per day. That's ${escapeHtml(insights?.averagePlaytimeDayPercentage || "0")}% of the day.</p>
        </article>

        <article class="daily-insight-item">
          <p class="daily-insight-label">Daily Play Count</p>
          <p class="daily-insight-copy">On average, you listen to ${escapeHtml(insights?.averagePlayCount || "0")} tracks per day.</p>
        </article>

        <article class="daily-insight-item">
          <p class="daily-insight-label">Biggest Listening Day</p>
          <p class="daily-insight-copy">${escapeHtml(biggestDayCopy)}</p>
        </article>
      </div>
    </section>
  `;
}

function renderTableSection(title, headers, items, rowRenderer, tableClass = "", infoText = "", sectionId = "") {
  const revealKey = sectionId || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const isCompactTable = !tableClass;
  const tableModeClass = isCompactTable ? "table--compact" : "table--scroll";
  const shellModeClass = isCompactTable ? "table-shell--compact" : "table-shell--scroll";

  return `
    <section class="table-section" ${sectionId ? `id="${escapeAttribute(sectionId)}"` : ""}>
      <div class="table-section-heading">
        <h2>${escapeHtml(title)}</h2>
        ${infoText ? renderTableInfoBadge(title, infoText) : ""}
      </div>
      <div class="${buildRevealSectionClassName(`table-shell ${shellModeClass}`, revealKey)}" data-reveal-section="${escapeAttribute(revealKey)}">
        ${isCompactTable ? "" : '<p class="table-scroll-hint">Swipe horizontally to see more columns.</p>'}
        <table class="${escapeAttribute([tableModeClass, tableClass].filter(Boolean).join(" "))}">
          <thead>
            <tr>${headers.map((header, index) => renderTableHeaderCell(header, index)).join("")}</tr>
          </thead>
          <tbody>
            ${items.map(rowRenderer).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderJumpTargetButton(target) {
  return `
    <button
      type="button"
      class="template-button jump-button"
      data-jump-target="${escapeAttribute(target.id)}"
    >
      ${escapeHtml(target.label)}
    </button>
  `;
}

function renderTableInfoBadge(title, infoText) {
  return renderInfoBadge(title, infoText, "table-info-badge");
}

function renderInfoBadge(label, infoText, className = "table-info-badge") {
  return `
    <span
      class="${escapeAttribute(className)}"
      tabindex="0"
      aria-label="${escapeAttribute(`${label}. ${infoText}`)}"
    >
      <span class="table-info-icon" aria-hidden="true">i</span>
      <span class="table-info-tooltip" aria-hidden="true">${escapeHtml(infoText)}</span>
    </span>
  `;
}

function renderSongRow(song) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(song.rank))}</td>
      <td data-label="Song">${renderLinkedLabel(song.uri, displayName(song.track), displayName(song.artist), `${displayName(song.track)} cover art`)}</td>
      <td data-label="Playtime">${escapeHtml(song.playtime)}</td>
    </tr>
  `;
}

function renderSongCountRow(song) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(song.rank))}</td>
      <td data-label="Song">${renderLinkedLabel(song.uri, displayName(song.track), displayName(song.artist), `${displayName(song.track)} cover art`)}</td>
      <td data-label="Play Count">${escapeHtml(song.times_played.toLocaleString())}</td>
    </tr>
  `;
}

function renderSongDailyPeakRow(song) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(song.rank))}</td>
      <td data-label="Song">${renderLinkedLabel(song.uri, displayName(song.track), displayName(song.artist), `${displayName(song.track)} cover art`)}</td>
      <td data-label="Play Count">${escapeHtml(song.times_played.toLocaleString())}</td>
      <td class="date-cell" data-label="Date">${escapeHtml(song.date)}</td>
    </tr>
  `;
}

function renderArtistRow(artist) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(artist.rank))}</td>
      <td data-label="Artist">${escapeHtml(displayName(artist.artist))}</td>
      <td data-label="Playtime">${escapeHtml(artist.playtime)}</td>
    </tr>
  `;
}

function renderArtistCountRow(artist) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(artist.rank))}</td>
      <td data-label="Artist">${escapeHtml(displayName(artist.artist))}</td>
      <td data-label="Play Count">${escapeHtml(artist.times_played.toLocaleString())}</td>
    </tr>
  `;
}

function renderArtistDailyPeakRow(artist) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(artist.rank))}</td>
      <td data-label="Artist">${escapeHtml(displayName(artist.artist))}</td>
      <td data-label="Play Count">${escapeHtml(artist.times_played.toLocaleString())}</td>
      <td class="date-cell" data-label="Date">${escapeHtml(artist.date)}</td>
    </tr>
  `;
}

function renderAlbumRow(album) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(album.rank))}</td>
      <td data-label="Album">${renderLinkedLabel(album.uri, displayName(album.album), displayName(album.artist), `${displayName(album.album)} cover art`)}</td>
      <td data-label="Playtime">${escapeHtml(album.playtime)}</td>
    </tr>
  `;
}

function renderListeningStreakRow(streak) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(streak.rank))}</td>
      <td data-label="Playtime">${escapeHtml(streak.playtime)}</td>
      <td class="datetime-cell" data-label="Start">${renderDateTimeValue(streak.start_datetime)}</td>
      <td class="datetime-cell" data-label="End">${renderDateTimeValue(streak.end_datetime)}</td>
    </tr>
  `;
}

function renderArtistStreakRow(streak) {
  return `
    <tr>
      <td class="rank" data-label="Rank">${escapeHtml(String(streak.rank))}</td>
      <td data-label="Artist">${escapeHtml(displayName(streak.artist))}</td>
      <td data-label="Play Count">${escapeHtml(streak.play_count.toLocaleString())}</td>
      <td data-label="Unique Songs">${escapeHtml(streak.unique_songs.toLocaleString())}</td>
      <td class="datetime-cell" data-label="First Play">${renderDateTimeValue(streak.first_play)}</td>
      <td class="datetime-cell" data-label="Last Play">${renderDateTimeValue(streak.last_play)}</td>
    </tr>
  `;
}

function renderLinkedLabel(uri, primaryLabel, secondaryLabel = "", artworkAlt = "Spotify artwork") {
  const stackedLabel = renderStackedLabel(primaryLabel, secondaryLabel);
  const artwork = renderArtworkThumbnail(uri, artworkAlt);
  const safeHref = safeSpotifyHref(uri);
  const content = `
    ${artwork}
    <span class="stacked-label">${stackedLabel}</span>
  `;

  if (!safeHref) {
    return `<span class="media-label">${content}</span>`;
  }

  return `<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noreferrer" class="song-link media-label">${content}</a>`;
}

function renderStackedLabel(primaryLabel, secondaryLabel) {
  return `
    <span class="stacked-label-primary">${escapeHtml(primaryLabel)}</span>
    ${secondaryLabel ? `<span class="stacked-label-secondary">${escapeHtml(secondaryLabel)}</span>` : ""}
  `;
}

function renderArtworkThumbnail(uri, altText) {
  const imageUrl = getArtworkUrl(uri);
  if (!imageUrl) {
    return `<span class="cover-art cover-art-placeholder" aria-hidden="true"></span>`;
  }

  return `
    <img
      src="${escapeAttribute(imageUrl)}"
      alt="${escapeAttribute(altText)}"
      class="cover-art"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
    >
  `;
}

function getArtworkUrl(uri) {
  const href = safeSpotifyHref(uri);
  return href ? artworkByHref.get(href) || "" : "";
}

function renderRangeTemplateButton(template, className = "template-button") {
  return `
    <button
      type="button"
      class="${className}"
      data-template-range="quick"
      data-start="${escapeAttribute(template.start)}"
      data-end="${escapeAttribute(template.end)}"
      ${state.isLoading ? "disabled" : ""}
    >
      ${escapeHtml(template.label)}
    </button>
  `;
}

function jumpToSection(sectionId) {
  if (!sectionId) {
    return;
  }

  state.panels.jumpTo = false;
  render();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });
}

function renderChartCard(title, chartKey, extraClass = "") {
  return `
    <article class="chart-card ${extraClass}">
      <h3>${escapeHtml(title)}</h3>
      <div class="chart-shell" data-chart-key="${escapeAttribute(chartKey)}"></div>
    </article>
  `;
}

function validateDateRange(startDate, endDate) {
  const normalizedStartDate = parseDateInput(startDate);
  const normalizedEndDate = parseDateInput(endDate);

  if (startDate && !normalizedStartDate) {
    return { errorMessage: "Please provide a valid start date.", startDate: "", endDate: "" };
  }

  if (endDate && !normalizedEndDate) {
    return { errorMessage: "Please provide a valid end date.", startDate: "", endDate: "" };
  }

  if (normalizedStartDate && normalizedEndDate && normalizedStartDate > normalizedEndDate) {
    return { errorMessage: "Start date must be before end date.", startDate: normalizedStartDate, endDate: normalizedEndDate };
  }

  return { errorMessage: "", startDate: normalizedStartDate, endDate: normalizedEndDate };
}

function syncDateBounds(startFieldId, endFieldId) {
  const startField = document.getElementById(startFieldId);
  const endField = document.getElementById(endFieldId);
  if (!(startField instanceof HTMLInputElement) || !(endField instanceof HTMLInputElement)) {
    return;
  }

  const fallbackMin = endField.dataset.min || endField.getAttribute("min") || "";
  const fallbackMax = startField.dataset.max || startField.getAttribute("max") || "";

  endField.min = startField.value || fallbackMin;
  startField.max = endField.value || fallbackMax;

  if (startField.value && endField.value && endField.value < startField.value) {
    endField.value = startField.value;
  }

  if (startField.value && endField.value && startField.value > endField.value) {
    startField.value = endField.value;
  }
}

function displayName(value) {
  return value == null || value === "" ? "Unknown" : String(value);
}

function safeSpotifyHref(uri) {
  if (typeof uri !== "string") {
    return "";
  }

  const trimmedUri = uri.trim();
  if (!trimmedUri) {
    return "";
  }

  if (trimmedUri.startsWith("spotify:")) {
    const [, type, id] = trimmedUri.split(":");
    if (!type || !id || !["track", "album", "artist"].includes(type)) {
      return "";
    }

  return `https://open.spotify.com/${type}/${encodeURIComponent(id)}`;
  }

  if (trimmedUri.startsWith("https://open.spotify.com/")) {
    try {
      const parsed = new URL(trimmedUri);
      if (parsed.origin !== "https://open.spotify.com") {
        return "";
      }

      return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    } catch (error) {
      return "";
    }
  }

  return "";
}

function renderTableHeaderCell(header, index) {
  const classNames = [];
  if (index === 0 && String(header || "").trim().toLowerCase() === "rank") {
    classNames.push("table-heading-rank");
  }

  return `<th${classNames.length ? ` class="${escapeAttribute(classNames.join(" "))}"` : ""}>${escapeHtml(header)}</th>`;
}

function renderDateTimeValue(value) {
  const [datePart, timePart] = splitDateTimeValue(value);
  if (!timePart) {
    return escapeHtml(datePart);
  }

  return `
    <span class="datetime-value">
      <span class="datetime-date">${escapeHtml(datePart)}</span><span class="datetime-separator">, </span><span class="datetime-time">${escapeHtml(timePart)}</span>
    </span>
  `;
}

function splitDateTimeValue(value) {
  const trimmedValue = String(value || "").trim();
  if (!trimmedValue) {
    return ["", ""];
  }

  const separatorIndex = trimmedValue.lastIndexOf(", ");
  if (separatorIndex < 0) {
    return [trimmedValue, ""];
  }

  return [
    trimmedValue.slice(0, separatorIndex),
    trimmedValue.slice(separatorIndex + 2),
  ];
}

function nextRequestId() {
  state.activeRequestId += 1;
  return state.activeRequestId;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value || "");
}
