import {
  fieldsArgument,
  listFields,
  pageFields,
  userFields,
  withFields,
} from "../src/fields.js";

describe("userFields", () => {
  it("keeps the three ids of a user object under the given path", () => {
    expect(userFields("author")).toEqual([
      "author.display_name",
      "author.uuid",
      "author.account_id",
    ]);
  });
});

describe("pageFields", () => {
  it("prefixes each field with values. and adds the paging keys", () => {
    expect(pageFields(["id", "user.uuid"])).toBe("values.id,values.user.uuid,next,page,pagelen");
  });
});

describe("withFields", () => {
  it("adds the required keys the caller left out, once", () => {
    expect(withFields("values.id, next", ["next", "page"])).toBe("values.id,next,page");
  });

  it("keeps relative fields as given, since Bitbucket's defaults already carry every key", () => {
    expect(withFields("+values.participants", ["next"])).toBe("+values.participants");
    expect(withFields("-values.links", ["next"])).toBe("-values.links");
  });

  it("drops a relative entry that would remove a required key or its parent", () => {
    expect(withFields("-values.deleted,-values.links", ["values.deleted"])).toBe("-values.links");
    expect(withFields("-values.parent", ["values.parent.id"])).toBe("");
    expect(withFields("-next", ["next"])).toBe("");
  });

  it("adds the required keys when absolute and relative entries are mixed", () => {
    expect(withFields("values.id,+values.title", ["next"])).toBe("values.id,+values.title,next");
  });
});

describe("listFields", () => {
  it("returns the default projection when the caller passed no fields", () => {
    expect(listFields(undefined, "values.id,next,page,pagelen")).toBe(
      "values.id,next,page,pagelen"
    );
  });

  it("lets the caller's fields replace the default and still returns next", () => {
    expect(listFields("values.hash", "values.id,next,page,pagelen")).toBe(
      "values.hash,next,page,pagelen"
    );
  });
});

describe("fieldsArgument", () => {
  it("reads fields from the tool arguments", () => {
    expect(fieldsArgument({ fields: "id,title" })).toBe("id,title");
  });

  it("treats a missing or blank fields as the default projection", () => {
    expect(fieldsArgument({})).toBeUndefined();
    expect(fieldsArgument({ fields: null })).toBeUndefined();
    expect(fieldsArgument({ fields: "  " })).toBeUndefined();
  });

  it("rejects fields that is not a string", () => {
    expect(() => fieldsArgument({ fields: ["id"] })).toThrow("fields must be a string");
  });
});
