import { z } from "zod";

/**
 * POST /api/meetings/[id]/conflict request body — the two ways out of a
 * conflict warning (C8, spec §5.7). A discriminated union on `kind`, for the
 * same reason `respondToMeetingSchema` is one: the two shapes share nothing.
 */
export const conflictActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("keep_both"),
      otherMeetingId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("send_back"),
      targetMeetingId: z.string().min(1),
    })
    .strict(),
]);

export type ConflictActionInput = z.infer<typeof conflictActionSchema>;
