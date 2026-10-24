/**
 * Helpers for Bitbucket pull request comment collections.
 */

import { PAGING_FIELDS, pageFields, userFields, withFields } from "./fields.js";

/**
 * What a thread rebuild reads: the parent chain, the inline anchor, who resolved it and the
 * raw text. A comment carries `resolution` only once its thread is resolved.
 */
export const COMMENT_LIST_FIELDS = pageFields([
  "id",
  "parent.id",
  "inline.path",
  "inline.from",
  "inline.to",
  "resolution.type",
  ...userFields("resolution.user"),
  "resolution.created_on",
  "deleted",
  "pending",
  ...userFields("user"),
  "content.raw",
  "created_on",
  "links.html.href",
]);

/** withoutDeletedThreads reads these keys, so a caller's whitelist keeps them. */
const THREAD_FIELDS = ["values.id", "values.parent.id", "values.deleted"];

export const commentListFields = (fields?: string): string =>
  fields ? withFields(fields, [...THREAD_FIELDS, ...PAGING_FIELDS]) : COMMENT_LIST_FIELDS;

type MaybeComment = {
  id?: number | string;
  deleted?: boolean;
  parent?: { id?: number | string };
};

const identifier = (value: unknown): string | null =>
  typeof value === "number" || typeof value === "string" ? String(value) : null;

const parentIdentifier = (comment: MaybeComment): string | null =>
  comment && comment.parent ? identifier(comment.parent.id) : null;

const isDeletedRoot = (comment: MaybeComment): boolean =>
  comment.deleted === true && parentIdentifier(comment) === null;

/**
 * Bitbucket keeps deleted comments in the comments collection with their content blanked
 * out, so an unfiltered list presents withdrawn feedback as if it were still live. Remove
 * deleted comments and every reply below a deleted thread root.
 *
 * Comments with unknown or cyclic ancestry are kept: only a proven deleted root drops a
 * thread, so a partial page can never hide live feedback.
 */
export function withoutDeletedThreads<T>(comments: T[]): T[] {
  if (!Array.isArray(comments)) return comments;

  const byIdentifier = new Map<string, MaybeComment>();
  for (const comment of comments as MaybeComment[]) {
    const id = comment ? identifier(comment.id) : null;
    if (id !== null) byIdentifier.set(id, comment);
  }

  const descendsFromDeletedRoot = (comment: MaybeComment): boolean => {
    const visited = new Set<string>();
    let current: MaybeComment | null = comment;
    while (current) {
      if (isDeletedRoot(current)) return true;
      const parent = parentIdentifier(current);
      if (parent === null || visited.has(parent)) return false;
      visited.add(parent);
      current = byIdentifier.get(parent) || null;
    }
    return false;
  };

  return (comments as MaybeComment[]).filter(
    (comment) =>
      comment && comment.deleted !== true && !descendsFromDeletedRoot(comment)
  ) as T[];
}

/**
 * A partial publish must not read as a full one: name the failures in the message itself.
 */
export function publishSummary(published: number, total: number): string {
  const summary = `Published ${published} of ${total} pending comments`;
  const failed = total - published;
  return failed > 0 ? `${summary}; ${failed} failed, see results` : summary;
}
