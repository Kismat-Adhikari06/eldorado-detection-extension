const statusEl = document.getElementById("statusValue");
const alertCountEl = document.getElementById("alertCount");
const stopBtn = document.getElementById("stopAlarm");
const toggleBtn = document.getElementById("toggleBtn");
const refreshBtn = document.getElementById("refreshBtn");
const logEl = document.getElementById("log");

// Load saved state
chrome.storage.local.get(["mm2_enabled", "mm2_auto_refresh", "mm2_log"], (data) => {
  const enabled = data.mm2_enabled !== false;
  const refresh = data.mm2_auto_refresh !== false;
  updateUI(enabled);
  updateRefreshUI(refresh);
  if (data.mm2_log) {
    data.mm2_log.forEach((entry) => addLogEntry(entry.text, entry.alert));
  }
});

chrome.runtime.sendMessage({ type: "get_status" }, (res) => {
  if (res) {
    alertCountEl.textContent = res.alertCount;
    if (res.alarmPlaying) {
      stopBtn.style.display = "block";
    }
  }
});

// Listen for live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "log_update") {
    addLogEntry(msg.text, msg.alert);
  }
  if (msg.type === "count_update") {
    alertCountEl.textContent = msg.count;
  }
  if (msg.type === "alarm_started") {
    stopBtn.style.display = "block";
  }
});

function updateUI(enabled) {
  if (enabled) {
    statusEl.textContent = "Active";
    statusEl.className = "status-value active";
    toggleBtn.textContent = "Pause Monitoring";
  } else {
    statusEl.textContent = "Paused";
    statusEl.className = "status-value inactive";
    toggleBtn.textContent = "Resume Monitoring";
  }
}

function updateRefreshUI(on) {
  if (on) {
    refreshBtn.textContent = "Refresh: ON (20s)";
    refreshBtn.style.background = "#0f3460";
  } else {
    refreshBtn.textContent = "Refresh: OFF";
    refreshBtn.style.background = "#333";
  }
}

function addLogEntry(text, isAlert) {
  // Remove "no activity yet" placeholder
  const placeholder = logEl.querySelector(".empty");
  if (placeholder) placeholder.remove();

  const div = document.createElement("div");
  div.className = "log-entry" + (isAlert ? " alert" : "");
  const ts = new Date().toLocaleTimeString();
  div.textContent = `[${ts}] ${text}`;
  logEl.prepend(div);

  // Keep max 30 entries
  while (logEl.children.length > 30) {
    logEl.removeChild(logEl.lastChild);
  }

  // Save log
  const entries = [];
  logEl.querySelectorAll(".log-entry").forEach((el) => {
    entries.unshift({ text: el.textContent.replace(/^\[.*?\]\s*/, ""), alert: el.classList.contains("alert") });
  });
  chrome.storage.local.set({ mm2_log: entries.slice(-30) });
}

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop_alarm" }, () => {
    stopBtn.style.display = "none";
    addLogEntry("Alarm stopped.", false);
  });
});

toggleBtn.addEventListener("click", () => {
  chrome.storage.local.get("mm2_enabled", (data) => {
    const enabled = data.mm2_enabled !== false;
    const newEnabled = !enabled;
    chrome.storage.local.set({ mm2_enabled: newEnabled });
    updateUI(newEnabled);
    addLogEntry(newEnabled ? "Monitoring resumed." : "Monitoring paused.", false);
  });
});

refreshBtn.addEventListener("click", () => {
  chrome.storage.local.get("mm2_auto_refresh", (data) => {
    const on = data.mm2_auto_refresh !== false;
    const newOn = !on;
    chrome.storage.local.set({ mm2_auto_refresh: newOn });
    updateRefreshUI(newOn);
    addLogEntry(newOn ? "Auto-refresh ON (every 20s)." : "Auto-refresh OFF.", false);
  });
});
