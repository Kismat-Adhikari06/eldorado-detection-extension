let alertCount = 0;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "mm2_found") {
    alertCount++;
    chrome.storage.local.set({ mm2_alert_count: alertCount });

    chrome.notifications.create(`alert_${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "TARGET ORDER DETECTED!",
      message: `Pet Simulator 99 order found at ${msg.time}\n\n${msg.text.substring(0, 200)}`,
      priority: 2,
      requireInteraction: true,
    });

    chrome.action.setBadgeText({ text: String(alertCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#ff0000" });
  }
});

// Forward stop_alarm to content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "stop_alarm") {
    chrome.tabs.query({ url: "https://www.eldorado.gg/dashboard/orders/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "stop_alarm" }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  }
});
