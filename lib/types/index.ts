/**
 * The shared vocabulary. One import path for every track (issue #4).
 *
 * Start with the time rule in `primitives.ts` — it is the thing that is
 * expensive to get wrong.
 *
 * What is deliberately **not** here:
 *
 * - **Validation.** No Zod. Parsing untrusted input belongs at the model
 *   boundary in A4, not in a file everything imports.
 * - **Logic.** No distance calculation, no leximin, no status derivation.
 *   Types state the contract; the functions live with whoever owns them.
 * - **The other six converters.** `meetingFromRow` is the worked example;
 *   `preferenceProfileFromRow` is the second.
 * - **`lib/spike/`.** Its `Participant` and `Candidate` are the model-payload
 *   shape, frozen for the F2 measurement. Different thing, same words.
 */

export * from "./primitives";
export * from "./profile";
export * from "./meeting";
export * from "./matching";
export * from "./meeting-from-row";
export * from "./preference-profile-from-row";
