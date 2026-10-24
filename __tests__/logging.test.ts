import fs from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import { AxiosError, AxiosHeaders } from "axios";
import { createLogger } from "../src/logging.js";

const PASSWORD = "app-password-s3cret";
const BASIC = `Basic ${Buffer.from(`user:${PASSWORD}`).toString("base64")}`;

const capture = () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = createLogger({ stream });
  const flushed = () => new Promise((resolve) => setImmediate(resolve));
  return { logger, lines, flushed };
};

const failedRequest = () => {
  const headers = new AxiosHeaders({ Authorization: BASIC });
  const config = {
    method: "get",
    url: "/repositories/ws/repo/pullrequests/1/diffstat",
    headers,
    auth: { username: "user", password: PASSWORD },
  };
  const request = {
    _header: `GET /2.0/x HTTP/1.1\r\nAuthorization: ${BASIC}\r\nHost: api.bitbucket.org\r\n\r\n`,
  };
  return new AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST", config, request, {
    status: 404,
    statusText: "Not Found",
    data: { error: { message: "Not found" } },
    headers: {},
    config,
  });
};

describe("createLogger", () => {
  it("keeps credentials out of a logged axios error", async () => {
    const { logger, lines, flushed } = capture();

    logger.error("Error getting diffstat", { error: failedRequest(), workspace: "ws" });
    await flushed();

    const written = lines.join("");
    expect(written).toContain("/repositories/ws/repo/pullrequests/1/diffstat");
    expect(written).toContain('"workspace":"ws"');
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain(BASIC.slice("Basic ".length));
  });

  it("keeps credentials out of an axios error passed as the metadata itself", async () => {
    const { logger, lines, flushed } = capture();

    logger.error("Error getting pending review PRs:", failedRequest());
    await flushed();

    const written = lines.join("");
    expect(written).toContain("Error getting pending review PRs:");
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain(BASIC.slice("Basic ".length));
  });

  it("keeps credentials out of plain metadata", async () => {
    const { logger, lines, flushed } = capture();

    logger.info("config", {
      token: "t0ken-value",
      nested: { password: PASSWORD, header: "Bearer t0ken-value" },
      pagelen: 10,
    });
    await flushed();

    const written = lines.join("");
    expect(written).toContain('"pagelen":10');
    expect(written).not.toContain("t0ken-value");
    expect(written).not.toContain(PASSWORD);
  });

  it("restricts the log file to its owner, also when it already exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbucket-mcp-log-"));
    const file = path.join(dir, "bitbucket.log");
    fs.writeFileSync(file, "", { mode: 0o644 });
    fs.chmodSync(file, 0o644);

    createLogger({ file }).close();

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
