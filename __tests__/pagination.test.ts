import { jest } from "@jest/globals";
import type { AxiosInstance } from "axios";
import {
  BitbucketPaginator,
  BITBUCKET_MAX_PAGELEN,
  BITBUCKET_PULL_REQUEST_MAX_PAGELEN,
  paginationSchema,
  toPage,
} from "../src/pagination.js";

const createMockAxios = () => {
  return {
    get: jest.fn(),
    defaults: { baseURL: "https://api.bitbucket.org/2.0" },
  } as unknown as AxiosInstance & { get: jest.Mock };
};

const createMockLogger = () => ({
  debug: jest.fn(),
}) as any;

describe("BitbucketPaginator", () => {
  it("respects pagelen and page arguments", async () => {
    const axios = createMockAxios();
    const logger = createMockLogger();
    const paginator = new BitbucketPaginator(axios, logger);

    (axios.get as any).mockResolvedValue({
      data: { values: [{ id: 1 }], page: 1, pagelen: 1 },
    });

    const result = await paginator.fetchValues("/test", {
      pagelen: 1,
      page: 1,
      description: "unit",
    });

    expect(axios.get).toHaveBeenCalledWith("/test", {
      params: { pagelen: 1, page: 1 },
    });
    expect(result.values).toHaveLength(1);
    expect(result.page).toBe(1);
  });

  it("caps pagelen to Bitbucket maximum", async () => {
    const axios = createMockAxios();
    const logger = createMockLogger();
    const paginator = new BitbucketPaginator(axios, logger);

    (axios.get as any).mockResolvedValue({
      data: { values: [], pagelen: BITBUCKET_MAX_PAGELEN },
    });

    await paginator.fetchValues("/test", { pagelen: BITBUCKET_MAX_PAGELEN + 25 });

    expect(axios.get).toHaveBeenCalledWith("/test", {
      params: { pagelen: BITBUCKET_MAX_PAGELEN },
    });
  });

  it("caps pagelen to the endpoint's own maximum, since Bitbucket answers a larger one with 400", async () => {
    const axios = createMockAxios();
    const paginator = new BitbucketPaginator(axios, createMockLogger());

    (axios.get as any).mockResolvedValue({ data: { values: [], pagelen: 50 } });

    await paginator.fetchValues("/test", {
      pagelen: 100,
      maxPagelen: BITBUCKET_PULL_REQUEST_MAX_PAGELEN,
    });

    expect(axios.get).toHaveBeenCalledWith("/test", { params: { pagelen: 50 } });
  });

  it("follows next links when all=true", async () => {
    const axios = createMockAxios();
    const logger = createMockLogger();
    const paginator = new BitbucketPaginator(axios, logger);

    (axios.get as any)
      .mockResolvedValueOnce({
        data: {
          values: [{ id: 1 }],
          next: "https://api.bitbucket.org/2.0/test?page=2",
        },
      })
      .mockResolvedValueOnce({ data: { values: [{ id: 2 }] } });

    const result = await paginator.fetchValues<{ id: number }>("/test", {
      all: true,
    });

    expect(axios.get).toHaveBeenNthCalledWith(1, "/test", {
      params: { pagelen: 10 },
    });
    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      "https://api.bitbucket.org/2.0/test?page=2",
      undefined
    );
    expect(result.values.map((item) => item.id)).toEqual([1, 2]);
    expect(result.fetchedPages).toBe(2);
    expect(result.totalFetched).toBe(2);
  });
});

describe("toPage", () => {
  it("returns the values with the link to the next page", () => {
    const page = toPage({
      values: [{ id: 1 }],
      page: 1,
      pagelen: 10,
      next: "https://api.bitbucket.org/2.0/test?page=2",
      fetchedPages: 1,
      totalFetched: 1,
    });

    expect(page).toEqual({
      values: [{ id: 1 }],
      page: 1,
      pagelen: 10,
      next: "https://api.bitbucket.org/2.0/test?page=2",
    });
  });

  it("omits next on the last page", () => {
    const page = toPage({
      values: [],
      page: 3,
      pagelen: 10,
      fetchedPages: 1,
      totalFetched: 0,
    });

    expect(JSON.parse(JSON.stringify(page))).toEqual({
      values: [],
      page: 3,
      pagelen: 10,
    });
  });

  it("takes values the caller already filtered", () => {
    const page = toPage(
      { values: [{ id: 1 }, { id: 2 }], pagelen: 10, fetchedPages: 1, totalFetched: 2 },
      [{ id: 2 }]
    );

    expect(page.values).toEqual([{ id: 2 }]);
  });
});

describe("BitbucketPaginator next link", () => {
  it("fetches the next link as given", async () => {
    const axios = createMockAxios();
    const paginator = new BitbucketPaginator(axios, createMockLogger());
    const next =
      "https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2&q=state%3D%22OPEN%22";
    (axios.get as any).mockResolvedValue({ data: { values: [{ id: 3 }], page: 2 } });

    const result = await paginator.fetchValues("/ignored", {
      next,
      params: { q: "ignored" },
    });

    expect(axios.get).toHaveBeenCalledWith(next, undefined);
    expect(result.values).toEqual([{ id: 3 }]);
    expect(result.page).toBe(2);
  });

  it("refuses a next link outside the configured API", async () => {
    const axios = createMockAxios();
    const paginator = new BitbucketPaginator(axios, createMockLogger());

    await expect(
      paginator.fetchValues("/ignored", {
        next: "https://evil.example/2.0/repositories?page=2",
      })
    ).rejects.toThrow("next must be a link returned by the Bitbucket API");
    await expect(
      paginator.fetchValues("/ignored", {
        next: "https://api.bitbucket.org.evil.example/2.0/x",
      })
    ).rejects.toThrow("next must be a link returned by the Bitbucket API");
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("accepts a next link whose host differs only in letter case", async () => {
    const axios = createMockAxios();
    (axios as any).defaults.baseURL = "https://API.bitbucket.org/2.0/";
    const paginator = new BitbucketPaginator(axios, createMockLogger());
    const next = "https://api.bitbucket.org/2.0/x?page=2";
    (axios.get as any).mockResolvedValue({ data: { values: [] } });

    await paginator.fetchValues("/x", { next });

    expect(axios.get).toHaveBeenCalledWith(next, undefined);
  });

  it("refuses a next link on the right host under another path", async () => {
    const axios = createMockAxios();
    const paginator = new BitbucketPaginator(axios, createMockLogger());

    await expect(
      paginator.fetchValues("/x", { next: "https://api.bitbucket.org/2.0evil/x" })
    ).rejects.toThrow("next must be a link returned by the Bitbucket API");
    await expect(
      paginator.fetchValues("/x", { next: "https://u:p@api.bitbucket.org/2.0/x" })
    ).rejects.toThrow("next must be a link returned by the Bitbucket API");
  });

  it("stops following pages when a response links outside the configured API", async () => {
    const axios = createMockAxios();
    const paginator = new BitbucketPaginator(axios, createMockLogger());
    (axios.get as any).mockResolvedValueOnce({
      data: { values: [{ id: 1 }], next: "https://evil.example/2.0/x?page=2" },
    });

    await expect(paginator.fetchValues("/x", { all: true })).rejects.toThrow(
      "next must be a link returned by the Bitbucket API"
    );
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});

describe("paginationSchema", () => {
  it("states the endpoint's pagelen cap", () => {
    const { pagelen, page } = paginationSchema(BITBUCKET_PULL_REQUEST_MAX_PAGELEN);

    expect(pagelen).toMatchObject({ type: "number", minimum: 1, maximum: 50 });
    expect(pagelen.description).toContain("caps at 50 on this endpoint");
    expect(page).toMatchObject({ type: "number", minimum: 1 });
  });

  it("defaults to Bitbucket's general cap", () => {
    expect(paginationSchema().pagelen).toMatchObject({ maximum: BITBUCKET_MAX_PAGELEN });
    expect(paginationSchema().pagelen.description).toContain(
      `caps at ${BITBUCKET_MAX_PAGELEN} on this endpoint`
    );
  });
});
