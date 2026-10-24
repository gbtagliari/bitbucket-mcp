/**
 * Turns a failed Bitbucket call into a message that keeps what the caller needs to act on:
 * the HTTP status, the request, and the reason Bitbucket gave in the response body.
 */
import axios from "axios";

const BODY_EXCERPT_LENGTH = 300;

const bitbucketReason = (data: unknown): string | null => {
  if (typeof data === "string") {
    const text = data.trim();
    return text ? text.slice(0, BODY_EXCERPT_LENGTH) : null;
  }
  if (!data || typeof data !== "object") return null;

  const body = data as Record<string, any>;

  // Bitbucket Cloud: { type: "error", error: { message, detail, fields } }
  if (body.error && typeof body.error === "object") {
    const parts: string[] = [];
    if (body.error.message) parts.push(String(body.error.message));
    if (body.error.detail) {
      const detail =
        typeof body.error.detail === "string"
          ? body.error.detail
          : JSON.stringify(body.error.detail);
      parts.push(`detail: ${detail}`);
    }
    if (body.error.fields) {
      parts.push(`fields: ${JSON.stringify(body.error.fields)}`);
    }
    if (parts.length) return parts.join("; ");
  }

  // Bitbucket Server: { errors: [{ message }] }
  if (Array.isArray(body.errors)) {
    const messages = body.errors
      .map((entry: any) => entry?.message)
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }

  if (typeof body.message === "string" && body.message) return body.message;

  return JSON.stringify(body).slice(0, BODY_EXCERPT_LENGTH);
};

export function describeError(error: unknown): string {
  if (axios.isAxiosError(error) && error.response) {
    const method = (error.config?.method ?? "").toUpperCase();
    const url = error.config?.url ?? "";
    const request = method || url ? ` on ${[method, url].filter(Boolean).join(" ")}` : "";
    const reason = bitbucketReason(error.response.data) ?? error.message;
    return `HTTP ${error.response.status}${request}: ${reason}`;
  }
  return error instanceof Error ? error.message : String(error);
}
