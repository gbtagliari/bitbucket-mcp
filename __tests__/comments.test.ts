import {
  COMMENT_LIST_FIELDS,
  commentListFields,
  publishSummary,
  withoutDeletedThreads,
} from "../src/comments.js";

describe("commentListFields", () => {
  it("projects each comment onto what a thread rebuild reads, and keeps the paging keys", () => {
    const fields = commentListFields().split(",");

    expect(fields).toEqual([
      "values.id",
      "values.parent.id",
      "values.inline.path",
      "values.inline.from",
      "values.inline.to",
      "values.resolution.type",
      "values.resolution.user.display_name",
      "values.resolution.user.uuid",
      "values.resolution.user.account_id",
      "values.resolution.created_on",
      "values.deleted",
      "values.pending",
      "values.user.display_name",
      "values.user.uuid",
      "values.user.account_id",
      "values.content.raw",
      "values.created_on",
      "values.links.html.href",
      "next",
      "page",
      "pagelen",
    ]);
    expect(COMMENT_LIST_FIELDS).toBe(fields.join(","));
  });

  it("keeps the keys the deleted-thread filter reads in a caller's fields", () => {
    expect(commentListFields("values.content.raw")).toBe(
      "values.content.raw,values.id,values.parent.id,values.deleted,next,page,pagelen"
    );
  });

  it("keeps relative fields as given", () => {
    expect(commentListFields("+values.content.html")).toBe("+values.content.html");
  });
});

describe("withoutDeletedThreads", () => {
  it("keeps live comments untouched", () => {
    const comments = [
      { id: 1, deleted: false },
      { id: 2, parent: { id: 1 } },
    ];

    expect(withoutDeletedThreads(comments)).toEqual(comments);
  });

  it("drops a deleted comment", () => {
    const comments = [
      { id: 1, deleted: false },
      { id: 2, deleted: true },
    ];

    expect(withoutDeletedThreads(comments).map((c) => c.id)).toEqual([1]);
  });

  it("drops replies below a deleted thread root", () => {
    const comments = [
      { id: 1, deleted: true },
      { id: 2, parent: { id: 1 } },
      { id: 3, parent: { id: 2 } },
      { id: 4, deleted: false },
    ];

    expect(withoutDeletedThreads(comments).map((c) => c.id)).toEqual([4]);
  });

  it("keeps a live thread whose reply was deleted", () => {
    const comments = [
      { id: 1, deleted: false },
      { id: 2, parent: { id: 1 }, deleted: true },
      { id: 3, parent: { id: 1 } },
    ];

    expect(withoutDeletedThreads(comments).map((c) => c.id)).toEqual([1, 3]);
  });

  it("keeps a reply whose parent is missing from the page", () => {
    const comments = [{ id: 2, parent: { id: 99 } }];

    expect(withoutDeletedThreads(comments).map((c) => c.id)).toEqual([2]);
  });

  it("does not loop on cyclic ancestry", () => {
    const comments = [
      { id: 1, parent: { id: 2 } },
      { id: 2, parent: { id: 1 } },
    ];

    expect(withoutDeletedThreads(comments).map((c) => c.id)).toEqual([1, 2]);
  });

  it("matches string and number comment ids", () => {
    const comments = [
      { id: 1, deleted: true },
      { id: 2, parent: { id: "1" } },
    ];

    expect(withoutDeletedThreads(comments)).toEqual([]);
  });

  it("returns a non-array input unchanged", () => {
    expect(withoutDeletedThreads(undefined as never)).toBeUndefined();
  });
});

describe("publishSummary", () => {
  it("reports a full publish", () => {
    expect(publishSummary(3, 3)).toBe("Published 3 of 3 pending comments");
  });

  it("flags the comments that failed to publish", () => {
    expect(publishSummary(2, 3)).toBe(
      "Published 2 of 3 pending comments; 1 failed, see results"
    );
  });
});
