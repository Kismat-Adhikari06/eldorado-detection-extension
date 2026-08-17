import json
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import messagebox
import winsound

from playwright.sync_api import sync_playwright


def get_base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def get_resource_dir():
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", get_base_dir())
    return BASE_DIR


BASE_DIR = get_base_dir()
PROFILE_DIR = os.path.join(BASE_DIR, "browser_profile")
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")


def load_settings():
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


settings = load_settings()
current_target = settings.get("target", "murder mystery 2")
URL = settings.get(
    "url",
    "https://www.eldorado.gg/dashboard/orders/sold?orderState=PendingDelivery&displayFilter=DisplaySellingOrders&orderGroup=Regular",
)
POLL_SECONDS = max(1, int(settings.get("poll_seconds", 3)))
REFRESH_SECONDS = max(5, int(settings.get("refresh_seconds", 20)))
USE_EXISTING_CHROME = bool(settings.get("use_existing_chrome", True))
CHROME_PROFILE = (settings.get("chrome_profile") or "").strip()


def set_target(value):
    global current_target
    value = (value or "").strip()
    if value:
        current_target = value
        settings["target"] = value
        try:
            with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
        except Exception:
            pass
    return current_target


def default_chrome_profile():
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(local, "Google", "Chrome", "User Data", "Default"),
        os.path.join(local, "Google", "Chrome", "User Data", "Profile 1"),
        os.path.join(local, "Google", "Chrome", "User Data"),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return path
    return candidates[0]


def chrome_running():
    try:
        out = subprocess.run(
            ["tasklist"], capture_output=True, text=True, timeout=15
        ).stdout.lower()
        return "chrome.exe" in out
    except Exception:
        return False


def wait_for_chrome_close(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not chrome_running():
            return True
        time.sleep(1)
    return not chrome_running()

DETECT_JS = """
(TARGET) => {
  const texts = [];
  const selectors = [
    '[class*="order-list-item"]',
    '[class*="order-list-game"]',
    '[class*="order-row"]',
    '[class*="table-row"]',
    '[class*="game-info"]',
    'tr',
  ];
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length > 10) texts.push(t);
    }
    if (texts.length > 0) break;
  }
  if (texts.length === 0) {
    const all = document.querySelectorAll('div, p, span, td, li');
    for (const el of all) {
      if (el.children.length > 5) continue;
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length > 10 && t.length < 500 && /pending delivery/i.test(t)) texts.push(t);
    }
  }
  const unique = [...new Set(texts)];
  for (const text of unique) {
    if (text.toLowerCase().includes(TARGET.toLowerCase())) return text;
  }
  return null;
}
"""


ALARM_WAV = os.path.join(get_resource_dir(), "alarm.wav")


class Alarm:
    def __init__(self):
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self.stop()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self):
        if os.path.exists(ALARM_WAV):
            try:
                winsound.PlaySound(ALARM_WAV, winsound.SND_FILENAME | winsound.SND_LOOP | winsound.SND_ASYNC)
                while not self._stop.is_set():
                    time.sleep(0.2)
                winsound.PlaySound(None, winsound.SND_PURGE)
                return
            except Exception:
                pass
        while not self._stop.is_set():
            for freq, dur in ((800, 150), (1400, 150)):
                if self._stop.is_set():
                    return
                winsound.Beep(freq, dur)

    def stop(self):
        self._stop.set()
        try:
            winsound.PlaySound(None, winsound.SND_PURGE)
        except Exception:
            pass
        if self._thread:
            self._thread.join(timeout=1)
            self._thread = None


STEALTH_JS = """
() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });
  window.chrome = window.chrome || { runtime: {} };
}
"""

CHALLENGE_HINTS = ("challenge", "captcha", "cloudflare", "login", "signin", "sign-in", "auth")


def is_challenged(url, title):
    joined = (url or "") + " " + (title or "")
    return any(h in joined.lower() for h in CHALLENGE_HINTS)


class Monitor(threading.Thread):
    def __init__(self, events):
        super().__init__(daemon=True)
        self.events = events
        self._cmd = queue.Queue()
        self._stop_flag = threading.Event()
        self.paused = False
        self.auto_refresh = True
        self.on_dashboard = False

    def stop(self):
        self._stop_flag.set()

    def send(self, cmd):
        self._cmd.put(cmd)

    def run(self):
        try:
            with sync_playwright() as p:
                profile_dir = PROFILE_DIR
                use_existing = USE_EXISTING_CHROME

                if use_existing:
                    real = CHROME_PROFILE if CHROME_PROFILE else default_chrome_profile()
                    if os.path.isdir(real):
                        profile_dir = real
                        if chrome_running():
                            self.events.put(
                                (
                                    "prompt_close_chrome",
                                    "Close Chrome so the app can use your logged-in session, then press OK.",
                                )
                            )
                            if not wait_for_chrome_close(timeout=180):
                                self.events.put(
                                    ("error", "Chrome is still open. Close it and restart the app.")
                                )
                                return
                        self.events.put(("log", "Using your existing Chrome profile: " + profile_dir))
                    else:
                        self.events.put(
                            (
                                "log",
                                "Existing Chrome profile not found - using a separate profile (you'll need to log in once).",
                            )
                        )
                        profile_dir = PROFILE_DIR

                ctx = p.chromium.launch_persistent_context(
                    profile_dir,
                    channel="chrome",
                    headless=False,
                    ignore_default_args=["--enable-automation"],
                    args=[
                        "--start-maximized",
                        "--disable-blink-features=AutomationControlled",
                    ],
                )
                ctx.add_init_script(STEALTH_JS)
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                self.events.put(("log", "Browser opened. Monitoring for: " + current_target))

                self._detected = False
                last_refresh = time.time()
                waiting_for_user = False

                self._goto(page)

                while not self._stop_flag.is_set():
                    self._handle_commands(page)

                    if self._detected or self.paused:
                        time.sleep(1)
                        continue

                    title = ""
                    try:
                        title = page.title()
                    except Exception:
                        pass

                    challenged = is_challenged(page.url, title)
                    if challenged:
                        if not waiting_for_user:
                            waiting_for_user = True
                            self.on_dashboard = False
                            self.events.put(
                                (
                                    "log",
                                    "Login or captcha detected - please finish it in the browser window. Monitoring waits for you.",
                                )
                            )
                        time.sleep(2)
                        continue

                    if waiting_for_user:
                        waiting_for_user = False
                        self.on_dashboard = True
                        self.events.put(("log", "Back on the orders page. Monitoring active."))
                        last_refresh = time.time()

                    if self.auto_refresh:
                        remaining = REFRESH_SECONDS - int(time.time() - last_refresh)
                        if remaining <= 0:
                            last_refresh = time.time()
                            self.events.put(("log", "Auto-refreshing page..."))
                            try:
                                page.reload(timeout=30000, wait_until="domcontentloaded")
                            except Exception:
                                pass
                        else:
                            self.events.put(("countdown", remaining))

                    try:
                        match = page.evaluate(DETECT_JS, current_target)
                    except Exception:
                        time.sleep(POLL_SECONDS)
                        continue

                    if match:
                        self._detected = True
                        self.on_dashboard = False
                        self.events.put(("detected", match))
                        time.sleep(1)
                        continue

                    time.sleep(POLL_SECONDS)
        except Exception as e:
            self.events.put(("error", str(e)))
        finally:
            self.events.put(("exit", None))

    def _goto(self, page):
        try:
            page.goto(URL, timeout=60000, wait_until="domcontentloaded")
        except Exception:
            pass

    def _handle_commands(self, page):
        try:
            while True:
                cmd = self._cmd.get_nowait()
                if cmd == "pause":
                    self.paused = True
                    self.events.put(("log", "Monitoring paused."))
                elif cmd == "resume":
                    self.paused = False
                    self.events.put(("log", "Monitoring resumed."))
                    self._goto(page)
                elif cmd == "reset_detected":
                    self._detected = False
                    self.paused = False
                    self.events.put(("log", "Monitoring resumed."))
                    self._goto(page)
                elif cmd == "toggle_refresh":
                    self.auto_refresh = not self.auto_refresh
                    self.events.put(
                        ("log", "Auto-refresh " + ("ON" if self.auto_refresh else "OFF"))
                    )
        except queue.Empty:
            pass


BG = "#12121f"
PANEL = "#1b1b30"
PANEL2 = "#232344"
BORDER = "#2f2f5e"
ACCENT = "#6c5ce7"
TEXT = "#e0e0e0"
GREEN = "#00ff88"
RED = "#ff4444"
ORANGE = "#ffa502"
MUTED = "#8a8aa0"
CODE = "#0d0d17"


class App:
    def __init__(self, root):
        self.root = root
        root.title("MM2 Order Alert")
        root.configure(bg=BG)
        root.geometry("420x620")
        root.minsize(360, 480)

        self.events = queue.Queue()
        self.monitor = Monitor(self.events)
        self.alarm = Alarm()
        self.detected = False
        self.paused = False
        self.refresh_on = True

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._quit)
        self.root.after(100, self._poll)
        self.monitor.start()

    def _card(self, parent):
        frame = tk.Frame(parent, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        return frame

    def _build_ui(self):
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=18, pady=(16, 6))
        tk.Label(
            header,
            text="MM2 ORDER ALERT",
            font=("Segoe UI", 17, "bold"),
            fg="#ffffff",
            bg=BG,
        ).pack(anchor="w")
        tk.Label(
            header,
            text="Eldorado.gg order watcher",
            font=("Segoe UI", 9),
            fg=MUTED,
            bg=BG,
        ).pack(anchor="w")

        target_card = self._card(self.root)
        target_card.pack(fill="x", padx=18, pady=6)
        tk.Label(target_card, text="WATCHING FOR", font=("Segoe UI", 8, "bold"), fg=ACCENT, bg=PANEL).pack(anchor="w", padx=12, pady=(10, 2))
        target_row = tk.Frame(target_card, bg=PANEL)
        target_row.pack(fill="x", padx=12, pady=(0, 10))
        self.target_var = tk.StringVar(value=current_target)
        self.target_entry = tk.Entry(
            target_row,
            textvariable=self.target_var,
            bg=PANEL2,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            font=("Segoe UI", 10),
        )
        self.target_entry.pack(side="left", fill="x", expand=True, ipady=6)
        self.target_entry.bind("<Return>", lambda e: self._save_target())
        self.save_btn = self._btn(target_row, "Save", ACCENT, self._save_target)
        self.save_btn.pack(side="left", padx=(8, 0))

        status_card = self._card(self.root)
        status_card.pack(fill="x", padx=18, pady=6)
        tk.Label(status_card, text="STATUS", font=("Segoe UI", 8, "bold"), fg=MUTED, bg=PANEL).pack(anchor="w", padx=12, pady=(10, 0))
        status_row = tk.Frame(status_card, bg=PANEL)
        status_row.pack(fill="x", padx=12, pady=(2, 2))
        self.status_dot = tk.Canvas(status_row, width=14, height=14, bg=PANEL, highlightthickness=0)
        self.status_dot.pack(side="left", pady=6)
        self.status_label = tk.Label(status_row, text="Starting...", font=("Segoe UI", 15, "bold"), fg=GREEN, bg=PANEL)
        self.status_label.pack(side="left", padx=8)
        self.countdown_label = tk.Label(status_card, text="", font=("Segoe UI", 10), fg=GREEN, bg=PANEL)
        self.countdown_label.pack(anchor="w", padx=12, pady=(0, 10))

        btns = tk.Frame(self.root, bg=BG)
        btns.pack(fill="x", padx=18, pady=6)

        row1 = tk.Frame(btns, bg=BG)
        row1.pack(fill="x", pady=2)
        self.stop_btn = self._btn(row1, "Stop Alarm", RED, self._stop_alarm, state="disabled")
        self.stop_btn.pack(side="left", fill="x", expand=True)
        self.test_btn = self._btn(row1, "Test Alarm", "#7d3b8f", self._test_alarm)
        self.test_btn.pack(side="left", fill="x", expand=True, padx=(8, 0))

        row2 = tk.Frame(btns, bg=BG)
        row2.pack(fill="x", pady=2)
        self.resume_btn = self._btn(row2, "Resume Monitoring", "#2d6a4f", self._resume, state="disabled")
        self.resume_btn.pack(side="left", fill="x", expand=True)
        self.pause_btn = self._btn(row2, "Pause Monitoring", "#1f3a5f", self._toggle_pause)
        self.pause_btn.pack(side="left", fill="x", expand=True, padx=(8, 0))

        self.refresh_btn = self._btn(btns, f"Auto-Refresh: ON ({REFRESH_SECONDS}s)", "#1f3a5f", self._toggle_refresh)
        self.refresh_btn.pack(fill="x", pady=2)

        log_card = self._card(self.root)
        log_card.pack(fill="both", expand=True, padx=18, pady=(6, 14))
        tk.Label(log_card, text="LOG", font=("Segoe UI", 8, "bold"), fg=MUTED, bg=PANEL).pack(anchor="w", padx=12, pady=(10, 0))
        self.log_text = tk.Text(
            log_card,
            bg=CODE,
            fg="#9aa0b5",
            insertbackground=TEXT,
            relief="flat",
            font=("Consolas", 9),
            padx=10,
            pady=6,
            state="disabled",
            highlightthickness=0,
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=(4, 10))

        self._set_dot(GREEN)

    def _set_dot(self, color):
        self.status_dot.delete("all")
        self.status_dot.create_oval(1, 1, 13, 13, fill=color, outline="")

    def _btn(self, parent, text, color, cmd, state="normal"):
        return tk.Button(
            parent,
            text=text,
            command=cmd,
            bg=color,
            fg="white",
            activebackground=color,
            activeforeground="white",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            borderwidth=0,
            cursor="hand2",
            padx=10,
            pady=8,
            state=state,
            disabledforeground="#999",
        )

    def _save_target(self):
        set_target(self.target_var.get())
        self._log(f"Now watching for: {current_target}")
        self.target_var.set(current_target)
        self.root.focus_set()

    def _test_alarm(self):
        self._log("Testing alarm...")
        self.alarm.start()
        self._show_alert_popup("TEST - no real order. Click STOP ALARM to stop the test siren.")
        self.root.after(100, lambda: self._log("Test alert shown - it always displays regardless of Windows notification settings."))

    def _prompt_close_chrome(self, message):
        self._log("Waiting for you to close Chrome...", alert=True)
        self.status_label.configure(text="Close Chrome", fg=ORANGE)
        self._set_dot(ORANGE)
        messagebox.showinfo("MM2 Order Alert", message)
        self._log("Chrome closed - continuing...")

    def _log(self, text, alert=False):
        ts = time.strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        if alert:
            self.log_text.insert("end", f"[{ts}] {text}\n", "alert")
        else:
            self.log_text.insert("end", f"[{ts}] {text}\n")
        self.log_text.tag_config("alert", foreground=RED)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _poll(self):
        try:
            while True:
                evt = self.events.get_nowait()
                kind = evt[0]
                if kind == "log":
                    self._log(evt[1])
                elif kind == "countdown":
                    if not self.detected and not self.paused and self.refresh_on:
                        self.countdown_label.configure(text=f"Refresh in {evt[1]}s")
                elif kind == "detected":
                    self._on_detected(evt[1])
                elif kind == "prompt_close_chrome":
                    self._prompt_close_chrome(evt[1])
                elif kind == "error":
                    self._log("ERROR: " + evt[1], alert=True)
                    self.status_label.configure(text="Error", fg=RED)
                    self._set_dot(RED)
                elif kind == "exit":
                    self._log("Monitor stopped.")
        except queue.Empty:
            pass
        self.root.after(100, self._poll)

    def _on_detected(self, match):
        self.detected = True
        self.status_label.configure(text="TARGET FOUND!", fg=RED)
        self._set_dot(RED)
        self.countdown_label.configure(text="")
        self.stop_btn.configure(state="normal")
        self.resume_btn.configure(state="normal")
        self.pause_btn.configure(state="disabled")
        self._log(f"TARGET FOUND: {match[:120]}", alert=True)
        self.alarm.start()
        self.root.bell()
        self.root.deiconify()
        self.root.attributes("-topmost", True)
        self.root.lift()
        self._show_alert_popup(match)
        self._show_toast(match)

    def _show_toast(self, match):
        toast = tk.Toplevel(self.root)
        toast.configure(bg="#333333")
        toast.attributes("-topmost", True)
        toast.overrideredirect(True)
        toast.geometry("320x80")
        toast.resizable(False, False)

        t_frame = tk.Frame(toast, bg="#333333")
        t_frame.pack(fill="both", expand=True, padx=4, pady=4)
        tk.Frame(t_frame, bg=RED, width=4).pack(side="left", fill="y")

        text_frame = tk.Frame(t_frame, bg="#333333")
        text_frame.pack(side="left", fill="both", expand=True, padx=(6, 0))
        tk.Label(
            text_frame, text="MM2 ORDER ALERT",
            font=("Segoe UI", 9, "bold"), fg=RED, bg="#333333", anchor="w",
        ).pack(fill="x")
        tk.Label(
            text_frame, text=f"{current_target.title()} order found!",
            font=("Segoe UI", 9), fg=TEXT, bg="#333333", anchor="w",
        ).pack(fill="x")

        toast.update_idletasks()
        tx = toast.winfo_screenwidth() - 340
        ty = toast.winfo_screenheight() - 140
        toast.geometry(f"+{tx}+{ty}")

        def dismiss():
            if toast.winfo_exists():
                toast.destroy()
        toast.after(8000, dismiss)

    def _show_alert_popup(self, match):
        if hasattr(self, "_alert_popup") and self._alert_popup and self._alert_popup.winfo_exists():
            self._alert_popup.destroy()
        popup = tk.Toplevel(self.root)
        self._alert_popup = popup
        popup.title("MM2 ORDER DETECTED")
        popup.configure(bg="#2a0000")
        popup.attributes("-topmost", True)
        popup.geometry("420x260")
        popup.resizable(False, False)
        popup.protocol("WM_DELETE_WINDOW", self._stop_alarm)

        tk.Label(
            popup,
            text="\u26a0 MM2 ORDER DETECTED!",
            font=("Segoe UI", 18, "bold"),
            fg="#ff4444",
            bg="#2a0000",
        ).pack(pady=(24, 6))
        tk.Label(
            popup,
            text="Murder Mystery 2 order found on Eldorado!",
            font=("Segoe UI", 11),
            fg="#e0e0e0",
            bg="#2a0000",
        ).pack()
        tk.Label(
            popup,
            text="\n" + (match[:120] or ""),
            font=("Consolas", 9),
            fg="#ffddaa",
            bg="#2a0000",
            wraplength=380,
            justify="left",
        ).pack(padx=20)

        stop_btn = tk.Button(
            popup,
            text="STOP ALARM",
            command=self._stop_alarm,
            bg="#ff4444",
            fg="white",
            activebackground="#cc0000",
            activeforeground="white",
            font=("Segoe UI", 13, "bold"),
            relief="flat",
            borderwidth=0,
            cursor="hand2",
            padx=20,
            pady=10,
        )
        stop_btn.pack(pady=(14, 20))

        popup.update_idletasks()
        x = (popup.winfo_screenwidth() - 420) // 2
        y = (popup.winfo_screenheight() - 260) // 3
        popup.geometry(f"+{x}+{y}")
        popup.lift()
        popup.focus_force()

    def _stop_alarm(self):
        self.alarm.stop()
        self.stop_btn.configure(state="disabled")
        if hasattr(self, "_alert_popup") and self._alert_popup and self._alert_popup.winfo_exists():
            self._alert_popup.destroy()
        self._log("Alarm stopped.")

    def _resume(self):
        self.detected = False
        self.alarm.stop()
        if hasattr(self, "_alert_popup") and self._alert_popup and self._alert_popup.winfo_exists():
            self._alert_popup.destroy()
        self.status_label.configure(text="Active", fg=GREEN)
        self._set_dot(GREEN)
        self.stop_btn.configure(state="disabled")
        self.resume_btn.configure(state="disabled")
        self.pause_btn.configure(state="normal")
        self.monitor.send("reset_detected")

    def _toggle_pause(self):
        if self.paused:
            self.paused = False
            self.status_label.configure(text="Active", fg=GREEN)
            self._set_dot(GREEN)
            self.pause_btn.configure(text="Pause Monitoring")
            self.monitor.send("resume")
        else:
            self.paused = True
            self.status_label.configure(text="Paused", fg=ORANGE)
            self._set_dot(ORANGE)
            self.pause_btn.configure(text="Resume Monitoring")
            self.countdown_label.configure(text="")
            self.monitor.send("pause")

    def _toggle_refresh(self):
        self.refresh_on = not self.refresh_on
        if self.refresh_on:
            self.refresh_btn.configure(text=f"Auto-Refresh: ON ({REFRESH_SECONDS}s)")
            self.refresh_btn.configure(bg="#1f3a5f")
        else:
            self.refresh_btn.configure(text="Auto-Refresh: OFF")
            self.refresh_btn.configure(bg="#333333")
        self.monitor.send("toggle_refresh")

    def _quit(self):
        self.alarm.stop()
        self.monitor.stop()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.mainloop()
