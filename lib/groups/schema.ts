import { z } from "zod";

/** POST /api/groups request body — creating a group (spec §1.2, §5.3). */
export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/**
 * POST /api/groups/[id]/invitations request body — inviting by email
 * (spec §5.3, §12.1).
 *
 * Normalises (trim + lowercase) as part of parsing, not as a separate step
 * in the route — every write and lookup against Invitation.email goes
 * through this schema, so there is exactly one place that decides what
 * "the same address" means.
 */
export const inviteToGroupSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
  })
  .strict();

export type InviteToGroupInput = z.infer<typeof inviteToGroupSchema>;

/**
 * #255: the mailbox an address reaches, for comparing two addresses. Gmail
 * ignores dots and anything after a `+` in the name, and `googlemail.com` is
 * `gmail.com`, so `ron14y@gmail.com` and `ron14.y@gmail.com` are one person.
 * Other providers may tell those apart, so they are only lowercased. Only
 * for comparing: an invitation is still sent to the address as typed.
 */
export function mailboxKey(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  const domain = lower.slice(at + 1);
  if (at < 0 || (domain !== "gmail.com" && domain !== "googlemail.com")) {
    return lower;
  }
  const name = lower.slice(0, at).split("+")[0].replaceAll(".", "");
  return `${name}@gmail.com`;
}
