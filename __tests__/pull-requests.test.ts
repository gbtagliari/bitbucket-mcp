import {
  PULL_REQUEST_LIST_FIELDS,
  pullRequestCreateBody,
  pullRequestListParams,
  pullRequestUpdateBody,
  pullRequestListQuery,
  uniquePullRequests,
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

describe("pullRequestListQuery", () => {
  it("reads the filters from the tool arguments", () => {
    expect(
      pullRequestListQuery({
        workspace: "ws",
        state: "MERGED",
        q: 'title ~ "x"',
        sort: "-updated_on",
        fields: "values.id",
        next: "https://api.bitbucket.org/2.0/x?page=2",
      })
    ).toEqual({
      state: "MERGED",
      q: 'title ~ "x"',
      sort: "-updated_on",
      fields: "values.id",
      next: "https://api.bitbucket.org/2.0/x?page=2",
    });
  });

  it("leaves out the filters the caller did not pass", () => {
    expect(pullRequestListQuery({ workspace: "ws" })).toEqual({});
  });

  it("rejects a state outside Bitbucket's pull request states", () => {
    expect(() => pullRequestListQuery({ state: 'OPEN" OR state = "MERGED' })).toThrow(
      "state must be one of OPEN, MERGED, DECLINED, SUPERSEDED"
    );
  });

  it("rejects a filter that is not a string", () => {
    expect(() => pullRequestListQuery({ q: 42 })).toThrow("q must be a string");
  });
});

describe("uniquePullRequests", () => {
  it("keeps the first copy of a pull request a reviewer query repeated", () => {
    expect(
      uniquePullRequests([
        { id: 3394, title: "a" },
        { id: 3394, title: "a" },
        { id: 3391, title: "b" },
        { id: 3394, title: "a" },
      ])
    ).toEqual([
      { id: 3394, title: "a" },
      { id: 3391, title: "b" },
    ]);
  });

  it("keeps entries without an id, as a fields selection may leave it out", () => {
    expect(uniquePullRequests([{ title: "a" }, { title: "a" }])).toEqual([
      { title: "a" },
      { title: "a" },
    ]);
  });
});

describe("pullRequestUpdateBody", () => {
  it("sends only the fields the caller passed", () => {
    expect(pullRequestUpdateBody({ workspace: "ws", title: "t" })).toEqual({ title: "t" });
    expect(pullRequestUpdateBody({ description: "" })).toEqual({ description: "" });
  });

  it("sends reviewers as the objects Bitbucket expects", () => {
    expect(
      pullRequestUpdateBody({ reviewers: [" {a-1} ", "{b-2}"] })
    ).toEqual({ reviewers: [{ uuid: "{a-1}" }, { uuid: "{b-2}" }] });
  });

  it("drops a blank or repeated reviewer", () => {
    expect(pullRequestUpdateBody({ reviewers: ["{a-1}", "  ", "{a-1}"] })).toEqual({
      reviewers: [{ uuid: "{a-1}" }],
    });
  });

  it("sends an empty reviewer list, which removes every reviewer", () => {
    expect(pullRequestUpdateBody({ reviewers: [] })).toEqual({ reviewers: [] });
    expect(pullRequestUpdateBody({ reviewers: [" "] })).toEqual({ reviewers: [] });
  });

  it("rejects reviewers that are not a list of strings", () => {
    expect(() => pullRequestUpdateBody({ reviewers: "{a-1}" })).toThrow(
      "reviewers must be a list of UUID strings"
    );
    expect(() => pullRequestUpdateBody({ reviewers: [42] })).toThrow(
      "reviewers must be a list of UUID strings"
    );
  });

  it("passes close_source_branch through", () => {
    expect(pullRequestUpdateBody({ close_source_branch: false })).toEqual({
      close_source_branch: false,
    });
  });

  it("rejects a close_source_branch that is not a boolean", () => {
    expect(() => pullRequestUpdateBody({ close_source_branch: "false" })).toThrow(
      "close_source_branch must be a boolean"
    );
  });

  it("rejects a title that is not a string", () => {
    expect(() => pullRequestUpdateBody({ title: 1 })).toThrow("title must be a string");
  });
});

describe("pullRequestCreateBody", () => {
  const required = {
    workspace: "ws",
    title: "t",
    description: "d",
    sourceBranch: "feature/x",
    targetBranch: "desenv",
  };

  it("builds the POST body and closes the source branch by default", () => {
    expect(pullRequestCreateBody(required)).toEqual({
      title: "t",
      description: "d",
      source: { branch: { name: "feature/x" } },
      destination: { branch: { name: "desenv" } },
      close_source_branch: true,
    });
  });

  it("keeps the source branch when close_source_branch is false", () => {
    expect(
      pullRequestCreateBody({ ...required, close_source_branch: false })
    ).toMatchObject({ close_source_branch: false });
  });

  it("adds reviewers and draft only when the caller asks for them", () => {
    const body = pullRequestCreateBody({
      ...required,
      reviewers: ["{a-1}"],
      draft: true,
    });
    expect(body).toMatchObject({ reviewers: [{ uuid: "{a-1}" }], draft: true });
    expect(pullRequestCreateBody({ ...required, draft: false })).not.toHaveProperty("draft");
    expect(pullRequestCreateBody(required)).not.toHaveProperty("reviewers");
  });

  it("sends an explicit empty reviewer list, since an omitted one lets the repo add its defaults", () => {
    expect(pullRequestCreateBody({ ...required, reviewers: [] })).toMatchObject({
      reviewers: [],
    });
  });

  it("rejects a missing required field", () => {
    const { sourceBranch: _omitted, ...rest } = required;
    expect(() => pullRequestCreateBody(rest)).toThrow("sourceBranch is required");
  });

  it("rejects a close_source_branch that is not a boolean", () => {
    expect(() => pullRequestCreateBody({ ...required, close_source_branch: 1 })).toThrow(
      "close_source_branch must be a boolean"
    );
  });
});
