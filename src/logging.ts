import fs from "fs";
import type { Writable } from "stream";
import winston from "winston";

export interface LoggerTarget {
  file?: string;
  stream?: Writable;
}

const SECRET_KEY =
  /^(authorization|proxy-authorization|cookie|set-cookie|auth|password|token|access_token|refresh_token|secret)$/i;
const CREDENTIAL_IN_TEXT = /\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]+/gi;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A logged axios error carries the request config, and with it the credentials: the `auth`
 * option, the Authorization header, and the raw request head on `request._header`. Walk the
 * value, blank every secret key and every Basic or Bearer credential inside a string, and
 * reduce socket-level objects (requests, responses, sockets) to their class name.
 */
function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return value.replace(CREDENTIAL_IN_TEXT, `$1 ${REDACTED}`);
  }
  if (typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);

  const candidate = value as Record<string, any>;
  if (typeof candidate.toJSON === "function") {
    return redact(candidate.toJSON(), depth + 1, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  let source: Record<string, unknown>;
  if (value instanceof Error) {
    source = { ...value, name: value.name, message: value.message, stack: value.stack };
  } else if (isPlainObject(value)) {
    source = candidate;
  } else {
    return `[${value.constructor?.name ?? "Object"}]`;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    result[key] = SECRET_KEY.test(key) ? REDACTED : redact(entry, depth + 1, seen);
  }
  return result;
}

const redactSecrets = winston.format((info) => {
  const seen = new WeakSet<object>();
  for (const key of Object.keys(info)) {
    info[key] = SECRET_KEY.test(key) ? REDACTED : redact(info[key], 0, seen);
  }
  return info;
});

/**
 * The log holds request metadata, so only its owner may read it. The mode of an existing file
 * is tightened too, since earlier versions created it world-readable.
 */
function ownerOnlyFile(file: string): void {
  fs.closeSync(fs.openSync(file, "a", 0o600));
  fs.chmodSync(file, 0o600);
}

export function createLogger(target: LoggerTarget): winston.Logger {
  const transports: winston.transport[] = [];
  if (target.file) {
    try {
      ownerOnlyFile(target.file);
      transports.push(new winston.transports.File({ filename: target.file }));
    } catch {
      // A log nobody can restrict is not written at all.
    }
  }
  if (target.stream) {
    transports.push(new winston.transports.Stream({ stream: target.stream }));
  }
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(redactSecrets(), winston.format.json()),
    transports,
  });
}
