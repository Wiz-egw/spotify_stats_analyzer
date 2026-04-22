import { buildAnalysisContext, normalizeStreamingRecord } from "./analysis.js";

const STREAMING_HISTORY_PATTERN = /^Spotify Extended Streaming History\/Streaming_History_Audio.*\.json$/;

let streamingData = null;

self.postMessage({ type: "ready" });

self.addEventListener("message", async (event) => {
  const { type, payload, requestId } = event.data || {};

  try {
    if (type === "parse-upload") {
      postStatus(requestId, "Reading Spotify ZIP");
      streamingData = await extractStreamingDataFromZip(payload.buffer);
      postStatus(requestId, "Calculating stats");
      postAnalysis(requestId, payload);
      return;
    }

    if (type === "reanalyze") {
      if (!streamingData) {
        throw new Error("No Spotify history is loaded in this tab. Upload the ZIP again.");
      }

      postStatus(requestId, "Refreshing results");
      postAnalysis(requestId, payload);
      return;
    }

    if (type === "clear-data") {
      streamingData = null;
      self.postMessage({ type: "cleared", requestId });
      return;
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      payload: {
        message: error instanceof Error ? error.message : "Something went wrong while processing the Spotify ZIP.",
      },
    });
  }
});

function postAnalysis(requestId, payload) {
  const analysis = buildAnalysisContext({
    allData: streamingData || [],
    startDate: payload.startDate,
    endDate: payload.endDate,
    topLimitValue: payload.topLimit,
    timezoneLabel: payload.timezoneLabel,
  });

  self.postMessage({
    type: "analysis",
    requestId,
    payload: analysis,
  });
}

function postStatus(requestId, message) {
  self.postMessage({
    type: "status",
    requestId,
    payload: { message },
  });
}

async function extractStreamingDataFromZip(buffer) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot unpack Spotify ZIP files here yet. Try a newer Chromium-based browser.");
  }

  const bytes = new Uint8Array(buffer);
  const entries = parseCentralDirectory(bytes);
  const matchingEntries = entries.filter((entry) => STREAMING_HISTORY_PATTERN.test(entry.filename));

  if (!matchingEntries.length) {
    throw new Error("We couldn't find Spotify streaming history files in that ZIP.");
  }

  const decoder = new TextDecoder("utf-8");
  const combined = [];

  for (const entry of matchingEntries) {
    const entryBytes = await readZipEntry(bytes, entry);
    let parsed;

    try {
      parsed = JSON.parse(decoder.decode(entryBytes));
    } catch (error) {
      throw new Error("We couldn't read that ZIP file. Please export your Spotify data again.");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Spotify streaming history files were not in the expected format.");
    }

    for (const item of parsed) {
      combined.push(normalizeStreamingRecord(item));
    }
  }

  return combined;
}

function parseCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes, view);

  if (eocdOffset < 0) {
    throw new Error("That file does not look like a valid ZIP archive.");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = [];

  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("The ZIP central directory could not be read.");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const filename = decodeFileName(bytes.subarray(offset + 46, offset + 46 + fileNameLength));

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(bytes, view) {
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}

async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localHeaderOffset = entry.localHeaderOffset;
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error("A ZIP entry header was invalid.");
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = bytes.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedData;
  }

  if (entry.compressionMethod === 8) {
    return inflateRaw(compressedData);
  }

  throw new Error(`ZIP compression method ${entry.compressionMethod} is not supported in this browser build.`);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function decodeFileName(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}
