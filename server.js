const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const IMAGES_DIR = path.join(ROOT, "images");
const DATA_DIR = path.join(ROOT, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const PORT = 3000;
const MAX_MEDIA_ID = 1000;
const FIREBASE_DB_URL = "https://disk-c98ee-default-rtdb.firebaseio.com";
const FIREBASE_STATE_KEY = "mediaVault/state";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogg"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogg": "video/ogg",
};

ensureStateFile();

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ folders: [], mediaIndex: {} }, null, 2), "utf8");
  }
}

function firebaseRequest(method, stateKey, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/${stateKey}.json`, FIREBASE_DB_URL);
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = https.request(url, {
      method,
      headers: body
        ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        }
        : undefined,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`firebase_${method.toLowerCase()}_failed:${res.statusCode}:${raw}`));
          return;
        }

        if (!raw) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function normalizeUrlPath(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const cleaned = decoded.replace(/\\/g, "/");
  const normalized = path.posix.normalize(cleaned);
  if (!normalized.startsWith("/")) return `/${normalized}`;
  return normalized;
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function walkMediaFiles(dir, base = "") {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      items.push(...await walkMediaFiles(fullPath, relativePath));
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isVideo = VIDEO_EXTENSIONS.has(ext);
    if (!isImage && !isVideo) continue;

    const stats = await fs.promises.stat(fullPath);
    items.push({
      name: entry.name,
      relativePath: normalizeRelativePath(relativePath),
      url: `/images/${normalizeRelativePath(relativePath)}`,
      size: stats.size,
      kind: isImage ? "image" : "video",
    });
  }

  return items.sort((a, b) => b.size - a.size || a.relativePath.localeCompare(b.relativePath, "ru"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  res.end(JSON.stringify(payload));
}

function readLocalState() {
  ensureStateFile();
  const rawState = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return {
    folders: sanitizeFolders(rawState.folders),
    mediaIndex: sanitizeMediaIndex(rawState.mediaIndex),
  };
}

function writeLocalState(nextState) {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
}

async function readState() {
  try {
    const remoteState = await firebaseRequest("GET", FIREBASE_STATE_KEY);
    const sanitizedRemote = {
      folders: sanitizeFolders(remoteState?.folders),
      mediaIndex: sanitizeMediaIndex(remoteState?.mediaIndex),
    };
    const hasRemoteData = sanitizedRemote.folders.length > 0 || Object.keys(sanitizedRemote.mediaIndex).length > 0;
    if (hasRemoteData) {
      writeLocalState(sanitizedRemote);
      return sanitizedRemote;
    }

    const localState = readLocalState();
    const hasLocalData = localState.folders.length > 0 || Object.keys(localState.mediaIndex).length > 0;
    if (hasLocalData) {
      await writeState(localState);
      return localState;
    }

    writeLocalState(sanitizedRemote);
    return sanitizedRemote;
  } catch (error) {
    console.warn("Firebase read failed, using local cache:", error.message);
    return readLocalState();
  }
}

async function writeState(nextState) {
  const sanitized = {
    folders: sanitizeFolders(nextState.folders),
    mediaIndex: sanitizeMediaIndex(nextState.mediaIndex),
  };

  writeLocalState(sanitized);

  try {
    await firebaseRequest("PUT", FIREBASE_STATE_KEY, sanitized);
  } catch (error) {
    console.warn("Firebase write failed, local cache updated only:", error.message);
  }
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const range = req.headers.range;

    if (range) {
      const [startPart, endPart] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startPart, 10);
      const end = endPart ? parseInt(endPart, 10) : stat.size - 1;
      res.writeHead(206, {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function parseMediaId(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_MEDIA_ID) return null;
  return parsed;
}

function getExplicitMediaId(relativePath) {
  const baseName = path.basename(relativePath, path.extname(relativePath)).trim();
  if (!/^\d{1,4}$/.test(baseName)) return null;
  return parseMediaId(baseName);
}

function sanitizeMediaIndex(input) {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input)
    .map(([key, value]) => {
      const id = parseMediaId(key);
      if (id === null || typeof value !== "string") return null;
      const relativePath = normalizeRelativePath(value.trim());
      if (!relativePath) return null;
      return [String(id), relativePath];
    })
    .filter(Boolean)
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  return Object.fromEntries(entries);
}

function sanitizeFolders(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string")
    .map((folder) => ({
      id: folder.id.trim(),
      name: folder.name.trim(),
      itemIds: Array.isArray(folder.itemIds)
        ? folder.itemIds
          .map(parseMediaId)
          .filter((itemId) => itemId !== null)
        : [],
    }))
    .filter((folder) => folder.id && folder.name);
}

function findFreeMediaId(usedIds) {
  for (let id = 1; id <= MAX_MEDIA_ID; id += 1) {
    if (!usedIds.has(id)) return id;
  }
  return null;
}

async function collectMediaWithIds() {
  const state = await readState();
  const scannedItems = fs.existsSync(IMAGES_DIR) ? await walkMediaFiles(IMAGES_DIR) : [];
  const scannedPaths = new Set(scannedItems.map((item) => item.relativePath));
  const existingIndex = sanitizeMediaIndex(state.mediaIndex);
  const pathToId = new Map();
  const usedIds = new Set();

  const reservedPaths = new Set();

  for (const item of scannedItems) {
    const explicitId = getExplicitMediaId(item.relativePath);
    if (explicitId === null || usedIds.has(explicitId)) continue;
    pathToId.set(item.relativePath, explicitId);
    usedIds.add(explicitId);
    reservedPaths.add(item.relativePath);
  }

  for (const [idKey, relativePath] of Object.entries(existingIndex)) {
    const id = Number(idKey);
    if (!scannedPaths.has(relativePath) || usedIds.has(id) || reservedPaths.has(relativePath)) continue;
    pathToId.set(relativePath, id);
    usedIds.add(id);
  }

  for (const item of scannedItems) {
    if (pathToId.has(item.relativePath)) continue;
    const nextId = findFreeMediaId(usedIds);
    if (nextId === null) {
      throw new Error(`No free media ids left in range 1..${MAX_MEDIA_ID}`);
    }
    pathToId.set(item.relativePath, nextId);
    usedIds.add(nextId);
  }

  const mediaIndex = Object.fromEntries(
    Array.from(pathToId.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([relativePath, id]) => [String(id), relativePath])
  );

  const validIds = new Set(Array.from(pathToId.values()));
  const folders = sanitizeFolders(state.folders).map((folder) => ({
    ...folder,
    itemIds: folder.itemIds.filter((itemId) => validIds.has(itemId)),
  }));

  const nextState = { folders, mediaIndex };
  if (JSON.stringify(nextState) !== JSON.stringify(state)) {
    await writeState(nextState);
  }

  const items = scannedItems.map((item) => ({
    id: pathToId.get(item.relativePath),
    ...item,
  }));

  return { items, state: nextState };
}

const server = http.createServer(async (req, res) => {
  const pathname = normalizeUrlPath(req.url);

  if (req.method === "GET" && pathname === "/api/media") {
    try {
      const { items } = await collectMediaWithIds();
      sendJson(res, 200, { items });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "failed_to_collect_media" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    try {
      const { state } = await collectMediaWithIds();
      sendJson(res, 200, state);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "failed_to_read_state" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/state") {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw || "{}");
      const currentState = await readState();
      const nextState = {
        folders: sanitizeFolders(payload.folders),
        mediaIndex: currentState.mediaIndex,
      };
      await writeState(nextState);
      sendJson(res, 200, nextState);
    } catch (error) {
      console.error(error);
      sendJson(res, 400, { error: "failed_to_save_state" });
    }
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    serveFile(req, res, path.join(ROOT, "index.html"));
    return;
  }

  if (pathname.startsWith("/images/")) {
    const relativeMediaPath = pathname.slice("/images/".length);
    const target = path.join(IMAGES_DIR, relativeMediaPath);
    if (!target.startsWith(IMAGES_DIR)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    serveFile(req, res, target);
    return;
  }

  const localTarget = path.join(ROOT, pathname.slice(1));
  if (localTarget.startsWith(ROOT) && fs.existsSync(localTarget)) {
    serveFile(req, res, localTarget);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Media Vault running at http://localhost:${PORT}`);
});
