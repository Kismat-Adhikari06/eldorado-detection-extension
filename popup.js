const statusEl = document.getElementById("statusValue");
const alertCountEl = document.getElementById("alertCount");
const stopBtn = document.getElementById("stopAlarm");
const toggleBtn = document.getElementById("toggleBtn");
const refreshBtn = document.getElementById("refreshBtn");
const logEl = document.getElementById("log");
const countdownEl = document.getElementById("countdown");

// ---- LOAD STATE from storage ----
function loadState() {
  chrome.storage.local.get(["mm2_enabled", "mm2_auto_refresh", "mm2_log", "mm2_refresh_countdown", "mm2_alert_count"], (data) => {
    const enabled = data.mm2_enabled !== false;
    const refresh = data.mm2_auto_refresh !== false;
    const countdown = data.mm2_refresh_countdown || 0;
    const count = data.mm2_alert_count || 0;

    updateUI(enabled);
    updateRefreshUI(refresh, countdown);
    alertCountEl.textContent = count;

    // Load logs from storage
    logEl.innerHTML = "";
    if (data.mm2_log && data.mm2_log.length > 0) {
      data.mm2_log.forEach((entry) => addLogEntryDOM(entry.text, entry.alert));
    } else {
      logEl.innerHTML = '<div class="empty">No activity yet. Open your Eldorado sold orders page.</div>';
    }

    // Show stop button if alert count > 0
    if (count > 0) stopBtn.style.display = "block";
  });
}

loadState();

// ---- LISTEN for storage changes (content script writes logs there) ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.mm2_log) {
    const log = changes.mm2_log.newValue || [];
    logEl.innerHTML = "";
    if (log.length > 0) {
      log.forEach((entry) => addLogEntryDOM(entry.text, entry.alert));
    } else {
      logEl.innerHTML = '<div class="empty">No activity yet. Open your Eldorado sold orders page.</div>';
    }
  }

  if (changes.mm2_alert_count) {
    alertCountEl.textContent = changes.mm2_alert_count.newValue || 0;
    if ((changes.mm2_alert_count.newValue || 0) > 0) {
      stopBtn.style.display = "block";
    }
  }

  if (changes.mm2_auto_refresh) {
    const on = changes.mm2_auto_refresh.newValue !== false;
    updateRefreshBtn(on);
  }

  if (changes.mm2_enabled) {
    updateUI(changes.mm2_enabled.newValue !== false);
  }

  if (changes.mm2_refresh_countdown) {
    const cd = changes.mm2_refresh_countdown.newValue || 0;
    updateCountdown(cd);
  }
});

// ---- Also poll countdown every second for smooth display ----
setInterval(() => {
  chrome.storage.local.get(["mm2_refresh_countdown", "mm2_auto_refresh", "mm2_detected"], (data) => {
    if (data.mm2_detected) {
      countdownEl.textContent = "PAUSED";
      countdownEl.style.color = "#ff4444";
    } else if (data.mm2_auto_refresh !== false) {
      updateCountdown(data.mm2_refresh_countdown || 0);
    }
  });
}, 1000);

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

function updateRefreshBtn(on) {
  if (on) {
    refreshBtn.textContent = "Refresh: ON";
    refreshBtn.style.background = "#0f3460";
  } else {
    refreshBtn.textContent = "Refresh: OFF";
    refreshBtn.style.background = "#333";
  }
}

function updateCountdown(sec) {
  if (sec > 0) {
    countdownEl.textContent = "Refresh in " + sec + "s";
    countdownEl.style.color = "#00ff88";
  } else {
    countdownEl.textContent = "";
  }
}

function addLogEntryDOM(text, isAlert) {
  const placeholder = logEl.querySelector(".empty");
  if (placeholder) placeholder.remove();

  const div = document.createElement("div");
  div.className = "log-entry" + (isAlert ? " alert" : "");
  div.textContent = text;
  logEl.appendChild(div);

  while (logEl.children.length > 50) {
    logEl.removeChild(logEl.firstChild);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- BUTTON HANDLERS ----
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop_alarm" }, () => {
    stopBtn.style.display = "none";
  });
});

toggleBtn.addEventListener("click", () => {
  chrome.storage.local.get("mm2_enabled", (data) => {
    const enabled = data.mm2_enabled !== false;
    const newEnabled = !enabled;
    chrome.storage.local.set({ mm2_enabled: newEnabled });

    if (newEnabled) {
      // Resume: send message to content script
      chrome.tabs.query({ url: "https://www.eldorado.gg/dashboard/orders/*" }, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: "resume_monitoring" }).catch(() => {});
        }
      });
    }

    updateUI(newEnabled);
  });
});

refreshBtn.addEventListener("click", () => {
  chrome.storage.local.get("mm2_auto_refresh", (data) => {
    const on = data.mm2_auto_refresh !== false;
    chrome.storage.local.set({ mm2_auto_refresh: !on });
    updateRefreshBtn(!on);
  });
});
