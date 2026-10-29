import http from "http";
import type { AddressInfo } from "net";
import { createApiClient } from "../src/http.js";
import { BitbucketPaginator } from "../src/pagination.js";
import { deleteComment } from "../src/comments.js";
import {
  nothingPublished,
  parseCommentIds,
  publishDrafts,
  publishDraftsSummary,
} from "../src/drafts.js";

type Comment = {
  id: number;
  pending?: boolean;
  deleted?: boolean;
  user: { uuid: string };
  content: { raw: string };
  parent?: { id: number };
  inline?: { path: string; from?: number | null; to?: number | null; outdated?: boolean };
};

type Call = { method: string; path: string; body?: any };

const ME = { uuid: "{me}" };
const OTHER = { uuid: "{other}" };
const BASE = "/2.0/repositories/ws/repo/pullrequests/7";

const silentLogger = { debug: () => undefined } as any;

describe("drafts", () => {
  let server: http.Server;
  let calls: Call[];
  let comments: Comment[];
  let tasks: { id: number; comment?: { id: number } }[];
  let failPost: (body: any) => boolean;
  let failDelete: (id: number) => boolean;
  let nextId: number;
  let api: ReturnType<typeof createApiClient>;
  let paginator: BitbucketPaginator;

  const pr = { workspace: "ws", repo_slug: "repo", pull_request_id: "7" };
  let me: object;
  let failTasks: boolean;
  const publish = async (ids?: number[]) => (await publishDrafts(api, paginator, pr, ids)).rows;
  const posts = () => calls.filter((call) => call.method === "POST");
  const deletes = () => calls.filter((call) => call.method === "DELETE");

  beforeEach(async () => {
    calls = [];
    comments = [];
    tasks = [];
    failPost = () => false;
    failDelete = () => false;
    nextId = 900;
    me = ME;
    failTasks = false;
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const path = (req.url ?? "").split("?")[0];
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ method: req.method ?? "", path, body });
        const json = (status: number, data: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        };

        if (req.method === "GET" && path === "/2.0/user") return json(200, me);
        if (req.method === "GET" && path === `${BASE}/comments`) {
          return json(200, { values: comments, pagelen: 100 });
        }
        if (req.method === "GET" && path === `${BASE}/tasks`) {
          if (failTasks) return json(500, { type: "error", error: { message: "Boom" } });
          return json(200, { values: tasks, pagelen: 100 });
        }
        if (req.method === "POST" && path === `${BASE}/comments`) {
          if (failPost(body)) {
            return json(400, { type: "error", error: { message: "Bad request" } });
          }
          return json(201, { id: nextId++, ...body });
        }
        const match = path.match(new RegExp(`^${BASE}/comments/(\\d+)$`));
        if (req.method === "DELETE" && match) {
          const id = Number(match[1]);
          if (failDelete(id)) {
            return json(403, { type: "error", error: { message: "Forbidden" } });
          }
          if (!comments.some((comment) => comment.id === id)) {
            return json(404, { type: "error", error: { message: "No Comment" } });
          }
          // Bitbucket may take the replies with a deleted root.
          comments = comments.filter(
            (comment) => comment.id !== id && comment.parent?.id !== id
          );
          res.writeHead(204).end();
          return;
        }
        json(404, { type: "error", error: { message: "unexpected" } });
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    api = createApiClient({ baseUrl: `http://127.0.0.1:${port}/2.0`, token: "t" });
    paginator = new BitbucketPaginator(api, silentLogger);
  });

  afterEach(() => new Promise((done) => server.close(done)));

  describe("deleteComment", () => {
    it("sends a DELETE on the comment and resolves on 204", async () => {
      comments = [{ id: 5, user: ME, content: { raw: "x" } }];

      await deleteComment(api, pr, "5");

      expect(deletes()).toEqual([{ method: "DELETE", path: `${BASE}/comments/5` }]);
    });

    it("rejects with the HTTP status and Bitbucket's reason", async () => {
      await expect(deleteComment(api, pr, "5")).rejects.toMatchObject({
        response: { status: 404 },
      });
    });
  });

  describe("publishDrafts", () => {
    it("copies a general draft as a published comment, then deletes the draft", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "general" } }];

      const rows = await publish();

      expect(posts().map((call) => call.body)).toEqual([
        { content: { raw: "general" }, pending: false },
      ]);
      expect(deletes().map((call) => call.path)).toEqual([`${BASE}/comments/1`]);
      expect(rows).toEqual([{ draft_id: 1, new_id: 900, status: "published" }]);
    });

    it("keeps the line anchor of a root inline draft", async () => {
      comments = [
        {
          id: 1,
          pending: true,
          user: ME,
          content: { raw: "inline" },
          inline: { path: "a.ts", from: null, to: 12, outdated: false },
        },
      ];

      const rows = await publish();

      expect(posts()[0].body).toEqual({
        content: { raw: "inline" },
        pending: false,
        inline: { path: "a.ts", to: 12 },
      });
      expect(rows[0]).toMatchObject({ status: "published", anchor: "line" });
    });

    it("anchors an outdated inline draft at file level, since its line left the diff", async () => {
      comments = [
        {
          id: 1,
          pending: true,
          user: ME,
          content: { raw: "old" },
          inline: { path: "a.ts", from: 3, to: null, outdated: true },
        },
      ];

      const rows = await publish();

      expect(posts()[0].body).toEqual({
        content: { raw: "old" },
        pending: false,
        inline: { path: "a.ts" },
      });
      expect(rows[0]).toMatchObject({ status: "published", anchor: "file" });
    });

    it("posts a reply draft with its parent_id and no inline anchor", async () => {
      comments = [
        { id: 10, user: OTHER, content: { raw: "root" }, inline: { path: "a.ts", to: 4 } },
        { id: 11, pending: true, user: ME, content: { raw: "reply" }, parent: { id: 10 }, inline: { path: "a.ts", to: 4 } },
      ];

      await publish();

      expect(posts()[0].body).toEqual({
        content: { raw: "reply" },
        pending: false,
        parent: { id: 10 },
      });
    });

    it("publishes a draft root before its draft reply, and points the reply at the new root", async () => {
      comments = [
        { id: 21, pending: true, user: ME, content: { raw: "reply" }, parent: { id: 20 } },
        { id: 20, pending: true, user: ME, content: { raw: "root" } },
      ];

      const rows = await publish();

      expect(posts().map((call) => call.body.content.raw)).toEqual(["root", "reply"]);
      expect(posts()[1].body.parent).toEqual({ id: 900 });
      expect(rows.map((row) => [row.draft_id, row.new_id])).toEqual([
        [20, 900],
        [21, 901],
      ]);
    });

    it("skips a reply whose draft root failed to post", async () => {
      comments = [
        { id: 20, pending: true, user: ME, content: { raw: "root" } },
        { id: 21, pending: true, user: ME, content: { raw: "reply" }, parent: { id: 20 } },
      ];
      failPost = (body) => body.content.raw === "root";

      const rows = await publish();

      expect(posts()).toHaveLength(1);
      expect(rows[1]).toMatchObject({ draft_id: 21, status: "skipped" });
      expect(rows[1].error).toContain("20");
    });

    it("keeps the draft and deletes nothing when the post fails", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "x" } }];
      failPost = () => true;

      const rows = await publish();

      expect(deletes()).toEqual([]);
      expect(rows).toEqual([
        { draft_id: 1, status: "post_failed", error: expect.stringContaining("HTTP 400") },
      ]);
    });

    it("reports a duplicate risk with both ids when the delete fails, and does not post again", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "x" } }];
      failDelete = () => true;

      const rows = await publish();

      expect(posts()).toHaveLength(1);
      expect(rows).toEqual([
        {
          draft_id: 1,
          new_id: 900,
          status: "delete_failed",
          error: expect.stringContaining("HTTP 403"),
        },
      ]);
    });

    it("touches only the authenticated user's pending, undeleted drafts", async () => {
      comments = [
        { id: 1, pending: true, user: OTHER, content: { raw: "theirs" } },
        { id: 2, pending: false, user: ME, content: { raw: "published" } },
        { id: 3, pending: true, deleted: true, user: ME, content: { raw: "" } },
        { id: 4, pending: true, user: ME, content: { raw: "mine" } },
      ];

      const rows = await publish();

      expect(rows.map((row) => row.draft_id)).toEqual([4]);
    });

    it("publishes only the drafts named in comment_ids and reports the ids it cannot publish", async () => {
      comments = [
        { id: 1, pending: true, user: ME, content: { raw: "a" } },
        { id: 2, pending: true, user: ME, content: { raw: "b" } },
        { id: 3, pending: false, user: ME, content: { raw: "c" } },
      ];

      const rows = await publish([2, 3]);

      expect(posts().map((call) => call.body.content.raw)).toEqual(["b"]);
      expect(rows).toEqual([
        { draft_id: 2, new_id: 900, status: "published" },
        {
          draft_id: 3,
          status: "skipped",
          error: "Not a pending draft of the authenticated user",
        },
      ]);
    });

    it("skips a reply whose draft root is left out of comment_ids", async () => {
      comments = [
        { id: 20, pending: true, user: ME, content: { raw: "root" } },
        { id: 21, pending: true, user: ME, content: { raw: "reply" }, parent: { id: 20 } },
      ];

      const rows = await publish([21]);

      expect(posts()).toEqual([]);
      expect(rows[0]).toMatchObject({ draft_id: 21, status: "skipped" });
    });

    it("names the tasks attached to a draft, since the delete may drop them", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "x" } }];
      tasks = [{ id: 70, comment: { id: 1 } }, { id: 71, comment: { id: 99 } }, { id: 72 }];

      const rows = await publish();

      expect(rows[0]).toMatchObject({ status: "published", draft_task_ids: [70] });
    });

    it("deletes a draft reply before its draft root, so the root delete cannot take it", async () => {
      comments = [
        { id: 20, pending: true, user: ME, content: { raw: "root" } },
        { id: 21, pending: true, user: ME, content: { raw: "reply" }, parent: { id: 20 } },
      ];

      const rows = await publish();

      expect(deletes().map((call) => call.path)).toEqual([
        `${BASE}/comments/21`,
        `${BASE}/comments/20`,
      ]);
      expect(rows.map((row) => row.status)).toEqual(["published", "published"]);
    });

    it("fails loudly when /user does not identify the caller", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "x" } }];
      me = { display_name: "token" };

      await expect(publish()).rejects.toThrow("no uuid or account_id");
      expect(posts()).toEqual([]);
    });

    it("publishes anyway and reports why when the tasks cannot be read", async () => {
      comments = [{ id: 1, pending: true, user: ME, content: { raw: "x" } }];
      failTasks = true;

      const result = await publishDrafts(api, paginator, pr);

      expect(result.rows[0].status).toBe("published");
      expect(result.tasks_error).toContain("HTTP 500");
    });

    it("returns no rows and sends no write when there is no draft", async () => {
      comments = [{ id: 2, pending: false, user: ME, content: { raw: "published" } }];

      const rows = await publish();

      expect(rows).toEqual([]);
      expect(posts()).toEqual([]);
      expect(deletes()).toEqual([]);
    });
  });

  describe("parseCommentIds", () => {
    it("reads numbers and digit strings, and drops repeats", () => {
      expect(parseCommentIds(["2", 3, "2"])).toEqual([2, 3]);
    });

    it("leaves an omitted filter as none", () => {
      expect(parseCommentIds(undefined)).toBeUndefined();
    });

    it.each([[[]], [["abc"]], [[1.5]], ["12"], [[{}]]])("rejects %j", (ids) => {
      expect(() => parseCommentIds(ids)).toThrow("comment_ids must be");
    });
  });

  describe("publishDraftsSummary", () => {
    it("counts the published drafts and names the failures and the duplicate risks", () => {
      expect(
        publishDraftsSummary([
          { draft_id: 1, new_id: 9, status: "published" },
          { draft_id: 2, new_id: 10, status: "delete_failed", error: "e" },
          { draft_id: 3, status: "post_failed", error: "e" },
        ])
      ).toBe(
        "Published 1 of 3 pending comments; 2 failed, see results. " +
          "1 draft was posted but not deleted (duplicate risk): draft 2 -> comment 10"
      );
    });

    it("reads as a full publish only when every draft is published", () => {
      expect(publishDraftsSummary([{ draft_id: 1, new_id: 9, status: "published" }])).toBe(
        "Published 1 of 1 pending comments"
      );
    });
  });

  describe("nothingPublished", () => {
    it("is true when no copy was posted", () => {
      expect(
        nothingPublished([
          { draft_id: 1, status: "post_failed", error: "HTTP 400" },
          { draft_id: 2, status: "skipped", error: "Parent draft 1 was not published" },
        ])
      ).toBe(true);
    });

    it("is false when one copy was posted and the others failed", () => {
      expect(
        nothingPublished([
          { draft_id: 1, new_id: 9, status: "published" },
          { draft_id: 2, status: "post_failed", error: "HTTP 400" },
        ])
      ).toBe(false);
    });

    it("is false when a copy was posted but its draft was not deleted", () => {
      expect(
        nothingPublished([{ draft_id: 1, new_id: 9, status: "delete_failed", error: "HTTP 500" }])
      ).toBe(false);
    });

    it("is true when every id in comment_ids is not a draft", () => {
      expect(
        nothingPublished([
          { draft_id: 5, status: "skipped", error: "Not a pending draft of the authenticated user" },
        ])
      ).toBe(true);
    });

    it("is false when there is no row, since there was nothing to publish", () => {
      expect(nothingPublished([])).toBe(false);
    });
  });
});
