const headline = document.querySelector("#headline");
const subline = document.querySelector("#subline");
const todayHours = document.querySelector("#todayHours");
const todayTransitions = document.querySelector("#todayTransitions");
const averageHours = document.querySelector("#averageHours");
const longestSession = document.querySelector("#longestSession");
const weekTotal = document.querySelector("#weekTotal");
const weekBars = document.querySelector("#weekBars");
const params = new URLSearchParams(window.location.search);
const isWidget = params.get("widget") === "true";
const basePath = getBasePath();

function normalizeBasePath(value) {
  if (!value || value === "__BASE_PATH__" || value === "/") {
    return "";
  }

  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function getBasePath() {
  const configuredBasePath = normalizeBasePath(window.CHAIRTIME_BASE_PATH);
  if (configuredBasePath) {
    return configuredBasePath;
  }

  const script = document.currentScript;
  if (!script || !script.src) {
    return "";
  }

  const scriptPath = new URL(script.src, window.location.href).pathname;
  return normalizeBasePath(scriptPath.replace(/\/app\.js$/, ""));
}

document.body.classList.toggle("is-widget", isWidget);

if (isWidget) {
  document.title = "Chair Time Widget";
}

function relativeTime(value, label = "Updated") {
  if (!value) {
    return "Last signal pending";
  }

  const updated = new Date(value).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - updated) / 1000));

  if (seconds < 5) {
    return `${label} just now`;
  }

  if (seconds < 60) {
    return `${label} ${seconds} seconds ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes === 1) {
    return `${label} 1 minute ago`;
  }

  return `${label} ${minutes} minutes ago`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 60) {
    return "0m";
  }

  const roundedMinutes = Math.round(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

function formatSittingLine(seconds) {
  if (!seconds || seconds < 60) {
    return "Sitting for less than 1 minute";
  }

  const minutes = Math.round(seconds / 60);
  if (minutes === 1) {
    return "Sitting for 1 minute";
  }

  return `Sitting for ${minutes} minutes`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function formatShortDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(year, month - 1, day));
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

function getEffectiveSessionEnd(session, stats, now) {
  if (session.endedAt) {
    return session.endedAt;
  }

  if (stats.sensor && stats.sensor.staleSince) {
    return stats.sensor.staleSince;
  }

  if (stats.pendingStandUpAt) {
    const pendingStandUpTime = new Date(stats.pendingStandUpAt).getTime();
    const thresholdMs = (stats.adjustmentThresholdSeconds || 5) * 1000;

    if (Number.isFinite(pendingStandUpTime) && now.getTime() - pendingStandUpTime >= thresholdMs) {
      return stats.pendingStandUpAt;
    }
  }

  return now.toISOString();
}

function withLocalDisplayStats(stats) {
  if (!Array.isArray(stats.sessions)) {
    return stats;
  }

  const now = new Date(stats.generatedAt || Date.now());
  const totals = new Map();
  const sessions = stats.sessions.filter((session) => session.startedAt);

  for (const session of sessions) {
    addIntervalToDailyTotals(totals, session.startedAt, getEffectiveSessionEnd(session, stats, now));
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

  const todaySitDownCount = sessions.filter((session) => {
    return localDateKey(new Date(session.startedAt)) === todayKey;
  }).length;
  const todayStandUpCount = sessions.filter((session) => {
    return session.endedAt && localDateKey(new Date(session.endedAt)) === todayKey;
  }).length + (
    stats.pendingStandUpAt &&
    localDateKey(new Date(stats.pendingStandUpAt)) === todayKey &&
    getEffectiveSessionEnd({ startedAt: stats.pendingStandUpAt }, stats, now) === stats.pendingStandUpAt
      ? 1
      : 0
  );
  const weekSeconds = days.reduce((total, day) => total + day.seconds, 0);

  return {
    ...stats,
    todaySeconds: Math.round(totals.get(todayKey) || 0),
    todaySessionCount: todaySitDownCount,
    todaySitDownCount,
    todayStandUpCount,
    weekSeconds,
    averageDailySeconds: Math.round(weekSeconds / 7),
    days
  };
}

function render(status, stats) {
  const sensorStale = Boolean(stats.sensor && stats.sensor.stale);

  document.body.classList.toggle("is-stale", sensorStale);
  document.body.classList.toggle("is-sitting", status.sitting && !sensorStale);
  document.body.classList.toggle("is-away", !status.sitting && !sensorStale);

  if (sensorStale) {
    headline.textContent = "Chair signal disconnected.";
    subline.textContent = relativeTime(stats.sensor.lastSeenAt, "Last heartbeat");
    return;
  }

  headline.textContent = status.sitting
    ? "Sam is in his chair!"
    : "Sam is not in his chair.";
  subline.textContent = status.sitting
    ? formatSittingLine(stats.currentSessionSeconds)
    : relativeTime(status.updatedAt);
}

function renderStats(stats) {
  const maxSeconds = Math.max(3600, ...stats.days.map((day) => day.seconds));

  todayHours.textContent = formatDuration(stats.todaySeconds);
  todayTransitions.textContent = `${stats.todaySitDownCount || 0} / ${stats.todayStandUpCount || 0}`;
  averageHours.textContent = formatDuration(stats.averageDailySeconds);
  longestSession.textContent = formatDuration(stats.longestSessionSeconds);
  weekTotal.textContent = `${formatDuration(stats.weekSeconds)} total`;

  if (isWidget) {
    renderWidgetChart(stats, maxSeconds);
    return;
  }

  weekBars.replaceChildren(
    ...stats.days.map((day) => {
      const item = document.createElement("div");
      const bar = document.createElement("span");
      const label = document.createElement("small");
      const value = document.createElement("strong");

      item.className = "bar";
      bar.style.height = `${Math.max(4, (day.seconds / maxSeconds) * 100)}%`;
      label.textContent = day.label;
      value.textContent = formatDuration(day.seconds);

      item.append(bar, label, value);
      return item;
    })
  );
}

function renderWidgetChart(stats, maxSeconds) {
  const svgNamespace = "http://www.w3.org/2000/svg";
  const width = 100;
  const height = 44;
  const padding = 4;
  const chartHeight = height - padding * 2;
  const step = (width - padding * 2) / Math.max(1, stats.days.length - 1);
  const points = stats.days.map((day, index) => {
    const x = padding + index * step;
    const y = height - padding - (day.seconds / maxSeconds) * chartHeight;
    return { x, y, day };
  });
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const svg = document.createElementNS(svgNamespace, "svg");
  const title = document.createElementNS(svgNamespace, "title");
  const linePath = document.createElementNS(svgNamespace, "path");
  const labelRow = document.createElement("div");

  svg.setAttribute("class", "widget-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  title.textContent = "Sitting time over the last seven days";

  linePath.setAttribute("class", "widget-chart-line");
  linePath.setAttribute("d", line);
  linePath.setAttribute("vector-effect", "non-scaling-stroke");

  svg.append(title, linePath);

  labelRow.className = "widget-chart-labels";
  const startLabel = document.createElement("span");
  const endLabel = document.createElement("span");
  startLabel.textContent = stats.days[0].label;
  endLabel.textContent = stats.days[stats.days.length - 1].label;
  labelRow.append(startLabel, endLabel);
  weekBars.replaceChildren(svg, labelRow);
}

async function fetchStatus() {
  try {
    const response = await fetch(`${basePath}/api/stats`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load status");
    }

    const stats = withLocalDisplayStats(await response.json());
    render(stats.status, stats);
    renderStats(stats);
  } catch (error) {
    subline.textContent = "Signal disconnected";
  }
}

fetchStatus();
setInterval(fetchStatus, 2000);
