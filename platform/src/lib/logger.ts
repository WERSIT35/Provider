import pino, { type Logger } from "pino";

export interface LoggerOptions {
  level: string;
  /** Pretty (human) output for local dev; JSON in deployed envs. */
  pretty: boolean;
  env: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  return pino({
    level: opts.level,
    base: { service: "bananax-platform", env: opts.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(opts.pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" }
          }
        }
      : {})
  });
}
