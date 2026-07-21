let alertCount = 0;

// Forward order scans + target alerts to popup
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "mm2_found") {
    alertCount++;
    showNotification(msg.text, msg.time);
    badgeAlert();
    chrome.runtime.sendMessage({ type: "log_update", text: `ALERT: ${msg.text.substring(0, 100)}`, alert: true });
    chrome.runtime.sendMessage({ type: "count_update", count: alertCount });
    chrome.runtime.sendMessage({ type: "alarm_started" });
  }

  if (msg.type === "order_scan") {
    if (msg.count === 0) {
      chrome.runtime.sendMessage({ type: "log_update", text: "Scan complete - no orders found on page.", alert: false });
    } else {
      chrome.runtime.sendMessage({ type: "log_update", text: `Found ${msg.count} order(s):`, alert: false });
      for (const order of msg.orders) {
        const isTarget = order.toLowerCase().includes("pet simulator 99");
        chrome.runtime.sendMessage({ type: "log_update", text: `  ${isTarget ? ">> " : "   "}${order}`, alert: isTarget });
      }
    }
  }
});

function showNotification(text, time) {
  chrome.notifications.create(`alert_${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "ORDER DETECTED!",
    message: `Pet Simulator 99 order found at ${time}\n\n${text.substring(0, 200)}`,
    priority: 2,
    requireInteraction: true,
  });
}

function badgeAlert() {
  chrome.action.setBadgeText({ text: String(alertCount) });
  chrome.action.setBadgeBackgroundColor({ color: "#ff0000" });
}

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "stop_alarm") {
    // Forward to content script to stop audio
    chrome.tabs.query({ url: "https://www.eldorado.gg/dashboard/orders/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "stop_alarm" }).catch(() => {});
      }
    });
    alertCount = 0;
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
  }
  if (msg.type === "get_status") {
    sendResponse({ alertCount: alertCount });
  }
});
