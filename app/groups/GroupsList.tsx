"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ConflictBanner } from "@/app/_components/ConflictBanner";
import { stickerClass, tiltClass } from "@/app/_components/meeting-style";
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
  if (meeting.status === "stuck")
    parts.push("לא מצאנו הצעה — צריך להחליט ידנית");
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
    return <p className="sl-page sl-sub">טוען את הקבוצות שלך…</p>;
  }

  if (loadState === "signed-out") {
    return <p className="sl-page sl-sub">התחבר כדי לראות את הקבוצות שלך.</p>;
  }

  if (loadState === "error") {
    return (
      <p className="sl-page sl-sub">
        לא הצלחנו לטעון את הקבוצות. נסה לרענן את הדף.
      </p>
    );
  }

  const awaitingCount = (groupId: string) =>
    meetings.filter(
      (m) => m.groupId === groupId && m.status === "waiting_on_you"
    ).length;

  return (
    <div className="sl-page">
      {meetings.some((m) => m.status === "conflicting") && <ConflictBanner />}

      <div className="flex flex-col gap-4">
        {groups.length === 0 && <p className="sl-sub">עדיין אין לך קבוצות.</p>}
        {groups.map((group, index) => {
          const awaiting = awaitingCount(group.id);
          return (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className={`sl-card ${tiltClass(index)}`}
            >
              <div className="sl-sq">{group.name.charAt(0)}</div>
              <div className="sl-body">
                <div className="sl-ttl">{group.name}</div>
                <div className="sl-line">{group.members.length} חברים</div>
              </div>
              {awaiting > 0 && (
                <span className="sl-cnt">{awaiting} ממתינים לך</span>
              )}
            </Link>
          );
        })}
      </div>

      {meetings.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="sl-sec">היומן שלך</h2>
          <div className="flex flex-col gap-4">
            {meetings.map((meeting, index) => {
              const isYou = meeting.status === "waiting_on_you";
              return (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className={`sl-card ${isYou ? "is-you" : tiltClass(index)}`}
                >
                  <div className="sl-date">{meetingDateLabel(meeting)}</div>
                  <div className="sl-body">
                    <span className={`sl-stk ${stickerClass(meeting.status)}`}>
                      {meetingStatusLabel(meeting.status, meeting.waitingOn)}
                    </span>
                    <p className="sl-line truncate">{summaryLine(meeting)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="sl-sec">קבוצה חדשה</h2>
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
            className="sl-field flex-1"
          />
          <button
            type="button"
            onClick={createGroup}
            disabled={creating}
            className="sl-btn go"
          >
            {creating ? "יוצר…" : "צור"}
          </button>
        </div>
        {createError && <p className="sl-note">{createError}</p>}
      </div>
    </div>
  );
}
