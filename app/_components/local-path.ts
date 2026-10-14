/**
 * A path on this site, or null — never an absolute URL somebody put in a
 * link (`//evil.example` and `/\evil.example` are both read by a browser as
 * another host). For any "come back here afterwards" address.
 */
export function localPath(url: string | null | undefined): string | null {
  return url?.startsWith("/") && !/^\/[/\\]/.test(url) ? url : null;
}
