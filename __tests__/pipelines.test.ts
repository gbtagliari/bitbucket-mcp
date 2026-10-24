import { PIPELINE_LIST_FIELDS, pipelineListParams } from "../src/pipelines.js";

describe("pipelineListParams", () => {
  it("projects each run onto its number, state, target and times, and keeps the paging keys", () => {
    expect(pipelineListParams({}).fields.split(",")).toEqual([
      "values.uuid",
      "values.build_number",
      "values.state.name",
      "values.state.result.name",
      "values.target.ref_name",
      "values.target.commit.hash",
      "values.created_on",
      "values.completed_on",
      "next",
      "page",
      "pagelen",
    ]);
    expect(pipelineListParams({}).fields).toBe(PIPELINE_LIST_FIELDS);
  });

  it("filters by branch through target.branch, which Bitbucket matches against target.ref_name", () => {
    expect(pipelineListParams({ target_branch: "packers", sort: "-created_on" })).toEqual({
      "target.branch": "packers",
      sort: "-created_on",
      fields: PIPELINE_LIST_FIELDS,
    });
  });

  it("passes status and trigger_type through", () => {
    expect(pipelineListParams({ status: "FAILED", trigger_type: "push" })).toMatchObject({
      status: "FAILED",
      trigger_type: "push",
    });
  });

  it("lets the caller's fields replace the default and still returns next", () => {
    expect(pipelineListParams({ fields: "values.build_number" }).fields).toBe(
      "values.build_number,next,page,pagelen"
    );
  });
});
