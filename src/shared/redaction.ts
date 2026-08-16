const SECRET = "<redacted>";
const SAFE_ERROR = /[^\x20-\x7e]/g;
const URL = /https?:\/\/\S+/gi;
const BEARER = /\bBearer\s+[^\s,;]+/gi;
const API_KEY = /\bbl_[A-Za-z0-9_-]+/g;
const LEASE =
  /\b(?:lease(?:[_ -]?token)?|license(?:[_ -]?token)?)\s*[:=]\s*[^\s,;]+/gi;
const CREDENTIAL =
  /\b(?:authorization|api[_ -]?key|password|proxy[_ -]?password|username|proxy[_ -]?username)\b\s*[:=]\s*[^\s,;]+/gi;

export function redactString(value: string): string {
  return value
    .replace(BEARER, `Bearer ${SECRET}`)
    .replace(API_KEY, SECRET)
    .replace(LEASE, SECRET)
    .replace(CREDENTIAL, SECRET)
    .replace(URL, SECRET);
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const lower = key.toLowerCase();
        const secretKey = [
          "authorization",
          "api_key",
          "apikey",
          "password",
          "proxy_password",
          "username",
          "proxy_username",
          "lease",
          "lease_token",
          "license",
          "license_token",
        ].includes(lower);
        return [key, secretKey ? SECRET : redact(item)];
      }),
    );
  }
  return value;
}

export type RedactedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

export function serializeError(error: Error): RedactedError {
  const result: RedactedError = {
    name: error.name,
    message: redactString(error.message),
  };
  if (error.stack) result.stack = redactString(error.stack);
  if (error.cause !== undefined) result.cause = redact(error.cause);
  return result;
}

export function safeErrorMessage(value: string | Error): string {
  const message = typeof value === "string" ? value : value.message;
  const safe = redactString(message).replace(SAFE_ERROR, " ").trim();
  return safe.slice(0, 500) || "Lifecycle request could not be completed.";
}
