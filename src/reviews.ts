import type { AxiosInstance } from "axios";

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
