import http from "http";
import type { AddressInfo } from "net";
import { createApiClient } from "../src/http.js";

type Seen = { path?: string; authorization?: string };

const listen = (handler: http.RequestListener, host: string) =>
  new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, host, () =>
      resolve({ server, port: (server.address() as AddressInfo).port })
    );
  });

describe("createApiClient", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise((done) => server.close(done)))
    );
  });

  it("keeps basic credentials across a same-host redirect", async () => {
    const seen: Seen[] = [];
    const { server, port } = await listen((req, res) => {
      seen.push({ path: req.url, authorization: req.headers.authorization });
      if (req.url === "/2.0/diffstat") {
        res.writeHead(302, { Location: "/2.0/diffstat/spec" }).end();
        return;
      }
      if (!req.headers.authorization) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ values: [] }));
    }, "127.0.0.1");
    servers.push(server);

    const api = createApiClient({
      baseUrl: `http://127.0.0.1:${port}/2.0`,
      username: "user",
      password: "secret",
    });
    const response = await api.get("/diffstat");

    const basic = `Basic ${Buffer.from("user:secret").toString("base64")}`;
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      { path: "/2.0/diffstat", authorization: basic },
      { path: "/2.0/diffstat/spec", authorization: basic },
    ]);
  });

  it("drops the credentials on a redirect to another host", async () => {
    const storage: Seen[] = [];
    const target = await listen((req, res) => {
      storage.push({ path: req.url, authorization: req.headers.authorization });
      res.writeHead(200, { "Content-Type": "text/plain" }).end("log");
    }, "127.0.0.1");
    servers.push(target.server);
    const origin = await listen((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${target.port}/log` }).end();
    }, "localhost");
    servers.push(origin.server);

    const api = createApiClient({
      baseUrl: `http://localhost:${origin.port}/2.0`,
      token: "token",
    });
    const response = await api.get("/steps/1/log", { responseType: "text" });

    expect(response.data).toBe("log");
    expect(storage).toEqual([{ path: "/log", authorization: undefined }]);
  });

  it("sends a bearer token", async () => {
    const seen: Seen[] = [];
    const { server, port } = await listen((req, res) => {
      seen.push({ authorization: req.headers.authorization });
      res.writeHead(200).end("{}");
    }, "127.0.0.1");
    servers.push(server);

    await createApiClient({ baseUrl: `http://127.0.0.1:${port}`, token: "t0k" }).get("/");

    expect(seen).toEqual([{ authorization: "Bearer t0k" }]);
  });
});
