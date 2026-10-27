/**
 * Pending (draft) pull request comments. Bitbucket Cloud has no endpoint that publishes a
 * draft: PUT /comments/{id} rejects `pending`. A draft is published by posting a copy with
 * `pending: false` and then deleting the draft.
 */
import type { AxiosInstance } from "axios";
import { publishSummary } from "./comments.js";
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

export interface DraftTarget {
  workspace: string;
  repo_slug: string;
  pull_request_id: string;
  /** Publish only these drafts. Omitted: every draft of the authenticated user. */
  comment_ids?: (string | number)[];
}

const pullRequestPath = ({ workspace, repo_slug, pull_request_id }: DraftTarget) =>
  `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}`;

export async function deleteComment(
  api: AxiosInstance,
  workspace: string,
  repo_slug: string,
  pull_request_id: string,
  comment_id: string | number
): Promise<void> {
  await api.delete(
    `${pullRequestPath({ workspace, repo_slug, pull_request_id })}/comments/${comment_id}`
  );
}

const sameAccount = (a: Account | undefined, b: Account): boolean =>
  !!a &&
  ((!!a.uuid && a.uuid === b.uuid) || (!!a.account_id && a.account_id === b.account_id));

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

/** Tasks per draft id. Tasks are a side note, so a failed read leaves the map empty. */
async function tasksByComment(
  paginator: BitbucketPaginator,
  target: DraftTarget
): Promise<Map<number, number[]>> {
  const byComment = new Map<number, number[]>();
  try {
    const { values } = await paginator.fetchValues<{ id: number; comment?: { id?: number } }>(
      `${pullRequestPath(target)}/tasks`,
      { pagelen: BITBUCKET_MAX_PAGELEN, all: true, description: "publishPendingComments tasks" }
    );
    for (const task of values) {
      const commentId = task.comment?.id;
      if (commentId === undefined) continue;
      byComment.set(commentId, [...(byComment.get(commentId) ?? []), task.id]);
    }
  } catch {
    // The publish does not depend on tasks.
  }
  return byComment;
}

/**
 * Publish the authenticated user's drafts: post a copy of each, then delete the draft.
 * A failed post keeps the draft. A failed delete after a good post is a duplicate risk and is
 * reported with both ids; the post is never retried.
 */
export async function publishDrafts(
  api: AxiosInstance,
  paginator: BitbucketPaginator,
  target: DraftTarget
): Promise<DraftRow[]> {
  const me = (await api.get<Account>("/user")).data;
  const { values } = await paginator.fetchValues<Draft>(`${pullRequestPath(target)}/comments`, {
    pagelen: BITBUCKET_MAX_PAGELEN,
    all: true,
    description: "publishPendingComments",
  });
  const allDrafts = values.filter(
    (comment) => comment.pending === true && comment.deleted !== true && sameAccount(comment.user, me)
  );
  const draftIds = new Set(allDrafts.map((draft) => draft.id));

  const requested = target.comment_ids?.map(Number);
  const selected = requested
    ? allDrafts.filter((draft) => requested.includes(draft.id))
    : allDrafts;
  const selectedIds = new Set(selected.map((draft) => draft.id));
  const notDrafts: DraftRow[] = (requested ?? [])
    .filter((id) => !draftIds.has(id))
    .map((id) => ({
      draft_id: id,
      status: "skipped",
      error: "Not a pending draft of the authenticated user",
    }));

  if (!selected.length) return notDrafts;

  const tasks = await tasksByComment(paginator, target);
  const newIds = new Map<number, number>();
  const rows: DraftRow[] = [];

  for (const draft of parentsFirst(selected)) {
    const row: DraftRow = { draft_id: draft.id, status: "skipped" };
    const draftTasks = tasks.get(draft.id);
    const withTasks = (done: DraftRow): DraftRow =>
      draftTasks ? { ...done, draft_task_ids: draftTasks } : done;

    let parent = parentOf(draft);
    if (parent !== undefined && draftIds.has(parent)) {
      if (!selectedIds.has(parent)) {
        rows.push(
          withTasks({ ...row, error: `Parent ${parent} is a pending draft; publish it too` })
        );
        continue;
      }
      const published = newIds.get(parent);
      if (published === undefined) {
        rows.push(withTasks({ ...row, error: `Parent draft ${parent} was not published` }));
        continue;
      }
      parent = published;
    }

    const body: Record<string, unknown> = {
      content: { raw: draft.content?.raw ?? "" },
      pending: false,
    };
    if (parent !== undefined) {
      body.parent = { id: parent };
    } else if (draft.inline) {
      const { path, from, to, outdated } = draft.inline;
      row.anchor = outdated ? "file" : "line";
      body.inline = outdated
        ? { path }
        : {
            path,
            ...(from !== null && from !== undefined && { from }),
            ...(to !== null && to !== undefined && { to }),
          };
    }

    try {
      const posted = await api.post<{ id: number }>(`${pullRequestPath(target)}/comments`, body);
      row.new_id = posted.data.id;
      newIds.set(draft.id, row.new_id);
    } catch (error) {
      rows.push(withTasks({ ...row, status: "post_failed", error: describeError(error) }));
      continue;
    }

    try {
      await deleteComment(api, target.workspace, target.repo_slug, target.pull_request_id, draft.id);
      rows.push(withTasks({ ...row, status: "published" }));
    } catch (error) {
      rows.push(withTasks({ ...row, status: "delete_failed", error: describeError(error) }));
    }
  }

  return [...rows, ...notDrafts];
}

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
