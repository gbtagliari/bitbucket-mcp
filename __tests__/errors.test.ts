import { AxiosError, AxiosHeaders } from "axios";
import { describeError } from "../src/errors.js";

const httpError = (
  status: number,
  data: unknown,
  method = "put",
  url = "/repositories/ws/repo/pullrequests/1/comments/2"
) => {
  const config = { method, url, headers: new AxiosHeaders() };
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    config,
    {},
    { status, statusText: "", data, headers: {}, config }
  );
};

describe("describeError", () => {
  it("carries the status, the request and Bitbucket Cloud's message and fields", () => {
    const error = httpError(400, {
      type: "error",
      error: {
        message: "Bad request",
        fields: { pending: "extra keys not allowed" },
      },
    });

    expect(describeError(error)).toBe(
      'HTTP 400 on PUT /repositories/ws/repo/pullrequests/1/comments/2: Bad request; fields: {"pending":"extra keys not allowed"}'
    );
  });

  it("carries Bitbucket Cloud's detail", () => {
    const error = httpError(
      409,
      {
        type: "error",
        error: { message: "Conflict", detail: "Comment is already resolved" },
      },
      "post",
      "/x"
    );

    expect(describeError(error)).toBe(
      "HTTP 409 on POST /x: Conflict; detail: Comment is already resolved"
    );
  });

  it("carries Bitbucket Server's error list", () => {
    const error = httpError(
      404,
      { errors: [{ message: "Repository does not exist" }, { message: "Other" }] },
      "get",
      "/y"
    );

    expect(describeError(error)).toBe(
      "HTTP 404 on GET /y: Repository does not exist; Other"
    );
  });

  it("keeps a short excerpt of a non-JSON body", () => {
    const error = httpError(502, "<html>" + "x".repeat(1000), "get", "/z");

    const described = describeError(error);
    expect(described.startsWith("HTTP 502 on GET /z: <html>xxx")).toBe(true);
    expect(described.length).toBeLessThan(400);
  });

  it("falls back to the axios message when the body is empty", () => {
    const error = httpError(404, "", "get", "/z");

    expect(describeError(error)).toBe(
      "HTTP 404 on GET /z: Request failed with status code 404"
    );
  });

  it("describes an axios error with no response", () => {
    const error = new AxiosError("connect ECONNREFUSED", "ECONNREFUSED");

    expect(describeError(error)).toBe("connect ECONNREFUSED");
  });

  it("describes a plain error and a non-error value", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("text")).toBe("text");
  });
});
