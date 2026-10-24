import { isDangerousTool } from "../src/safety.js";

describe("isDangerousTool", () => {
  it("gates the tools that delete content", () => {
    expect(isDangerousTool("deletePullRequestComment")).toBe(true);
    expect(isDangerousTool("deletePullRequestTask")).toBe(true);
    expect(isDangerousTool("deleteAnything")).toBe(true);
  });

  it("leaves open the DELETEs that withdraw the caller's own review vote", () => {
    expect(isDangerousTool("unapprovePullRequest")).toBe(false);
    expect(isDangerousTool("removeChangeRequest")).toBe(false);
  });
});
