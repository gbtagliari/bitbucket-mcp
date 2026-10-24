import { listFields, pageFields } from "./fields.js";

/**
 * A run carries its repository, creator, trigger and links; a CI check reads the number, the
 * result, the branch and the commit. A pull request run has no `target.ref_name`.
 */
export const PIPELINE_LIST_FIELDS = pageFields([
  "uuid",
  "build_number",
  "state.name",
  "state.result.name",
  "target.ref_name",
  "target.commit.hash",
  "created_on",
  "completed_on",
]);

export interface PipelineListFilters {
  status?: string;
  target_branch?: string;
  trigger_type?: string;
  sort?: string;
  fields?: string;
}

/**
 * The pipelines endpoint ignores a `q` filter and returns every run, so the branch filter is
 * its own parameter, which Bitbucket matches against `target.ref_name`.
 */
export function pipelineListParams(filters: PipelineListFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.status) params.status = filters.status;
  if (filters.target_branch) params["target.branch"] = filters.target_branch;
  if (filters.trigger_type) params.trigger_type = filters.trigger_type;
  if (filters.sort) params.sort = filters.sort;
  params.fields = listFields(filters.fields, PIPELINE_LIST_FIELDS);
  return params;
}
