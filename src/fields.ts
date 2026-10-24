/**
 * Bitbucket's partial-response selectors (the `fields` query parameter). A whitelist drops
 * every key it leaves out, `next` included.
 */

export const PAGING_FIELDS = ["next", "page", "pagelen"];

const USER_FIELDS = ["display_name", "uuid", "account_id"];

/** A user object keeps the name to show and the two ids the API takes. */
export const userFields = (path: string): string[] =>
  USER_FIELDS.map((field) => `${path}.${field}`);

/** The fields of a page whose `values` hold the given fields, paging keys included. */
export const pageFields = (fields: string[]): string =>
  [...fields.map((field) => `values.${field}`), ...PAGING_FIELDS].join(",");

/**
 * Adds to a caller's whitelist the keys this server reads. Relative fields (`+x`, `-x`) build
 * on Bitbucket's defaults, which keep every key, so they stay as given.
 */
export function withFields(fields: string, required: string[]): string {
  const entries = fields
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.some((entry) => entry.startsWith("+") || entry.startsWith("-"))) {
    return entries.join(",");
  }
  const missing = required.filter((field) => !entries.includes(field));
  return [...entries, ...missing].join(",");
}

/** A caller's whitelist would drop `next` and hide the later pages, so the paging keys stay. */
export const withPagingFields = (fields: string): string =>
  withFields(fields, PAGING_FIELDS);

export const listFields = (fields: string | undefined, defaults: string): string =>
  fields ? withPagingFields(fields) : defaults;

/** A blank `fields` means the default projection. */
export function fieldsArgument(args: Record<string, unknown>): string | undefined {
  const value = args.fields;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("fields must be a string");
  return value.trim() || undefined;
}
