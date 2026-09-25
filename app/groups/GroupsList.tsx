"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ConflictBanner } from "@/app/_components/ConflictBanner";
import { meetingStatusLabel } from "@/lib/format/hebrew-labels";
import { meetingDateLabel, meetingTimeLabel } from "@/lib/format/meeting-when";

type GroupMember = {
  userId: string;
  joinedAt: string;
  user: { name: string; email: string };
};

type Group = {
  id: string;
  name: string;
  createdAt: string;
  members: GroupMember[];
};

type OpenMeeting = {
  id: string;
  groupId: string;
  groupName: string;
  status:
    | "waiting_on_you"
    | "waiting_on_others"
    | "reweighing"
    | "conflicting"
    | "stuck"
    | "closed";
  waitingOn: number | null;
  currentDatetime: string | null;
  pinnedWhen: { kind: "date" | "date_and_time"; date: string } | null;
  pinnedVenue: string | null;
  occasion: string | null;
  approvedCount: number;
  totalCount: number;
};

type LoadState = "loading" | "ready" | "signed-out" | "error";

function summaryLine(meeting: OpenMeeting): string {
  const parts = [meeting.groupName];
  if (meeting.occasion) parts.push(meeting.occasion);
  else if (meeting.pinnedVenue) parts.push(meeting.pinnedVenue);
  if (meeting.currentDatetime) {
    parts.push(`בשעה ${meetingTimeLabel(meeting.currentDatetime)}`);
  }
  return parts.join(" · ");
}

/**
 * The "All groups" screen (spec §5.6, C8): every group with a count of what
 * awaits the viewer in it, plus one timeline of every open meeting across
 * groups. The timeline exists because conflict detection is cross-group
 * (§5.7) — a clash is only visible from a place that sees both sides.
 */
export function GroupsList() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [groups, setGroups] = useState<Group[]>([]);
  const [meetings, setMeetings] = useState<OpenMeeting[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    Promise.all([fetch("/api/groups"), fetch("/api/meetings")])
      .then(async ([groupsRes, meetingsRes]) => {
        if (groupsRes.status === 401 || meetingsRes.status === 401) {
          setLoadState("signed-out");
          return;
        }
        if (!groupsRes.ok) {
          throw new Error(`GET /api/groups: ${groupsRes.status}`);
        }
        if (!meetingsRes.ok) {
          throw new Error(`GET /api/meetings: ${meetingsRes.status}`);
        }
        setGroups(await groupsRes.json());
        setMeetings((await meetingsRes.json()).meetings);
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }

  useEffect(load, []);

  async function createGroup() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`POST /api/groups: ${res.status}`);
      setName("");
      load();
    } catch {
      setCreateError("לא הצלחנו ליצור את הקבוצה. נסה שוב.");
    } finally {
      setCreating(false);
    }
  }

  if (loadState === "loading") {
    return <p className="p-6 text-sm text-zinc-500">טוען את הקבוצות שלך…</p>;
  }

  if (loadState === "signed-out") {
    return (
      <p className="p-6 text-sm text-zinc-500">
        התחבר כדי לראות את הקבוצות שלך.
      </p>
    );
  }

  if (loadState === "error") {
    return (
      <p className="p-6 text-sm text-red-600">
        לא הצלחנו לטעון את הקבוצות. נסה לרענן את הדף.
      </p>
    );
  }

  const awaitingCount = (groupId: string) =>
    meetings.filter(
      (m) => m.groupId === groupId && m.status === "waiting_on_you"
    ).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      {meetings.some((m) => m.status === "conflicting") && <ConflictBanner />}

      <div className="flex flex-col gap-3">
        {groups.length === 0 && (
          <p className="text-sm text-zinc-500">עדיין אין לך קבוצות.</p>
        )}
        {groups.map((group) => {
          const awaiting = awaitingCount(group.id);
          return (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="flex items-center justify-between rounded-md border border-zinc-300 px-4 py-3 dark:border-zinc-700"
            >
              <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-50">
                  {group.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {group.members.length} חברים
                </div>
              </div>
              {awaiting > 0 && (
                <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">
                  {awaiting} ממתינים לך
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {meetings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            היומן שלך
          </h2>
          <div className="flex flex-col gap-2">
            {meetings.map((meeting) => {
              const highlighted = meeting.status === "waiting_on_you";
              return (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                    highlighted
                      ? "border-indigo-600 dark:border-indigo-400"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  <div
                    className={`flex h-10 w-12 shrink-0 items-center justify-center rounded text-xs font-semibold ${
                      highlighted
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    {meetingDateLabel(meeting)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-xs font-medium ${
                        highlighted
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-zinc-500"
                      }`}
                    >
                      {meetingStatusLabel(meeting.status, meeting.waitingOn)}
                    </div>
                    <p className="truncate text-sm text-zinc-900 dark:text-zinc-50">
                      {summaryLine(meeting)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-300 pt-6 dark:border-zinc-700">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          קבוצה חדשה
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createGroup();
              }
            }}
            placeholder="שם הקבוצה"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-black"
          />
          <button
            type="button"
            onClick={createGroup}
            disabled={creating}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {creating ? "יוצר…" : "צור"}
          </button>
        </div>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </div>
    </div>
  );
}
