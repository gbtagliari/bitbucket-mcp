import type { AxiosInstance } from "axios";
import { listFields, pageFields, userFields } from "./fields.js";

/** What every reader of a pull request takes from it, in a list or alone. */
const PULL_REQUEST_SUMMARY_FIELDS = [
  "id",
  "title",
  "state",
  ...userFields("author"),
  ...userFields("reviewers"),
  "source.branch.name",
  "destination.branch.name",
  "source.commit.hash",
  "created_on",
  "updated_on",
  "links.html.href",
];

/**
 * The full pull request objects run to megabytes on a MERGED list, so the list returns only
 * what its consumers read.
 */
export const PULL_REQUEST_LIST_FIELDS = pageFields(PULL_REQUEST_SUMMARY_FIELDS);

/**
 * One pull request adds what a review reads: the description, who approved, and whether the
 * source branch closes on merge. The full object is about six times larger.
 */
export const PULL_REQUEST_FIELDS = [
  ...PULL_REQUEST_SUMMARY_FIELDS,
  "description",
  ...userFields("participants.user"),
  "participants.role",
  "participants.approved",
  "participants.state",
  "close_source_branch",
].join(",");

/** A single object has no paging keys, so a caller's fields go as given. */
export const pullRequestParams = (fields?: string): { fields: string } => ({
  fields: fields ?? PULL_REQUEST_FIELDS,
});

/**
 * An activity entry holds one of `comment`, `approval`, `changes_requested` or `update`, each
 * with the whole pull request and comment attached. A review reads who acted and when, so the
 * default is about a fifteenth of the full page.
 */
export const ACTIVITY_LIST_FIELDS = pageFields([
  "comment.id",
  "comment.created_on",
  ...userFields("comment.user"),
  "approval.date",
  ...userFields("approval.user"),
  "changes_requested.date",
  ...userFields("changes_requested.user"),
  "update.state",
  "update.date",
  ...userFields("update.author"),
]);

/**
 * A commit carries its repository, parents, links and the rendered message; a review reads
 * the hash, the date and who wrote it. The full page is about seven times larger.
 */
export const COMMIT_LIST_FIELDS = pageFields([
  "hash",
  "date",
  "message",
  ...userFields("author.user"),
]);

export const PULL_REQUEST_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"] as const;

export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

export interface PullRequestListFilters {
  state?: PullRequestState;
  q?: string;
  sort?: string;
  fields?: string;
}

export interface PullRequestListQuery extends PullRequestListFilters {
  next?: string;
}

const optionalString = (args: Record<string, unknown>, name: string) => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
};

const requiredString = (args: Record<string, unknown>, name: string) => {
  const value = optionalString(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const optionalBoolean = (args: Record<string, unknown>, name: string) => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
};

/**
 * The tool schema is advisory: the client may send anything. `state` is quoted into a BBQL
 * query, so it must be one of the states and nothing else.
 */
export function pullRequestListQuery(
  args: Record<string, unknown>
): PullRequestListQuery {
  const query: PullRequestListQuery = {};
  const state = optionalString(args, "state");
  if (state !== undefined) {
    if (!PULL_REQUEST_STATES.includes(state as PullRequestState)) {
      throw new Error(`state must be one of ${PULL_REQUEST_STATES.join(", ")}`);
    }
    query.state = state as PullRequestState;
  }
  for (const name of ["q", "sort", "fields", "next"] as const) {
    const value = optionalString(args, name);
    if (value !== undefined) query[name] = value;
  }
  return query;
}

export function pullRequestListParams(
  filters: PullRequestListFilters
): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.q) {
    // Bitbucket ignores the state parameter once q is set and matches every state.
    params.q = filters.state
      ? `state = "${filters.state}" AND (${filters.q})`
      : filters.q;
  } else if (filters.state) {
    params.state = filters.state;
  }
  if (filters.sort) params.sort = filters.sort;
  params.fields = listFields(filters.fields, PULL_REQUEST_LIST_FIELDS);
  return params;
}

/**
 * A `q` on a list field such as `reviewers.uuid` joins against it, so Bitbucket returns a pull
 * request once per matching row. Keep the first copy.
 */
export function uniquePullRequests<T extends { id?: unknown }>(values: T[]): T[] {
  const seen = new Set<unknown>();
  return values.filter((value) => {
    if (value?.id === undefined) return true;
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

/**
 * Bitbucket takes reviewers as `[{uuid}]`. A blank entry is dropped and a repeated one kept once.
 */
function reviewerList(value: unknown): Array<{ uuid: string }> {
  if (!Array.isArray(value) || value.some((uuid) => typeof uuid !== "string")) {
    throw new Error("reviewers must be a list of UUID strings");
  }
  const uuids = new Set(
    (value as string[]).map((uuid) => uuid.trim()).filter(Boolean)
  );
  return [...uuids].map((uuid) => ({ uuid }));
}

/**
 * The PUT body of updatePullRequest. Bitbucket keeps every field the body leaves out, and
 * `reviewers` replaces the whole list, so an empty list removes every reviewer.
 */
export function pullRequestUpdateBody(
  args: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const name of ["title", "description"] as const) {
    const value = optionalString(args, name);
    if (value !== undefined) body[name] = value;
  }
  if (args.reviewers !== undefined && args.reviewers !== null) {
    body.reviewers = reviewerList(args.reviewers);
  }
  const closeSourceBranch = optionalBoolean(args, "close_source_branch");
  if (closeSourceBranch !== undefined) body.close_source_branch = closeSourceBranch;
  return body;
}

/**
 * The POST body of createPullRequest. The source branch closes on merge unless the caller
 * passes `close_source_branch: false`, as before the parameter existed. An empty reviewer list
 * is sent as given: an omitted one lets the repository add its default reviewers.
 */
export function pullRequestCreateBody(
  args: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: requiredString(args, "title"),
    description: requiredString(args, "description"),
    source: { branch: { name: requiredString(args, "sourceBranch") } },
    destination: { branch: { name: requiredString(args, "targetBranch") } },
    close_source_branch: optionalBoolean(args, "close_source_branch") ?? true,
  };
  if (args.reviewers !== undefined && args.reviewers !== null) {
    body.reviewers = reviewerList(args.reviewers);
  }
  if (optionalBoolean(args, "draft") === true) body.draft = true;
  return body;
}

/**
 * PUT /pullrequests/{id} echoes its body, but Bitbucket saves the call only when it changes the
 * title, the description or the reviewers. A call that changes close_source_branch alone reads
 * as a success and leaves the field as it was, so the field is read back.
 */
export async function updatePullRequest(
  api: AxiosInstance,
  workspace: string,
  repo_slug: string,
  pull_request_id: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}`;
  const response = await api.put(path, body);
  if (body.close_source_branch === undefined) return response.data;
  const saved = await api.get(path, { params: { fields: "close_source_branch" } });
  if (saved.data?.close_source_branch !== body.close_source_branch) {
    throw new Error(
      "Bitbucket did not save close_source_branch: it saves the field only when the same call changes the title, the description or the reviewers"
    );
  }
  return response.data;
}
