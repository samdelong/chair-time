const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const port = Number(process.env.PORT || 4280);
const host = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "events.json");
const apiToken = process.env.CHAIRTIME_API_TOKEN || "";
const basePath = normalizeBasePath(process.env.CHAIRTIME_BASE_PATH || "");
const adjustmentThresholdMs = 5000;
const heartbeatTimeoutMs = 30000;

let appState = {
  chairStatus: {
    sitting: false,
    updatedAt: null,
    source: "startup"
  },
  lastHeartbeatAt: null,
  pendingStandUpAt: null,
  sessions: []
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function normalizeBasePath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function getRequestContext(req) {
  const url = new URL(req.url, "http://chairtime.local");
  const pathname = decodeURIComponent(url.pathname);

  if (!basePath) {
    return {
      pathname,
      search: url.search,
      routePath: pathname,
      inBasePath: true,
      needsSlashRedirect: false
    };
  }

  if (pathname === "/") {
    return {
      pathname,
      search: url.search,
      routePath: "/",
      inBasePath: true,
      needsBaseRedirect: true,
      needsSlashRedirect: false
    };
  }

  if (pathname === "/health" || pathname.startsWith("/api/")) {
    return {
      pathname,
      search: url.search,
      routePath: pathname,
      inBasePath: true,
      needsBaseRedirect: false,
      needsSlashRedirect: false
    };
  }

  if (pathname === basePath) {
    return {
      pathname,
      search: url.search,
      routePath: "/",
      inBasePath: true,
      needsBaseRedirect: false,
      needsSlashRedirect: true
    };
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return {
      pathname,
      search: url.search,
      routePath: pathname.slice(basePath.length) || "/",
      inBasePath: true,
      needsBaseRedirect: false,
      needsSlashRedirect: false
    };
  }

  return {
    pathname,
    search: url.search,
    routePath: pathname,
    inBasePath: false,
    needsBaseRedirect: false,
    needsSlashRedirect: false
  };
}

function sendRedirect(res, location) {
  res.writeHead(308, {
    Location: location
  });
  res.end();
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function defaultState() {
  return {
    chairStatus: {
      sitting: false,
      updatedAt: null,
      source: "startup"
    },
    lastHeartbeatAt: null,
    pendingStandUpAt: null,
    sessions: []
  };
}

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(dataFile, "utf8"));
    appState = {
      ...defaultState(),
      ...saved,
      chairStatus: {
        ...defaultState().chairStatus,
        ...(saved.chairStatus || {})
      },
      lastHeartbeatAt: saved.lastHeartbeatAt || null,
      pendingStandUpAt: saved.pendingStandUpAt || null,
      sessions: Array.isArray(saved.sessions) ? saved.sessions : []
    };
  } catch (error) {
    appState = defaultState();
  }
}

async function saveState() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(appState, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function isAuthorized(req) {
  if (!apiToken) {
    return true;
  }

  const header = req.headers.authorization || "";
  return header === `Bearer ${apiToken}`;
}

function parseSitting(payload) {
  if (typeof payload.sitting === "boolean") {
    return payload.sitting;
  }

  if (payload.event === "sat_down") {
    return true;
  }

  if (payload.event === "stood_up") {
    return false;
  }

  return null;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function formatShortDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function addIntervalToDailyTotals(totals, startValue, endValue) {
  let cursor = new Date(startValue);
  const end = new Date(endValue);

  while (cursor < end) {
    const boundary = nextLocalDay(cursor);
    const segmentEnd = boundary < end ? boundary : end;
    const key = localDateKey(cursor);
    const seconds = Math.max(0, (segmentEnd.getTime() - cursor.getTime()) / 1000);

    totals.set(key, (totals.get(key) || 0) + seconds);
    cursor = segmentEnd;
  }
}

function getOpenSession() {
  return [...appState.sessions]
    .reverse()
    .find((session) => !session.endedAt);
}

function isPendingStandUpExpired(now) {
  if (!appState.pendingStandUpAt) {
    return false;
  }

  const pendingStandUpTime = new Date(appState.pendingStandUpAt).getTime();
  return Number.isFinite(pendingStandUpTime) &&
    now.getTime() - pendingStandUpTime >= adjustmentThresholdMs;
}

function finalizeExpiredPendingStandUp(now) {
  if (!isPendingStandUpExpired(now)) {
    return;
  }

  const openSession = getOpenSession();
  if (openSession) {
    openSession.endedAt = appState.pendingStandUpAt;
  }

  appState.pendingStandUpAt = null;
}

function getLastSignalAt() {
  return appState.lastHeartbeatAt || appState.chairStatus.updatedAt;
}

function getSensorStaleCutoff(now) {
  const lastSignalAt = getLastSignalAt();
  if (!lastSignalAt) {
    return null;
  }

  const lastSignalTime = new Date(lastSignalAt).getTime();
  if (!Number.isFinite(lastSignalTime)) {
    return null;
  }

  if (now.getTime() - lastSignalTime < heartbeatTimeoutMs) {
    return null;
  }

  return new Date(lastSignalTime + heartbeatTimeoutMs).toISOString();
}

function getSensorStatus(now) {
  const lastSeenAt = getLastSignalAt();
  const staleCutoff = getSensorStaleCutoff(now);

  return {
    lastSeenAt,
    heartbeatTimeoutSeconds: heartbeatTimeoutMs / 1000,
    stale: Boolean(staleCutoff),
    staleSince: staleCutoff
  };
}

function finalizeExpiredSensor(now) {
  const staleCutoff = getSensorStaleCutoff(now);
  if (!staleCutoff) {
    return;
  }

  const openSession = getOpenSession();
  if (openSession) {
    openSession.endedAt = staleCutoff;
  }

  appState.pendingStandUpAt = null;
}

function getClosedOrOpenSessions(now) {
  const pendingStandUpExpired = isPendingStandUpExpired(now);
  const staleCutoff = getSensorStaleCutoff(now);

  return appState.sessions
    .filter((session) => session.startedAt)
    .map((session) => ({
      ...session,
      endedAt: session.endedAt ||
        staleCutoff ||
        (pendingStandUpExpired ? appState.pendingStandUpAt : now.toISOString())
    }));
}

function getStats() {
  const now = new Date();
  const totals = new Map();
  const sessions = getClosedOrOpenSessions(now);

  for (const session of sessions) {
    addIntervalToDailyTotals(totals, session.startedAt, session.endedAt);
  }

  const todayKey = localDateKey(now);
  const days = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const date = localDateKey(day);
    const seconds = Math.round(totals.get(date) || 0);

    days.push({
      date,
      label: formatShortDate(date),
      seconds,
      hours: seconds / 3600
    });
  }

  const sensor = getSensorStatus(now);
  const currentSession = sensor.stale || isPendingStandUpExpired(now) ? null : getOpenSession();
  const currentSessionSeconds = currentSession
    ? Math.round((now.getTime() - new Date(currentSession.startedAt).getTime()) / 1000)
    : 0;
  const todayStart = startOfLocalDay(now);
  const todaySessionCount = appState.sessions.filter((session) => {
    const startedAt = new Date(session.startedAt);
    return startedAt >= todayStart && localDateKey(startedAt) === todayKey;
  }).length;
  const longestSessionSeconds = sessions.reduce((longest, session) => {
    const seconds = Math.max(
      0,
      (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000
    );
    return Math.max(longest, Math.round(seconds));
  }, 0);
  const weekSeconds = days.reduce((total, day) => total + day.seconds, 0);

  return {
    status: appState.chairStatus,
    sensor,
    generatedAt: now.toISOString(),
    todaySeconds: Math.round(totals.get(todayKey) || 0),
    currentSessionSeconds,
    todaySessionCount,
    longestSessionSeconds,
    weekSeconds,
    averageDailySeconds: Math.round(weekSeconds / 7),
    days
  };
}

function updateChairStatus(sitting, source) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const wasSitting = appState.chairStatus.sitting;

  finalizeExpiredSensor(nowDate);
  finalizeExpiredPendingStandUp(nowDate);

  appState.lastHeartbeatAt = now;

  if (sitting) {
    appState.pendingStandUpAt = null;
  }

  if (sitting && !getOpenSession()) {
    appState.sessions.push({
      startedAt: now,
      endedAt: null,
      source
    });
  }

  if (!sitting && wasSitting) {
    appState.pendingStandUpAt = now;
  }

  appState.chairStatus = {
    sitting,
    updatedAt: now,
    source
  };
}

async function handleApi(req, res, routePath) {
  if (req.method === "GET" && routePath === "/api/status") {
    sendJson(res, 200, {
      ...appState.chairStatus,
      sensor: getSensorStatus(new Date())
    });
    return true;
  }

  if (req.method === "GET" && routePath === "/api/stats") {
    sendJson(res, 200, getStats());
    return true;
  }

  if (req.method === "POST" && routePath === "/api/status") {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return true;
    }

    try {
      const body = await readBody(req);
      const payload = body ? JSON.parse(body) : {};
      const sitting = parseSitting(payload);

      if (sitting === null) {
        sendJson(res, 400, {
          error: "Expected { \"sitting\": true } or event \"sat_down\" / \"stood_up\""
        });
        return true;
      }

      updateChairStatus(sitting, payload.source || "api");
      await saveState();

      sendJson(res, 200, {
        ...appState.chairStatus,
        stats: getStats()
      });
    } catch (error) {
      sendJson(res, 400, { error: "Invalid JSON body" });
    }

    return true;
  }

  if (req.method === "GET" && routePath === "/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(routePath, res) {
  const rawPath = routePath === "/" ? "/index.html" : routePath;
  const filePath = path.normalize(path.join(publicDir, rawPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(file);
  } catch (error) {
    const fallback = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  const context = getRequestContext(req);

  if (context.needsBaseRedirect) {
    sendRedirect(res, `${basePath}/${context.search}`);
    return;
  }

  if (context.needsSlashRedirect) {
    sendRedirect(res, `${basePath}/${context.search}`);
    return;
  }

  if (!context.inBasePath) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (await handleApi(req, res, context.routePath)) {
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(context.routePath, res);
});

loadState().then(() => {
  server.listen(port, host, () => {
    console.log(`Chair Time running at http://${host}:${port}`);
  });
});
