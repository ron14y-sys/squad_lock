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
