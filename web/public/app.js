const headline = document.querySelector("#headline");
const subline = document.querySelector("#subline");
const todayHours = document.querySelector("#todayHours");
const averageHours = document.querySelector("#averageHours");
const longestSession = document.querySelector("#longestSession");
const weekTotal = document.querySelector("#weekTotal");
const weekBars = document.querySelector("#weekBars");
const params = new URLSearchParams(window.location.search);
const isWidget = params.get("widget") === "true";

document.body.classList.toggle("is-widget", isWidget);

if (isWidget) {
  document.title = "Chair Time Widget";
}

function relativeTime(value) {
  if (!value) {
    return "Last signal pending";
  }

  const updated = new Date(value).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - updated) / 1000));

  if (seconds < 5) {
    return "Updated just now";
  }

  if (seconds < 60) {
    return `Updated ${seconds} seconds ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes === 1) {
    return "Updated 1 minute ago";
  }

  return `Updated ${minutes} minutes ago`;
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

function render(status, stats) {
  document.body.classList.toggle("is-sitting", status.sitting);
  document.body.classList.toggle("is-away", !status.sitting);

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
  const area = [
    `M ${points[0].x} ${height - padding}`,
    ...points.map((point) => `L ${point.x} ${point.y}`),
    `L ${points[points.length - 1].x} ${height - padding}`,
    "Z"
  ].join(" ");
  const svg = document.createElementNS(svgNamespace, "svg");
  const title = document.createElementNS(svgNamespace, "title");
  const areaPath = document.createElementNS(svgNamespace, "path");
  const linePath = document.createElementNS(svgNamespace, "path");
  const labelRow = document.createElement("div");

  svg.setAttribute("class", "widget-chart");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  title.textContent = "Sitting time over the last seven days";

  areaPath.setAttribute("class", "widget-chart-area");
  areaPath.setAttribute("d", area);

  linePath.setAttribute("class", "widget-chart-line");
  linePath.setAttribute("d", line);

  svg.append(title, areaPath, linePath);

  for (const point of points) {
    const dot = document.createElementNS(svgNamespace, "circle");
    dot.setAttribute("class", "widget-chart-dot");
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    dot.setAttribute("r", point.day.seconds > 0 ? "1.8" : "1.2");
    svg.append(dot);
  }

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
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load status");
    }

    const stats = await response.json();
    render(stats.status, stats);
    renderStats(stats);
  } catch (error) {
    subline.textContent = "Signal disconnected";
  }
}

fetchStatus();
setInterval(fetchStatus, 2000);
