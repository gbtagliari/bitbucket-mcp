import http from "http";
import type { AddressInfo } from "net";
import { createApiClient } from "../src/http.js";
import { updatePullRequest } from "../src/pull-requests.js";

type Seen = { method?: string; path?: string; body: string };

describe("updatePullRequest", () => {
  let server: http.Server;
  let seen: Seen[];
  let stored: Record<string, unknown>;
  let api: ReturnType<typeof createApiClient>;

  // Mimics Bitbucket: the PUT echoes its body, but saves it only when the title, the
  // description or the reviewers change.
  beforeEach(async () => {
    seen = [];
    stored = { id: 7, title: "t", close_source_branch: true };
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        seen.push({ method: req.method, path: req.url, body: raw });
        if (req.method === "PUT") {
          const body = JSON.parse(raw);
          const echo = { ...stored, ...body };
          if (["title", "description", "reviewers"].some((key) => key in body)) {
            stored = echo;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(echo));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stored));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    api = createApiClient({ baseUrl: `http://127.0.0.1:${port}/2.0`, token: "t" });
  });

  afterEach(() => new Promise((done) => server.close(done)));

  const path = "/2.0/repositories/ws/repo/pullrequests/7";

  it("sends one PUT when close_source_branch is not in the body", async () => {
    const data = await updatePullRequest(api, "ws", "repo", "7", { title: "u" });

    expect(data).toMatchObject({ title: "u" });
    expect(seen).toEqual([{ method: "PUT", path, body: '{"title":"u"}' }]);
  });

  it("reads close_source_branch back and returns the PR when Bitbucket saved it", async () => {
    const data = await updatePullRequest(api, "ws", "repo", "7", {
      title: "u",
      close_source_branch: false,
    });

    expect(data).toMatchObject({ close_source_branch: false });
    expect(seen.map((request) => request.method)).toEqual(["PUT", "GET"]);
    expect(seen[1].path).toBe(`${path}?fields=close_source_branch`);
  });

  it("fails when Bitbucket echoed close_source_branch but did not save it", async () => {
    await expect(
      updatePullRequest(api, "ws", "repo", "7", { close_source_branch: false })
    ).rejects.toThrow(
      "Bitbucket did not save close_source_branch: it saves the field only when the same call changes the title, the description or the reviewers"
    );
  });
});
