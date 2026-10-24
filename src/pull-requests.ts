/**
 * Request shaping for the pull request list.
 */

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

export interface PullRequestListFilters {
  state?: string;
  q?: string;
  sort?: string;
  fields?: string;
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
