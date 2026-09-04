import { z } from "zod";

/** POST /api/groups request body — creating a group (spec §1.2, §5.3). */
export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
