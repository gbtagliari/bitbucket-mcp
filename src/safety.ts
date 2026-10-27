/**
 * A dangerous tool deletes content, so it stays off until BITBUCKET_ENABLE_DANGEROUS is set.
 * unapprovePullRequest and removeChangeRequest send DELETE too, but they only withdraw the
 * caller's own vote, which the caller can cast again. publishPendingComments deletes too, but
 * only the caller's own draft, and only after its published copy exists.
 */
export function isDangerousTool(name: string): boolean {
  return /^delete/i.test(name);
}
