// The 3-6 bounds on a group's size (spec §5.3, #174), in a file with nothing
// server-only in it so a client component can read them too. `lib/db/groups.ts`
// re-exports them for everything that already imports them from there.

export const GROUP_SIZE_CAP = 6;
export const GROUP_SIZE_FLOOR = 3;
