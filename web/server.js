const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

const port = Number(process.env.PORT || 4280);
const host = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "events.json");
const apiToken = process.env.CHAIRTIME_API_TOKEN || "";

let appState = {
  chairStatus: {
    sitting: false,
    updatedAt: null,
    source: "startup"
  },
  sessions: []
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

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

function getClosedOrOpenSessions(now) {
  return appState.sessions
    .filter((session) => session.startedAt)
    .map((session) => ({
      ...session,
      endedAt: session.endedAt || now.toISOString()
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

  const currentSession = appState.sessions.find((session) => !session.endedAt);
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
  const now = new Date().toISOString();
  const wasSitting = appState.chairStatus.sitting;

  if (sitting && !wasSitting) {
    appState.sessions.push({
      startedAt: now,
      endedAt: null,
      source
    });
  }

  if (!sitting && wasSitting) {
    const openSession = [...appState.sessions]
      .reverse()
      .find((session) => !session.endedAt);

    if (openSession) {
      openSession.endedAt = now;
    }
  }

  appState.chairStatus = {
    sitting,
    updatedAt: now,
    source
  };
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/status") {
    sendJson(res, 200, appState.chairStatus);
    return true;
  }

  if (req.method === "GET" && req.url === "/api/stats") {
    sendJson(res, 200, getStats());
    return true;
  }

  if (req.method === "POST" && req.url === "/api/status") {
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

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const decodedPath = decodeURIComponent(rawPath);
  const filePath = path.normalize(path.join(publicDir, decodedPath));

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
  if (await handleApi(req, res)) {
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await serveStatic(req, res);
});

loadState().then(() => {
  server.listen(port, host, () => {
    console.log(`Chair Time running at http://${host}:${port}`);
  });
});
