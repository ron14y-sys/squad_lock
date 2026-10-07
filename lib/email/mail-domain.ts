// Whether an address's domain can receive mail at all — asked before an
// invitation is created, so a typo like `gmail.con` is caught while the
// person is still on the page instead of becoming a pending invitation
// nobody will ever accept.
//
// This only knows about the domain. A mailbox that does not exist on a real
// domain (`no-such-person@gmail.com`) passes; nothing short of sending can
// tell, and that is what cancelling an invitation is for.

import { promises as dns } from "node:dns";

type Resolver = Pick<typeof dns, "resolveMx" | "resolve4" | "resolve6">;

/** The DNS answers that mean "this name has no records", not "DNS is down". */
const NO_SUCH_RECORD = new Set(["ENOTFOUND", "ENODATA"]);

function isNoSuchRecord(error: unknown): boolean {
  return NO_SUCH_RECORD.has((error as { code?: string })?.code ?? "");
}

async function hasAny(lookup: () => Promise<unknown[]>): Promise<boolean> {
  try {
    return (await lookup()).length > 0;
  } catch (error) {
    if (isNoSuchRecord(error)) return false;
    throw error;
  }
}

/**
 * False only when DNS says the domain has nowhere to deliver mail: no MX
 * record, and no address record to fall back on (RFC 5321 §5.1). Any other
 * DNS failure — a timeout, a server error — answers true: a passing outage
 * must not stop someone inviting a friend.
 */
export async function domainAcceptsMail(
  email: string,
  resolver: Resolver = dns
): Promise<boolean> {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  try {
    return (
      (await hasAny(() => resolver.resolveMx(domain))) ||
      (await hasAny(() => resolver.resolve4(domain))) ||
      (await hasAny(() => resolver.resolve6(domain)))
    );
  } catch {
    return true;
  }
}
