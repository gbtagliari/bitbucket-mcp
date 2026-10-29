/**
 * Pending (draft) pull request comments. Bitbucket Cloud has no endpoint that publishes a
 * draft: PUT /comments/{id} rejects `pending`. A draft is published by posting a copy with
 * `pending: false` and then deleting the draft.
 */
import type { AxiosInstance } from "axios";
import { deleteComment, publishSummary, pullRequestPath, type PullRequestRef } from "./comments.js";
import { describeError } from "./errors.js";
import { BITBUCKET_MAX_PAGELEN, type BitbucketPaginator } from "./pagination.js";

type Account = { uuid?: string; account_id?: string };

type Draft = {
  id: number;
  pending?: boolean;
  deleted?: boolean;
  user?: Account;
  content?: { raw?: string };
  parent?: { id?: number };
  inline?: { path: string; from?: number | null; to?: number | null; outdated?: boolean };
};

export type DraftStatus = "published" | "post_failed" | "delete_failed" | "skipped";

export interface DraftRow {
  draft_id: number;
  new_id?: number;
  status: DraftStatus;
  /** A root inline draft keeps its line, or falls back to its file when the line is outdated. */
  anchor?: "line" | "file";
  /** Tasks on the draft. The delete may drop them, so the caller can recreate them. */
  draft_task_ids?: number[];
  error?: string;
}

export interface DraftPublish {
  rows: DraftRow[];
  /** Set when the task list could not be read, so draft_task_ids may be missing. */
  tasks_error?: string;
}

/** Each id must be a positive integer, as a number or a string of digits. */
export function parseCommentIds(ids: unknown): number[] | undefined {
  if (ids === undefined || ids === null) return undefined;
  const valid =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.every((id) => (typeof id === "number" || typeof id === "string") && /^\d+$/.test(String(id)));
  if (!valid) {
    throw new Error(
      "comment_ids must be a non-empty array of comment ids; omit it to publish every draft"
    );
  }
  return [...new Set(ids.map(Number))];
}

const sameAccount = (a: Account | undefined, b: Account): boolean =>
  !!a &&
  ((!!a.uuid && a.uuid === b.uuid) || (!!a.account_id && a.account_id === b.account_id));

async function currentAccount(api: AxiosInstance): Promise<Account> {
  const me = (await api.get<Account>("/user")).data;
  if (!me?.uuid && !me?.account_id) {
    throw new Error(
      "GET /user returned no uuid or account_id, so the drafts of the authenticated user cannot be told apart"
    );
  }
  return me;
}

const parentOf = (draft: Draft): number | undefined => draft.parent?.id;

/** Roots first: a draft comes after its parent when the parent is a draft in the same run. */
function parentsFirst(drafts: Draft[]): Draft[] {
  const ids = new Set(drafts.map((draft) => draft.id));
  const ordered: Draft[] = [];
  const placed = new Set<number>();
  let remaining = drafts;
  while (remaining.length) {
    const ready = remaining.filter((draft) => {
      const parent = parentOf(draft);
      return parent === undefined || !ids.has(parent) || placed.has(parent);
    });
    // A cycle cannot come from Bitbucket; keep the rest in order rather than loop.
    const batch = ready.length ? ready : remaining;
    for (const draft of batch) {
      ordered.push(draft);
      placed.add(draft.id);
    }
    remaining = remaining.filter((draft) => !placed.has(draft.id));
  }
  return ordered;
}

async function tasksByComment(
  paginator: BitbucketPaginator,
  pr: PullRequestRef
): Promise<{ byComment: Map<number, number[]>; error?: string }> {
  const byComment = new Map<number, number[]>();
  try {
    const { values } = await paginator.fetchValues<{ id: number; comment?: { id?: number } }>(
      `${pullRequestPath(pr)}/tasks`,
      { pagelen: BITBUCKET_MAX_PAGELEN, all: true, description: "publishPendingComments tasks" }
    );
    for (const task of values) {
      const commentId = task.comment?.id;
      if (commentId === undefined) continue;
      byComment.set(commentId, [...(byComment.get(commentId) ?? []), task.id]);
    }
    return { byComment };
  } catch (error) {
    // Tasks are a side note: the publish goes on and the caller sees why they are missing.
    return { byComment, error: describeError(error) };
  }
}

/** The copy keeps the text and the anchor: the parent for a reply, else the inline position. */
function copyOf(draft: Draft, parent: number | undefined) {
  const base = { content: { raw: draft.content?.raw ?? "" }, pending: false };
  if (parent !== undefined) return { body: { ...base, parent: { id: parent } } };
  if (!draft.inline) return { body: base };
  const { path, from, to, outdated } = draft.inline;
  if (outdated) return { body: { ...base, inline: { path } }, anchor: "file" as const };
  const inline = {
    path,
    ...(from !== null && from !== undefined && { from }),
    ...(to !== null && to !== undefined && { to }),
  };
  return { body: { ...base, inline }, anchor: "line" as const };
}

/**
 * Post the copies, roots first, so a draft reply points at its root's new id. A failed post
 * keeps the draft and skips the draft replies below it.
 */
async function postCopies(
  api: AxiosInstance,
  pr: PullRequestRef,
  drafts: Draft[],
  draftIds: Set<number>
): Promise<DraftRow[]> {
  const selectedIds = new Set(drafts.map((draft) => draft.id));
  const newIds = new Map<number, number>();
  const rows: DraftRow[] = [];

  for (const draft of parentsFirst(drafts)) {
    const skip = (error: string): DraftRow => ({ draft_id: draft.id, status: "skipped", error });
    let parent = parentOf(draft);
    if (parent !== undefined && draftIds.has(parent)) {
      if (!selectedIds.has(parent)) {
        rows.push(skip(`Parent ${parent} is a pending draft; publish it too`));
        continue;
      }
      parent = newIds.get(parent);
      if (parent === undefined) {
        rows.push(skip(`Parent draft ${parentOf(draft)} was not published`));
        continue;
      }
    }

    const { body, anchor } = copyOf(draft, parent);
    const row: DraftRow = { draft_id: draft.id, status: "skipped", ...(anchor && { anchor }) };
    try {
      const posted = await api.post<{ id: number }>(`${pullRequestPath(pr)}/comments`, body);
      newIds.set(draft.id, posted.data.id);
      rows.push({ ...row, new_id: posted.data.id, status: "published" });
    } catch (error) {
      rows.push({ ...row, status: "post_failed", error: describeError(error) });
    }
  }
  return rows;
}

/**
 * Delete the drafts whose copy was posted, replies before their roots, so a root delete never
 * takes a reply that still has to be deleted on its own.
 */
async function deleteDrafts(
  api: AxiosInstance,
  pr: PullRequestRef,
  rows: DraftRow[]
): Promise<DraftRow[]> {
  const done = new Map<number, DraftRow>();
  for (const row of [...rows].reverse()) {
    if (row.status !== "published") continue;
    try {
      await deleteComment(api, pr, row.draft_id);
    } catch (error) {
      done.set(row.draft_id, { ...row, status: "delete_failed", error: describeError(error) });
    }
  }
  return rows.map((row) => done.get(row.draft_id) ?? row);
}

/**
 * Publish the authenticated user's drafts: post a copy of each, then delete the draft.
 * A failed delete after a good post is a duplicate risk, reported with both ids; the post is
 * never retried.
 */
export async function publishDrafts(
  api: AxiosInstance,
  paginator: BitbucketPaginator,
  pr: PullRequestRef,
  comment_ids?: number[]
): Promise<DraftPublish> {
  const me = await currentAccount(api);
  const { values } = await paginator.fetchValues<Draft>(`${pullRequestPath(pr)}/comments`, {
    pagelen: BITBUCKET_MAX_PAGELEN,
    all: true,
    description: "publishPendingComments",
  });
  const drafts = values.filter(
    (comment) => comment.pending === true && comment.deleted !== true && sameAccount(comment.user, me)
  );
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const selected = comment_ids ? drafts.filter((draft) => comment_ids.includes(draft.id)) : drafts;
  const notDrafts: DraftRow[] = (comment_ids ?? [])
    .filter((id) => !draftIds.has(id))
    .map((id) => ({
      draft_id: id,
      status: "skipped",
      error: "Not a pending draft of the authenticated user",
    }));

  if (!selected.length) return { rows: notDrafts };

  const tasks = await tasksByComment(paginator, pr);
  const posted = await postCopies(api, pr, selected, draftIds);
  const rows = (await deleteDrafts(api, pr, posted)).map((row) => {
    const taskIds = tasks.byComment.get(row.draft_id);
    return taskIds ? { ...row, draft_task_ids: taskIds } : row;
  });
  return {
    rows: [...rows, ...notDrafts],
    ...(tasks.error && { tasks_error: tasks.error }),
  };
}

/** No copy was posted, so every draft is still pending: the caller must get an error. */
export const nothingPublished = (rows: DraftRow[]): boolean =>
  !rows.some((row) => row.new_id !== undefined);

/**
 * A partial publish must not read as a full one, and a posted-but-undeleted draft must show
 * both ids so the caller can remove the duplicate.
 */
export function publishDraftsSummary(rows: DraftRow[]): string {
  const published = rows.filter((row) => row.status === "published").length;
  const summary = publishSummary(published, rows.length);
  const duplicates = rows.filter((row) => row.status === "delete_failed");
  if (!duplicates.length) return summary;
  const pairs = duplicates
    .map((row) => `draft ${row.draft_id} -> comment ${row.new_id}`)
    .join(", ");
  const noun = duplicates.length === 1 ? "draft was" : "drafts were";
  return `${summary}. ${duplicates.length} ${noun} posted but not deleted (duplicate risk): ${pairs}`;
}
