import pino, { type Logger } from "pino";

export interface LoggerOptions {
  level: string;
  /** Pretty (human) output for local dev; JSON in deployed envs. */
  pretty: boolean;
  env: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  const options = {
    level: opts.level,
    base: { service: "bananax-platform", env: opts.env },
    timestamp: pino.stdTimeFunctions.isoTime
  };
  if (opts.pretty) {
    return pino({ ...options, transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } } });
  }
  // Asynchronous stdout: a slow log pipe (a container log driver under pressure) must
  // never block the event loop, and lines written while one write is in flight go out
  // together. No minimum batch size, so a quiet server's line is written at once.
  // Flushed on exit; a kill -9 can lose the last few lines (money state is in Postgres).
  const dest = pino.destination({ dest: 1, sync: false });
  process.once("exit", () => {
    try {
      dest.flushSync();
    } catch {
      /* not open yet, or already closed */
    }
  });
  return pino(options, dest);
}
