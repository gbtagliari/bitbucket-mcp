const PAGING_FIELDS = ["next", "page", "pagelen"];

const USER_FIELDS = ["display_name", "uuid", "account_id"];

/**
 * The full pull request objects run to megabytes on a MERGED list, so the list returns only
 * what its consumers read. Bitbucket drops every key a `fields` whitelist leaves out, so the
 * paging keys are listed too.
 */
export const PULL_REQUEST_LIST_FIELDS = [
  "values.id",
  "values.title",
  "values.state",
  ...USER_FIELDS.map((field) => `values.author.${field}`),
  ...USER_FIELDS.map((field) => `values.reviewers.${field}`),
  "values.source.branch.name",
  "values.destination.branch.name",
  "values.source.commit.hash",
  "values.created_on",
  "values.updated_on",
  "values.links.html.href",
  ...PAGING_FIELDS,
].join(",");

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

/**
 * A caller's whitelist would drop `next` and hide the later pages, so the paging keys are
 * added to it. Relative fields (`+x`, `-x`) build on Bitbucket's defaults, which keep them.
 */
const withPagingFields = (fields: string): string => {
  const entries = fields
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.some((entry) => entry.startsWith("+") || entry.startsWith("-"))) {
    return entries.join(",");
  }
  const missing = PAGING_FIELDS.filter((field) => !entries.includes(field));
  return [...entries, ...missing].join(",");
};

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
  params.fields = filters.fields
    ? withPagingFields(filters.fields)
    : PULL_REQUEST_LIST_FIELDS;
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
export function reviewerList(value: unknown): Array<{ uuid: string }> {
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
 * `reviewers` replaces the whole list. An empty list would remove every reviewer, so it is
 * refused.
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
    const reviewers = reviewerList(args.reviewers);
    if (reviewers.length === 0) {
      throw new Error("reviewers must list at least one UUID");
    }
    body.reviewers = reviewers;
  }
  return body;
}
