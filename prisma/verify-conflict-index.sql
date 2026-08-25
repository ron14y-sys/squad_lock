-- Scratch seed for the F4 acceptance check: "EXPLAIN on 'all open meetings
-- for user X' uses the index" (docs/spec.md §6.2, tasks/todo.md F4).
-- Not a migration — not part of the applied migration history. Deleted
-- after the check runs.

INSERT INTO users (id, email, name, "googleId", "updatedAt") VALUES
  ('u_target', 'target@example.com', 'Target User', 'g_target', now()),
  ('u_other1', 'other1@example.com', 'Other One', 'g_other1', now()),
  ('u_other2', 'other2@example.com', 'Other Two', 'g_other2', now());

INSERT INTO groups (id, name, "updatedAt") VALUES
  ('grp_1', 'Group One', now()),
  ('grp_2', 'Group Two', now());

INSERT INTO group_members (id, "groupId", "userId") VALUES
  ('gm_1', 'grp_1', 'u_target'),
  ('gm_2', 'grp_2', 'u_target'),
  ('gm_3', 'grp_1', 'u_other1'),
  ('gm_4', 'grp_2', 'u_other2');

-- 3000 unrelated open meetings, none involving u_target, so a sequential
-- scan on meetings has real work to skip if the planner chooses one.
INSERT INTO meetings (id, "groupId", "initiatorId", status, "currentDatetime", "updatedAt")
SELECT
  'm_noise_' || gs,
  CASE WHEN gs % 2 = 0 THEN 'grp_1' ELSE 'grp_2' END,
  CASE WHEN gs % 2 = 0 THEN 'u_other1' ELSE 'u_other2' END,
  'weighing'::"MeetingStatus",
  now() + (gs || ' hours')::interval,
  now()
FROM generate_series(1, 3000) AS gs;

-- Two real meetings for u_target, in two different groups.
INSERT INTO meetings (id, "groupId", "initiatorId", status, "currentDatetime", "updatedAt") VALUES
  ('m_target_1', 'grp_1', 'u_target', 'weighing', now() + interval '2 days', now()),
  ('m_target_2', 'grp_2', 'u_target', 'awaiting', now() + interval '5 days', now());

INSERT INTO responses (id, "meetingId", "userId", status, "updatedAt") VALUES
  ('r_1', 'm_target_1', 'u_target', 'pending', now()),
  ('r_2', 'm_target_2', 'u_target', 'pending', now());

ANALYZE users, groups, group_members, meetings, responses;
