import http from "http";
import type { AddressInfo } from "net";
import { createApiClient } from "../src/http.js";
import { removeChangeRequest, requestChanges } from "../src/reviews.js";

type Seen = { method?: string; path?: string; type?: string; body: string };

describe("change requests", () => {
  let server: http.Server;
  let seen: Seen[];
  let api: ReturnType<typeof createApiClient>;

  beforeEach(async () => {
    seen = [];
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({
          method: req.method,
          path: req.url,
          type: req.headers["content-type"],
          body,
        });
        if (req.method === "DELETE") {
          res.writeHead(204).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ state: "changes_requested" }));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    api = createApiClient({ baseUrl: `http://127.0.0.1:${port}/2.0`, token: "t" });
  });

  afterEach(() => new Promise((done) => server.close(done)));

  it("requests changes with an empty JSON body, since a body-less POST gets a 400", async () => {
    const participant = await requestChanges(api, "ws", "repo", "7");

    expect(participant).toEqual({ state: "changes_requested" });
    expect(seen).toEqual([
      {
        method: "POST",
        path: "/2.0/repositories/ws/repo/pullrequests/7/request-changes",
        type: expect.stringContaining("application/json"),
        body: "{}",
      },
    ]);
  });

  it("removes the change request with a DELETE on the same path", async () => {
    await removeChangeRequest(api, "ws", "repo", "7");

    expect(seen).toEqual([
      expect.objectContaining({
        method: "DELETE",
        path: "/2.0/repositories/ws/repo/pullrequests/7/request-changes",
      }),
    ]);
  });
});
