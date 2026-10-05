/**
 * Headless Chrome launch for the real-browser checks (platform/scripts/*-check.ts and
 * demo-operator/scripts/*-check.ts), hardened for shared CI runners.
 *
 * Chrome prints its DevTools port on stderr at start-up. On a loaded GitHub Actions
 * runner that has taken well over the 20s the checks used to allow, failing a gate
 * before anything was tested. So: wait up to CHROME_PORT_TIMEOUT_MS (default 60s),
 * and if that launch still reports nothing (or exits early), kill it, delete its
 * profile and try once more with a fresh one. tools/layout-check.js does the same.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT_TIMEOUT_MS = Number(process.env.CHROME_PORT_TIMEOUT_MS ?? 60_000);
const ATTEMPTS = 2;

/** Worst-case time launchHeadlessChrome may take; add it to a script's overall timeout. */
export const CHROME_LAUNCH_BUDGET_MS = PORT_TIMEOUT_MS * ATTEMPTS;

export function findChrome(): string | undefined {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter((p): p is string => Boolean(p)).find((p) => existsSync(p));
}

export interface LaunchedChrome {
  chrome: ChildProcess;
  /** http://127.0.0.1:<devtools port> */
  wsBase: string;
  /** The temporary profile; the caller removes it on exit. */
  userDataDir: string;
}

function startOnce(chromePath: string, profilePrefix: string, args: string[]): { chrome: ChildProcess; userDataDir: string; port: Promise<string> } {
  const userDataDir = mkdtempSync(join(tmpdir(), profilePrefix));
  const chrome = spawn(chromePath, ["--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, ...args], {
    stdio: ["ignore", "ignore", "pipe"]
  });
  const port = new Promise<string>((resolve, reject) => {
    let buf = "";
    const t = setTimeout(
      () => reject(new Error(`chrome did not report a debug port within ${PORT_TIMEOUT_MS / 1000}s${buf.trim() ? ` (stderr: ${buf.trim().slice(-300)})` : ""}`)),
      PORT_TIMEOUT_MS
    );
    chrome.on("exit", (code) => {
      clearTimeout(t);
      reject(new Error(`chrome exited (${code}) before reporting a debug port`));
    });
    chrome.stderr!.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        clearTimeout(t);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
  });
  return { chrome, userDataDir, port };
}

/**
 * Launch headless Chrome with `args` (the caller's flags: --headless=new, window size,
 * …; --remote-debugging-port and --user-data-dir are added here).
 */
export async function launchHeadlessChrome(chromePath: string, profilePrefix: string, args: string[]): Promise<LaunchedChrome> {
  for (let attempt = 1; ; attempt += 1) {
    const { chrome, userDataDir, port } = startOnce(chromePath, profilePrefix, args);
    try {
      return { chrome, wsBase: await port, userDataDir };
    } catch (err) {
      chrome.kill();
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
      if (attempt >= ATTEMPTS) throw err;
      console.warn(`chrome launch attempt ${attempt} failed (${(err as Error).message}); retrying`);
    }
  }
}
