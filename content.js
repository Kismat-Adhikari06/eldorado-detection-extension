(() => {
  const TARGET = "pet simulator 99";
  const POLL_INTERVAL = 3000;
  const REFRESH_INTERVAL = 20;
  const LOG_KEY = "mm2_log";
  const COUNTDOWN_KEY = "mm2_refresh_countdown";

  let enabled = true;
  let autoRefresh = true;
  let detected = false;
  let refreshTimer = null;
  let pollTimer = null;
  let countdownTimer = null;
  let refreshCountdown = REFRESH_INTERVAL;
  let alarmCtx = null;

  // ---- LOGGING: write directly to storage so popup always sees it ----
  function pushLog(text, isAlert) {
    const ts = new Date().toLocaleTimeString();
    const entry = { text: `[${ts}] ${text}`, alert: !!isAlert };
    chrome.storage.local.get(LOG_KEY, (data) => {
      const log = data[LOG_KEY] || [];
      log.push(entry);
      // Keep max 50
      chrome.storage.local.set({ [LOG_KEY]: log.slice(-50) });
    });
    console.log(`[MM2 ${ts}] ${text}`);
  }

  // ---- ALARM: Web Audio API ----
  function playAlarm() {
    try {
      stopAlarm();
      alarmCtx = new (window.AudioContext || window.webkitAudioContext)();
      function beep(freq, start, dur) {
        const osc = alarmCtx.createOscillator();
        const gain = alarmCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, alarmCtx.currentTime + start);
        gain.gain.setValueAtTime(0.8, alarmCtx.currentTime + start);
        gain.gain.linearRampToValueAtTime(0, alarmCtx.currentTime + start + dur);
        osc.connect(gain);
        gain.connect(alarmCtx.destination);
        osc.start(alarmCtx.currentTime + start);
        osc.stop(alarmCtx.currentTime + start + dur);
      }
      function loop() {
        if (!alarmCtx) return;
        for (let i = 0; i < 25; i++) {
          beep(800, i * 0.3, 0.15);
          beep(1400, i * 0.3 + 0.15, 0.15);
        }
        setTimeout(loop, 7500);
      }
      loop();
    } catch (e) {
      pushLog("Alarm failed: " + e.message, true);
    }
  }

  function stopAlarm() {
    if (alarmCtx) { alarmCtx.close(); alarmCtx = null; }
  }

  // ---- MESSAGES from popup ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "stop_alarm") {
      stopAlarm();
      pushLog("Alarm stopped.", false);
      sendResponse({ ok: true });
    }
    if (msg.type === "resume_monitoring") {
      detected = false;
      enabled = true;
      autoRefresh = true;
      refreshCountdown = REFRESH_INTERVAL;
      chrome.storage.local.set({ mm2_enabled: true, mm2_auto_refresh: true, mm2_detected: false });
      startAutoRefresh();
      startPolling();
      pushLog("Monitoring RESUMED.", false);
      setTimeout(check, 500);
      sendResponse({ ok: true });
    }
    if (msg.type === "get_countdown") {
      sendResponse({ countdown: refreshCountdown, detected: detected });
    }
  });

  // ---- INIT ----
  chrome.storage.local.set({ [LOG_KEY]: [] });

  chrome.storage.local.get(["mm2_enabled", "mm2_auto_refresh"], (data) => {
    if (data.mm2_enabled === false) enabled = false;
    if (data.mm2_auto_refresh === false) autoRefresh = false;
    startAutoRefresh();
    startPolling();
    pushLog("Extension loaded. Watching for: " + TARGET, false);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mm2_enabled) enabled = changes.mm2_enabled.newValue;
    if (changes.mm2_auto_refresh) {
      autoRefresh = changes.mm2_auto_refresh.newValue;
      startAutoRefresh();
    }
  });

  // ---- AUTO REFRESH with countdown ----
  function startAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    if (autoRefresh && !detected) {
      refreshCountdown = REFRESH_INTERVAL;
      countdownTimer = setInterval(() => {
        if (detected) { clearInterval(countdownTimer); return; }
        refreshCountdown--;
        chrome.storage.local.set({ [COUNTDOWN_KEY]: refreshCountdown });
        if (refreshCountdown <= 0) {
          refreshCountdown = REFRESH_INTERVAL;
          pushLog("Auto-refreshing page...", false);
          location.reload();
        }
      }, 1000);
    } else {
      chrome.storage.local.set({ [COUNTDOWN_KEY]: 0 });
    }
  }

  function startPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollTimer = setInterval(() => {
      if (!detected && enabled) check();
    }, POLL_INTERVAL);
  }

  // ---- ORDER DETECTION ----
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

  function check() {
    if (!enabled || detected) return;

    const texts = getOrderTexts();
    if (texts.length === 0) return;

    for (const text of texts) {
      if (text.toLowerCase().includes(TARGET)) {
        detected = true;

        // Freeze everything
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        autoRefresh = false;
        chrome.storage.local.set({ mm2_auto_refresh: false, [COUNTDOWN_KEY]: 0, mm2_detected: true });

        const short = text.substring(0, 120);
        pushLog("TARGET FOUND: " + short, true);

        // Play alarm IMMEDIATELY
        playAlarm();

        // Notify background for Chrome notification
        chrome.runtime.sendMessage({
          type: "mm2_found",
          text: text,
          time: new Date().toLocaleTimeString(),
        });
        return;
      }
    }
  }

  // ---- STARTUP SCANS ----
  setTimeout(check, 800);
  setTimeout(check, 1500);
  setTimeout(check, 3000);

  const observer = new MutationObserver(() => {
    if (!detected) {
      clearTimeout(window._mm2Debounce);
      window._mm2Debounce = setTimeout(check, 800);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
