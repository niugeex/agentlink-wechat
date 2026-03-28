import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveLogPath } from './paths.js';

const LEVELS = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
} as const;

const SECRET_KEY_PATTERN = /(token|context|aes|authorization|ticket|secret|key)/i;

export type LogLevel = keyof typeof LEVELS;

function normalizeLevel(level?: string): LogLevel {
  if (!level) {
    return 'info';
  }
  const normalized = level.toLowerCase() as LogLevel;
  return normalized in LEVELS ? normalized : 'info';
}

function redactSecretString(value: string): string {
  return `${value.slice(0, 6)}...(${value.length})`;
}

function redact(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    if (keyHint && SECRET_KEY_PATTERN.test(keyHint)) {
      return redactSecretString(value);
    }
    if (/^[a-z0-9]+@im\.bot:/i.test(value)) {
      return redactSecretString(value);
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      try {
        const url = new URL(value);
        url.search = '';
        return url.toString();
      } catch {
        return value;
      }
    }
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, keyHint));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, redact(inner, key)]),
    );
  }

  return value;
}

export function sanitizeLogMeta(meta: unknown): unknown {
  return redact(meta);
}

export class Logger {
  private readonly threshold: number;
  private readonly logPath: string;

  constructor(level?: LogLevel) {
    const resolvedLevel = normalizeLevel(process.env.OPENCLAW_LOG_LEVEL ?? level);
    this.threshold = LEVELS[resolvedLevel];
    this.logPath = resolveLogPath();
  }

  trace(message: string, meta?: unknown): void {
    this.log('trace', message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVELS[level] < this.threshold) {
      return;
    }

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      meta: meta === undefined ? undefined : sanitizeLogMeta(meta),
    });

    void this.write(entry);
  }

  private async write(line: string): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${line}\n`, 'utf8');
  }
}
