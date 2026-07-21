(() => {
  const TARGET = "pet simulator 99";
  const POLL_INTERVAL = 3000;
  const REFRESH_INTERVAL = 20000;

  let enabled = true;
  let autoRefresh = true;
  let detected = false;  // true after target found — freezes everything
  let refreshTimer = null;
  let pollTimer = null;
  let alarmCtx = null;

  // --- Alarm audio via Web Audio API ---
  function playAlarm() {
    try {
      stopAlarm();
      alarmCtx = new (window.AudioContext || window.webkitAudioContext)();
      function makeSiren(freq, startTime, duration) {
        const osc = alarmCtx.createOscillator();
        const gain = alarmCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, alarmCtx.currentTime + startTime);
        gain.gain.setValueAtTime(0.6, alarmCtx.currentTime + startTime);
        gain.gain.setValueAtTime(0, alarmCtx.currentTime + startTime + duration);
        osc.connect(gain);
        gain.connect(alarmCtx.destination);
        osc.start(alarmCtx.currentTime + startTime);
        osc.stop(alarmCtx.currentTime + startTime + duration);
      }
      function sirenLoop() {
        if (!alarmCtx) return;
        for (let i = 0; i < 20; i++) {
          makeSiren(900, i * 0.4, 0.2);
          makeSiren(1300, i * 0.4 + 0.2, 0.2);
        }
        setTimeout(sirenLoop, 8000);
      }
      sirenLoop();
    } catch (e) {}
  }

  function stopAlarm() {
    if (alarmCtx) { alarmCtx.close(); alarmCtx = null; }
  }

  // --- Message handler: stop alarm / resume monitoring ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "stop_alarm") {
      stopAlarm();
    }
    if (msg.type === "resume_monitoring") {
      detected = false;
      enabled = true;
      autoRefresh = true;
      chrome.storage.local.set({ mm2_enabled: true, mm2_auto_refresh: true });
      startAutoRefresh();
      startPolling();
      log("Monitoring RESUMED.");
      // Scan immediately after resume
      setTimeout(check, 500);
    }
  });

  // --- Page just loaded: fresh start ---
  chrome.storage.local.set({ mm2_log: [] });
  chrome.runtime.sendMessage({ type: "page_refreshed" });

  chrome.storage.local.get(["mm2_enabled", "mm2_auto_refresh"], (data) => {
    if (data.mm2_enabled === false) enabled = false;
    if (data.mm2_auto_refresh === false) autoRefresh = false;
    startAutoRefresh();
    startPolling();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mm2_enabled) enabled = changes.mm2_enabled.newValue;
    if (changes.mm2_auto_refresh) {
      autoRefresh = changes.mm2_auto_refresh.newValue;
      startAutoRefresh();
    }
  });

  function startAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (autoRefresh && !detected) {
      refreshTimer = setInterval(() => {
        if (detected) return;
        log("Auto-refreshing page...");
        location.reload();
      }, REFRESH_INTERVAL);
    }
  }

  function startPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollTimer = setInterval(() => {
      if (!detected) check();
    }, POLL_INTERVAL);
  }

  function getOrderTexts() {
    const texts = [];
    const selectors = [
      '[class*="order-list-item"]',
      '[class*="order-list-game"]',
      '[class*="order-row"]',
      '[class*="table-row"]',
      '[class*="game-info"]',
      "tr",
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const t = el.innerText.replace(/\s+/g, " ").trim();
        if (t && t.length > 10) texts.push(t);
      }
      if (texts.length > 0) break;
    }
    if (texts.length === 0) {
      const all = document.querySelectorAll("div, p, span, td, li");
      for (const el of all) {
        if (el.children.length > 5) continue;
        const t = el.innerText.replace(/\s+/g, " ").trim();
        if (t && t.length > 10 && t.length < 500 && /pending delivery/i.test(t)) {
          texts.push(t);
        }
      }
    }
    return [...new Set(texts)];
  }

  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`[MM2 Alert ${ts}] ${msg}`);
  }

  function check() {
    if (!enabled || detected) return;

    const texts = getOrderTexts();

    // No log updates when scanning — only scan silently
    if (texts.length === 0) return;

    for (const text of texts) {
      if (text.toLowerCase().includes(TARGET)) {
        detected = true;

        // Freeze everything
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        autoRefresh = false;
        chrome.storage.local.set({ mm2_auto_refresh: false });

        // Play alarm immediately
        playAlarm();

        // Notify background + popup
        chrome.runtime.sendMessage({
          type: "mm2_found",
          text: text,
          time: new Date().toLocaleTimeString(),
        });
        return;
      }
    }
  }

  // Initial fast scan — catch it early
  setTimeout(check, 1000);
  setTimeout(check, 2000);

  const observer = new MutationObserver(() => {
    if (!detected) {
      clearTimeout(window._mm2Debounce);
      window._mm2Debounce = setTimeout(check, 1000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  log("Content script loaded. Watching for orders...");
})();
