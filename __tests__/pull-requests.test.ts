import {
  PULL_REQUEST_LIST_FIELDS,
  pullRequestListParams,
} from "../src/pull-requests.js";

describe("pullRequestListParams", () => {
  it("projects the list onto the default fields and keeps the paging keys", () => {
    const fields = pullRequestListParams({}).fields.split(",");

    expect(fields).toEqual(
      expect.arrayContaining([
        "values.id",
        "values.title",
        "values.state",
        "values.author.display_name",
        "values.author.uuid",
        "values.author.account_id",
        "values.reviewers.display_name",
        "values.reviewers.uuid",
        "values.reviewers.account_id",
        "values.source.branch.name",
        "values.destination.branch.name",
        "values.source.commit.hash",
        "values.created_on",
        "values.updated_on",
        "values.links.html.href",
        "next",
        "page",
        "pagelen",
      ])
    );
    expect(fields).toHaveLength(18);
    expect(PULL_REQUEST_LIST_FIELDS).toBe(fields.join(","));
  });

  it("passes state and sort through", () => {
    expect(pullRequestListParams({ state: "MERGED", sort: "-updated_on" })).toEqual({
      state: "MERGED",
      sort: "-updated_on",
      fields: PULL_REQUEST_LIST_FIELDS,
    });
  });

  it("passes q through, which Bitbucket matches against every state", () => {
    expect(pullRequestListParams({ q: 'source.branch.name ~ "ED-1234-"' })).toEqual({
      q: 'source.branch.name ~ "ED-1234-"',
      fields: PULL_REQUEST_LIST_FIELDS,
    });
  });

  it("folds state into q, because Bitbucket ignores the state parameter once q is set", () => {
    expect(
      pullRequestListParams({
        state: "MERGED",
        q: 'source.branch.name ~ "ED-1234-" OR title ~ "ED-1234"',
      })
    ).toEqual({
      q: 'state = "MERGED" AND (source.branch.name ~ "ED-1234-" OR title ~ "ED-1234")',
      fields: PULL_REQUEST_LIST_FIELDS,
    });
  });

  it("lets the caller's fields override the default and still returns next", () => {
    expect(pullRequestListParams({ fields: "values.id,values.title" }).fields).toBe(
      "values.id,values.title,next,page,pagelen"
    );
  });

  it("does not repeat a paging key the caller already asked for", () => {
    expect(pullRequestListParams({ fields: "values.id, next" }).fields).toBe(
      "values.id,next,page,pagelen"
    );
  });

  it("keeps relative fields as given, since Bitbucket's defaults already carry next", () => {
    expect(pullRequestListParams({ fields: "+values.participants" }).fields).toBe(
      "+values.participants"
    );
  });
});
