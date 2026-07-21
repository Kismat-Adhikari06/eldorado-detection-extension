# Eldorado Order Detection Extension

## What is Eldorado.gg?
Eldorado.gg is a marketplace where people buy and sell in-game items, currencies, and accounts for games like Roblox, Fortnite, Minecraft, and more. Sellers list their items, buyers purchase them, and the seller delivers the item in-game. When someone buys your listing, it shows up as a "Pending Delivery" order on your seller dashboard.

## What does this extension do?
This Chrome extension monitors your Eldorado.gg sold orders page and instantly alerts you when someone buys a specific game item from you. Instead of manually refreshing the page and checking for new orders, the extension watches the page in real-time, detects new orders as they appear, and plays a loud alarm + shows a notification so you never miss a sale.

## Features
- Watches your Eldorado sold orders page in real-time using a MutationObserver
- Auto-refreshes every 20 seconds (with live countdown in the popup)
- Detects orders matching your target game (default: Murder Mystery 2)
- Plays a loud siren alarm when a target order is found
- Shows a Chrome notification popup
- Logs all detected orders in the extension popup
- Auto-pauses on detection — you choose when to resume

## How to install
1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `mm2-alert` folder
5. Navigate to your Eldorado sold orders page: https://www.eldorado.gg/dashboard/orders/sold?orderState=PendingDelivery&displayFilter=DisplaySellingOrders&orderGroup=Regular

## How it works
- **Content script** (`content.js`) runs on the Eldorado orders page
- Uses MutationObserver + polling every 3 seconds to scan for orders
- Tries multiple CSS selectors to find order rows (desktop + mobile layouts)
- Falls back to brute-force text scanning for elements containing "Pending delivery"
- **Background service worker** (`background.js`) handles Chrome notifications
- **Popup** (`popup.html` / `popup.js`) shows status, countdown, logs, and controls

## Controls (extension popup)
- **Pause Monitoring** — stops all scanning
- **Resume Monitoring** — restarts scanning and refresh
- **Refresh: ON/OFF** — toggle auto-refresh (20s countdown)
- **Stop Alarm** — silences the alarm sound

## Files
- `manifest.json` — Extension manifest (Manifest V3)
- `content.js` — Content script (order detection + alarm playback)
- `background.js` — Service worker (notifications + badge)
- `popup.html` — Extension popup UI
- `popup.js` — Popup logic
- `alarm.wav` — Alarm sound file
- `icons/` — Extension icons

## Changing the target game
In `content.js`, change line 2:
```js
const TARGET = "murder mystery 2";  // change to your target game
```

## Notes
- The alarm requires at least one click on the Eldorado page to unlock Chrome's audio
- Logs are stored in Chrome's local storage (persists across popup opens)
- Refresh countdown is displayed in real-time in the popup
- After detection, everything freezes until you click Resume Monitoring
