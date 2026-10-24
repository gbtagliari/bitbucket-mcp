import type { AxiosInstance } from "axios";

const DANGEROUS_TOOL_NAMES = new Set<string>([
  "deletePullRequestComment",
  "deletePullRequestTask",
]);

/**
 * A dangerous tool deletes content, so it stays off until BITBUCKET_ENABLE_DANGEROUS is set.
 * unapprovePullRequest and removeChangeRequest send DELETE too, but they only withdraw the
 * caller's own vote, which the caller can cast again.
 */
export function isDangerousTool(name: string): boolean {
  return DANGEROUS_TOOL_NAMES.has(name) || /^delete/i.test(name);
}

const changeRequestPath = (
  workspace: string,
  repo_slug: string,
  pull_request_id: string
) =>
  `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/request-changes`;

/** Bitbucket answers a body-less POST with a 400, so the body is `{}`. */
export async function requestChanges(
  api: AxiosInstance,
  workspace: string,
  repo_slug: string,
  pull_request_id: string
): Promise<unknown> {
  const response = await api.post(
    changeRequestPath(workspace, repo_slug, pull_request_id),
    {}
  );
  return response.data;
}

export async function removeChangeRequest(
  api: AxiosInstance,
  workspace: string,
  repo_slug: string,
  pull_request_id: string
): Promise<void> {
  await api.delete(changeRequestPath(workspace, repo_slug, pull_request_id));
}
