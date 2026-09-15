/**
 * The one logging module.
 *
 * Every log line is single-line JSON carrying a timestamp, written to stdout
 * AND appended to the app log file: `logs/app.log` next to `projects/`
 * (overridable via `LOG_FILE`, resolved against the process cwd). Logging is
 * best-effort by design -- a full disk or an unwritable path prints one note on
 * stderr and the request proceeds, and a line that will not serialize is
 * dropped the same way.
 *
 * The API key never passes through here: callers hand over prompts, model
 * names, usage numbers and outcome strings, never `requireApiKey()`'s value.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

/** Where app-level JSON lines accumulate. */
export const DEFAULT_LOG_FILE = 'logs/app.log';

let logFilePath: string | null = null;
let logFileReady = false;
let logFileUnavailable = false;

function resolveLogFile(): string {
  if (logFilePath === null) {
    const configured = process.env.LOG_FILE?.trim();
    logFilePath = configured
      ? path.resolve(configured)
      : path.join(process.cwd(), DEFAULT_LOG_FILE);
  }
  return logFilePath;
}

/**
 * Appends one line to the log file. The sticky `logFileUnavailable` flag means
 * a broken target is reported once and then left alone for the process's life
 * rather than hammered on every line. The line already went to stdout.
 */
function appendLine(line: string): void {
  if (logFileUnavailable) {
    return;
  }
  if (!logFileReady) {
    try {
      fs.mkdirSync(path.dirname(resolveLogFile()), { recursive: true });
      logFileReady = true;
    } catch (error) {
      logFileUnavailable = true;
      process.stderr.write(
        `[log] could not create the log directory for ${resolveLogFile()}: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      return;
    }
  }
  try {
    fs.appendFileSync(resolveLogFile(), line);
  } catch (error) {
    logFileUnavailable = true;
    process.stderr.write(
      `[log] could not append to ${resolveLogFile()}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

/**
 * Writes one JSON log line. Synchronous on purpose: callers never await a
 * logging call, so fire-and-forget async writes would reorder lines and be
 * lost when the server exits mid-write -- and one small append is cheap in a
 * solo app. Never throws.
 */
export function logEvent(level: LogLevel, fields: Record<string, unknown>): void {
  let line: string;
  try {
    // One physical line no matter what the fields hold: stringify escapes
    // embedded newlines in prompts and replies.
    line = `${JSON.stringify({ ts: new Date().toISOString(), level, ...fields })}\n`;
  } catch {
    process.stderr.write('[log] could not serialize a log line\n');
    return;
  }
  try {
    process.stdout.write(line);
  } catch {
    // A broken stdout is not the caller's problem.
  }
  appendLine(line);
}
