const headline = document.querySelector("#headline");
const subline = document.querySelector("#subline");
const todayHours = document.querySelector("#todayHours");
const currentSession = document.querySelector("#currentSession");
const averageHours = document.querySelector("#averageHours");
const longestSession = document.querySelector("#longestSession");
const weekTotal = document.querySelector("#weekTotal");
const weekBars = document.querySelector("#weekBars");

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

function render(status) {
  document.body.classList.toggle("is-sitting", status.sitting);
  document.body.classList.toggle("is-away", !status.sitting);

  headline.textContent = status.sitting
    ? "Sam is in his chair!"
    : "Sam is not in his chair.";
  subline.textContent = relativeTime(status.updatedAt);
}

function renderStats(stats) {
  const maxSeconds = Math.max(3600, ...stats.days.map((day) => day.seconds));

  todayHours.textContent = formatDuration(stats.todaySeconds);
  currentSession.textContent = formatDuration(stats.currentSessionSeconds);
  averageHours.textContent = formatDuration(stats.averageDailySeconds);
  longestSession.textContent = formatDuration(stats.longestSessionSeconds);
  weekTotal.textContent = `${formatDuration(stats.weekSeconds)} total`;

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

async function fetchStatus() {
  try {
    const response = await fetch("/api/stats", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not load status");
    }

    const stats = await response.json();
    render(stats.status);
    renderStats(stats);
  } catch (error) {
    subline.textContent = "Signal disconnected";
  }
}

fetchStatus();
setInterval(fetchStatus, 2000);
