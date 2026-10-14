# Bug log

One entry per bug found in use or in manual testing: what was seen, why it
happened, how it was fixed, and what now proves it stays fixed. Newest first.

This is the **incident** record. When a bug turns out to be an instance of a
mistake this project keeps making, its entry links to the class in
[lessons.md](lessons.md), which is where the general rule lives.

**Adding an entry:** copy the template, fill every field, and write "not yet"
rather than leaving a field out. An entry with no test is still an entry — it
says so.

```
## <short title> — <date found>

- **Seen:** what the person saw, in their words if possible
- **Cause:** the line(s) responsible, and why they were written that way
- **Fix:** what changed — PR link
- **Proof:** the test that fails without the fix, or "not yet"
- **Still open:** anything the fix deliberately left, or "nothing"
```

---

## Opening a meeting went back to the group, not to the meeting — 2026-10-13

- **Seen:** manual test 6.1: after «פתח פגישה» the app went back to the group
  screen. Wanted: straight to the new meeting, to watch its proposal being
  prepared and then see it.
- **Cause:** `NewMeeting.tsx` sent every successful open to
  `/groups/<id>`, though `POST /api/groups/[id]/meetings` already answers
  with the new meeting (its id included) before the first run starts in
  `after()`.
- **Fix:** [#258](https://github.com/ron14y-sys/squad_lock/issues/258). It
  goes to `/meetings/<id>` from the response. The meeting screen needed
  nothing: a meeting with no proposal yet shows «מחפשים הצעה» with the run's
  stage, asks every 3 s (its next run is under a minute away), and is the
  clock that starts the run if `after()` did not.
- **Proof:** the two tests in `NewMeeting.test.tsx` that open a meeting now
  expect `/meetings/meeting-1`; both fail on the old code.
- **Still open:** nothing.

---

## The header's notification count never went down — 2026-10-13

- **Seen:** manual test 13.2: the number next to «התראות» in the header stayed
  the same after opening a notification. Wanted instead: the count goes down
  by one for each notification opened, and the list shows the unread ones
  bold and the opened ones faded.
- **Cause:** two things. `GET /api/notifications` marked every notification
  read the moment the list loaded (`markAllNotificationsRead`), so "read"
  meant "the list was seen", not "this one was opened". And the count is
  drawn by `AppHeader`, a server component in the root layout, which moving
  between pages with a `<Link>` never draws again — so even the reset never
  showed until a full reload.
- **Fix:** [#238](https://github.com/ron14y-sys/squad_lock/issues/238). The
  list marks nothing. Opening a card calls a server action,
  `openNotification` (`app/notifications/actions.ts`), which marks that one
  read (`markNotificationRead`, scoped by user) and revalidates the root
  layout so the header is drawn again; only then does the card go where it
  leads. A card already read is not marked again; one with nowhere to lead (a
  deleted group) is now a button that marks it and fades it in place. A
  failed mark still goes.
- **Proof:** `NotificationsList.test.tsx` (marked before going, not again,
  goes on failure, fades in place), `app/api/notifications/route.test.ts`
  (the list marks nothing), `app/notifications/actions.test.ts` (marks for
  the signed-in user, revalidates the layout), `lib/db/notifications.test.ts`
  (one row, this user's). All fail on the old code, and each of ten
  mutations of the new code fails one.
- **Still open:** the header is redrawn by the revalidation, which no unit
  test exercises — checked by manual test 13.2. A notification that arrives
  while you are already in the app still shows only on the next full load.

---

## Not a bug: a broken invitation link said the meeting was not found — 2026-10-13

- **Seen:** manual test 5.5: one character of the token changed showed
  «הפגישה הזו לא נמצאה, או שאתה לא משתתף בה.» instead of «ההזמנה הזו לא
  נמצאה.»
- **Cause:** none in the code. That message exists only on the meeting screen
  (`app/meetings/[id]/MeetingDetail.tsx`, `/meetings/<id>`), so the edited link
  was a meeting link — the «יש הצעה חדשה שמחכה לך» email carries one — not an
  invitation link (`/invitations/<token>`). The invitation page always opens
  with «הוזמנת להצטרף לקבוצה.»; only after «הצטרף לקבוצה» does
  `app/api/invitations/[token]/accept/route.ts` look the token up, and an
  unknown one answers `Invitation not found.`, which `AcceptInvitation.tsx`
  shows as «ההזמנה הזו לא נמצאה.»
- **Fix:** none needed. Test 5.5 now says to edit the invitation link
  (`/invitations/…`) and press join.
  [#257](https://github.com/ron14y-sys/squad_lock/issues/257), closed.
- **Proof:** not applicable.
- **Still open:** no test covers an unknown invitation token, on the route or
  on the screen.

---

## Setting a neighbourhood from a meeting did not return to the meeting — 2026-10-13

- **Seen:** manual test 6.5: "After C sets their neighbourhood through the
  link and presses save, send them back to the proposal."
- **Cause:** every "הגדר עכשיו" link — on the meeting screen
  (`MeetingDetail.tsx`), in the banner on the group screens
  (`MissingHomeBanner.tsx`), and `/groups`'s own redirect for a profile with
  no home — went to `/profile/location` with no word of where it came from,
  and the form (`LocationForm.tsx`) only said "נשמר." and stayed.
- **Fix:** [#260](https://github.com/ron14y-sys/squad_lock/issues/260). Each
  link carries `?next=` — the meeting, the page the banner is on, or
  `/groups`. The page passes it to the form through `localPath`, and the form
  goes there once the save succeeds. Without `next` (from the profile menu)
  it stays as before. `localPath` (`app/_components/local-path.ts`) accepts
  only a path on this site; the calendar-connect route now uses it too,
  instead of its own copy.
- **Proof:** these fail on the old code: `LocationForm.test.tsx` (goes back
  to the meeting once saved), `MeetingDetail.test.tsx` and
  `MissingHomeBanner.test.tsx` (the links carry `next`). Guards: a failed
  save goes nowhere; `local-path.test.ts` refuses `https://…`, `//…` and
  `/\…`. Each checked by breaking it. The page and `/groups`'s redirect are
  async server components, not unit-tested.
- **Still open:** nothing.

---

## A closed meeting's venue came back for a group that lives far apart — 2026-10-14

- **Seen:** a meeting was opened, everyone approved and it closed; a new
  meeting for the same group proposed the same venue. The group lives in
  Modiin, Ashdod and Ramat Gan; "there are other places in Ramat Gan".
- **Cause:** the #213 rule held a visited venue back only while another venue
  had **everyone within their range** (worst burden ≤ 1.0). From Ashdod,
  every venue in Ramat Gan is about 34 km — past even "anywhere" (then
  20 km) — so no venue ever qualified and the rule never fired. It asked the
  wrong question: not "is anywhere in range?" but "is anywhere nearly as
  fair as the visited venue?".
- **Fix:** [#213](https://github.com/ron14y-sys/squad_lock/issues/213),
  reopened. `withoutVisited` also accepts an alternative whose worst burden
  is at most `VISITED_MARGIN` (0.25, a quarter of a range) above the fairest
  visited venue's. "בכל מקום" is now 30 km; a data migration moves profiles
  stored at 20 to 30.
- **Proof:** `run-stage.test.ts`: the Modiin / Ashdod / Ramat Gan group with
  two venues in Ramat Gan gets the other one (fails on the old rule).
  `recent.test.ts`: 1.7 → 1.9 is held back, 1.7 → 2.0 is not; each bound
  checked by breaking it. The migration's SQL was run against seeded local
  rows (20 → 30; 8 and 5 unchanged).
- **Still open:** nothing.

---

## An invitation to your own Gmail address, without the dot, went out — 2026-10-14

- **Seen:** re-checking manual test 4.4: "An invitation to an address that
  looks like mine went through and I got an email, but when I clicked it to
  get in it said it was sent to another address." Signed in as
  `ron14.y@gmail.com`; the invitation was typed as `ron14y@gmail.com`.
- **Cause:** Gmail ignores dots (and anything after a `+`) in the name, so
  both addresses are one mailbox. The app compared addresses as lowercased
  strings: the invite route's "your own address" and "already a member"
  checks (#210) saw two people, so the invitation was created and emailed;
  the accept route saw a different address and refused it with 403.
- **Fix:** [#255](https://github.com/ron14y-sys/squad_lock/issues/255).
  `mailboxKey` (`lib/groups/schema.ts`): lowercase; for `gmail.com` and
  `googlemail.com`, drop dots and any `+tag` and read the domain as
  `gmail.com`. Other providers are only lowercased, since a dot can be
  another person there. Used for your own address, every member's address,
  a pending invitation under another spelling (no second email), and
  accepting. The invitation is still sent to the address as typed.
- **Proof:** `__tests__/invitations-db.test.ts` (#255 block, local Postgres):
  four fail on the old code — your own address without the dot, a member's,
  a pending invitation under the other spelling, accepting with the dot.
  `lib/groups/schema.test.ts` covers the key, each rule checked by breaking
  it.
- **Still open:**
  - Other providers' aliases (Outlook `+tags`, custom domains) are compared
    as typed.
  - A typo in the domain that someone registered (`ron@gmil.com`) still
    passes: it has a real mail server, so the DNS check accepts it.

---

## Not a bug: a new account was sent to the preference game — 2026-10-13

- **Seen:** manual test 4.1: opening `/groups` with a new account "sends to
  the preference game" instead of «עדיין אין לך קבוצות.»
- **Cause:** none in the code. `/groups` (`app/groups/page.tsx`) sends a user
  with no saved preference profile to the game — the onboarding #173 added
  (manual test 1.6) — and the profile row is created only when the game is
  finished and saved («נשמר.»). The account was new and had not finished the
  game. Checked that saving cannot fail silently: skipping every question
  still saves, an empty multi-choice sends nothing the server rejects, a
  failed save says «לא הצלחנו לשמור», and nothing deletes a profile.
- **Fix:** none needed. Test 4.1 said "a new account (after onboarding)"
  without saying what that means; it now says to finish the game until
  «נשמר.» and save a neighbourhood first.
  [#254](https://github.com/ron14y-sys/squad_lock/issues/254), closed.
- **Proof:** not applicable.
- **Still open:** nothing.

---

## Another person's approval never reached an open meeting screen — 2026-10-13

- **Seen:** manual test 7.4, two accounts: "On the computer I approved and saw
  it update at once. On the phone, as the other user, nothing changed. Time
  passed, then I refreshed and saw the new status." The phone was on the
  meeting screen itself.
- **Cause:** the meeting screen (`app/meetings/[id]/MeetingDetail.tsx`) loaded
  once and asked again only while the meeting was `reweighing` — the case it
  was written for (#169), waiting for a new proposal. While a proposal waited
  for answers it never asked, so someone else's approval, the approval count
  and their status appeared only after a reload. The approving screen updated
  because its own click reloaded it. The group feed was not the cause: it has
  polled every 30 seconds since C5.
- **Fix:** [#268](https://github.com/ron14y-sys/squad_lock/pull/268).
  `pollDelay` sets the cadence from what the screen already has, with no API
  change: every 30 s while a proposal waits or the meeting conflicts; every
  3 s only while a re-weighing is under way or a minute or less away (this
  poll is also what starts a due run, spec §3.2); 30 s while it is further
  off; nothing for a closed or stuck meeting. Backgrounded, nothing; back on
  screen, one request at once. A five-minute wait after a rejection now costs
  about 28 requests instead of about 100.
- **Proof:** `MeetingDetail.test.tsx`, the #261 tests. Three fail on the old
  code: another person's approval shows after 30 s ("2 מתוך 3 אישרו"), 30 s
  rather than 3 s when the next run is four minutes away, and a request at
  once on coming back. Two guard what already worked (3 s near or during a
  run; nothing for closed or stuck), each checked by breaking its condition.
  Not yet re-run on the live site.
- **Still open:** the group feed polled every 3 s for a whole re-weighing,
  and the all-groups screen never refreshed on its own
  ([#269](https://github.com/ron14y-sys/squad_lock/issues/269), fixed in
  [#270](https://github.com/ron14y-sys/squad_lock/pull/270): one shared
  `usePolling` hook, and polling only while a meeting is open).

---

## "גם שקלנו" listed the proposed venue twice — 2026-10-07

- **Seen:** the proposal was קפה גן סיפור חולון, and under it: "גם שקלנו: קפה
  גן סיפור חולון, קפה גן סיפור חולון".
- **Cause:** an option is a venue _and_ an hour. A4 must return three
  different `(venue, slot)` pairs, and here they were one café at three times.
  `getMeetingDetail` (`lib/db/meeting-detail.ts`) listed the venue name of
  ranks 2 and 3 without asking whether it was the same place.
- **Fix:** [#214](https://github.com/ron14y-sys/squad_lock/pull/214). `alsoConsideredOf` lists the other venues only,
  each once, in rank order (the same place means the same place id, or the
  same name when there is none). When there are none, the line is not shown.
- **Proof:** `meeting-detail.test.ts`, including the case exactly as seen
  (fails on the old code).
- **Still open:** A4 is still allowed to spend all three options on one
  venue. Asking it for different venues where it can is a separate decision.

## Every dietary requirement said "could not verify" — 2026-10-07

- **Seen:** "לא הצלחנו לאמת אם הם עומדים בדרישת כשר" and the same for
  vegetarian. The question was whether reading the place failed or the
  information does not exist.
- **Cause:** neither. The information was never asked for. A2 has the three
  states (satisfies / violates / not known), but nothing ever filled in
  `venueFacts`. `run-cycle.ts` said so in a comment ("B7 fetches no dietary
  tags"). So every dietary tag was "not known", for every venue, always.
- **Fix:** [#214](https://github.com/ron14y-sys/squad_lock/pull/214).
  - Place Details now also asks for `servesVegetarianFood`, which is in the
    same Enterprise + Atmosphere tier as `editorialSummary`. Checked in
    Google's field table: no extra cost.
  - The value is cached in a new nullable column. `venueDietaryFactsFrom`
    turns it into facts for both the filter and the model:
    - `true` satisfies a vegetarian tag, but not a vegan one;
    - `false` refuses both;
    - absent says nothing.
  - Google has no field for kosher, vegan or halal, so those stay "could not
    verify". That is the truth, and the note already tells people to call.
- **Proof:** these fail on the old code:
  - `client.test.ts`: the field is requested and returned.
  - `places-cache-db.test.ts`: `false` survives the cache as `false`.
  - `run-cycle.test.ts`: the facts, and their effect through `checkPair`.
  - `run-stage.test.ts`: a run hands them to the model.
- **Still open:**
  - Cached rows from before this change (24-hour cache) say nothing until they
    expire.
  - Previews read a staging database that the deploy does not migrate. The
    new column has to be applied there by hand, or details reads fail on
    previews.
  - No source for kosher at all.

## Inviting yourself, inviting a dead address, no way to cancel — 2026-10-07

- **Seen:** manual test 4.4: "It let me invite myself and sent an email. It
  lets you invite an invalid address. Add a way to remove an invitation or a
  member."
- **Cause:**
  - The invite route (`app/api/groups/[id]/invitations/route.ts`) asked "is
    there an _accepted invitation_ for this address?", not "is this person a
    _member_?". A group's creator joins with no invitation at all, so for
    them, and for anyone else who joined that way, the check always passed.
    The result was an email, and a pending invitation taking one of the six
    places.
  - An address with a broken shape was already refused (`ron@gmail`,
    `ron@@gmail.com`). One with a valid shape and a domain that cannot get
    mail (`ron@gmail.con`) was accepted.
  - Cancelling an invitation was never built, so a typo held a place in the
    group for good.
- **Fix:** [#210](https://github.com/ron14y-sys/squad_lock/pull/210).
  - The route refuses the inviter's own address ("זו הכתובת שלך") and any
    address that belongs to a current member, case-insensitively, before
    creating anything.
  - `lib/email/mail-domain.ts` checks in DNS that the domain has an MX record,
    or an address record to fall back on. If it has neither, the invite is
    refused with "לכתובת הזו אי אפשר לשלוח מייל". A DNS timeout or server
    error lets the invite through, so an outage never blocks one.
  - `DELETE /api/groups/[id]/invitations/[invitationId]`: any member can
    cancel a pending invitation. The row is deleted, its place is freed, and
    the emailed link answers "not found". An invitation that is already
    accepted is not touched. The group page has a "בטל הזמנה" button on each
    pending invitation.
- **Proof:** these fail on the old code:
  - `__tests__/invitations-db.test.ts`: both routes, against a real database.
    Covers your own address, a member who never had an invitation, a dead
    domain, cancelling and freeing the place, an outsider, an accepted
    invitation, and an invitation from another group.
  - `GroupDetail.test.tsx`: the messages and the cancel button.
  - `mail-domain.test.ts` covers the DNS rules. Checked once against real DNS:
    `gmail.con` is refused, `gmail.com` and `walla.co.il` pass.
- **Still open:**
  - Typo domains that someone registered (`gmial.com`, `hotmial.com`) pass the
    DNS check. A mailbox that does not exist on a real domain also passes.
    Cancelling the invitation is the remedy for both.
  - Removing a member or leaving a group is a separate task. It needs
    decisions on open meetings and on who may remove whom.

## One person without a calendar held up the whole group — 2026-10-07

- **Seen:** after #206, a meeting where one participant had not connected a
  calendar read "תקוע — חסר חיבור ליומן" and stayed that way until that person
  connected one. Correct by the rule at the time, but for a group of friends it
  looks like a broken app. Not everyone can or wants to connect a Google
  calendar: an Apple or Outlook user, someone who keeps their calendar private,
  someone who left the box unticked on Google's consent screen.
- **Cause:** a decision, not a slip. B6 made the calendar required:
  `fetchBusyForConnections` (`lib/calendar/participant-busy.ts`) threw if
  anyone still coming had no token, before reading anyone's calendar, because
  treating an unread calendar as free could produce a proposal that clashes
  with a calendar nobody read (spec §5.7: a false positive is worse than a
  false negative).
- **Fix:** [#209](https://github.com/ron14y-sys/squad_lock/pull/209). The calendar is optional, and the proposal says
  what was not checked:
  - `fetchBusyForConnections` reads every calendar it can and returns
    `{ busy, unread, rejected }`. No token, or a token Google refuses, puts the
    person in `unread`, and they are treated as free apart from the hours they
    set in the app (`hardConstraints.unavailable`, which A2 already enforced on
    its own). A rate limit, a 5xx or a network failure still fails the read and
    the run is retried.
  - A refused token still gets B10's handling: the token is cleared and its
    owner is emailed. But the run goes on.
  - `weigh` stores `{ kind: "calendar", userId }` on every option of the
    proposal, next to A2's "opening hours unverified". It is kept as a fact
    because it describes that proposal, and it still holds after the person
    connects. It is added after the model and never sent to it. It is stored
    in the existing JSON column, so no migration: previews do not migrate.
  - Under the proposal, the person who has no calendar connected sees "לא חיברת
    יומן, אז הזמן הזה נבדק רק מול השעות שהגדרת באפליקציה" with the "חבר יומן"
    link from #206. Everyone else sees "הזמן הזה לא נבדק מול היומן של X, כי
    הוא עוד לא מחובר".
  - Removed from #206: the "stuck — calendar missing" label and sticker, the
    blocked notice, and switching off the fast poll. Kept from #206: the 403
    becomes `CalendarAuthError`, a sign-in without the calendar permission
    stores no token, and `/api/calendar/connect` works.
  - Unchanged: someone with no calendar who answers "not for me" uses up one of
    the group's attempts like anyone else. Decided to leave it, since "המצב
    שלי הערב שונה" already gives every participant one free correction.
- **Proof:** these fail on the old code:
  - `participant-busy.test.ts`: a missing token does not stop the others'
    calendars being read; a refused token comes back unread and rejected; a
    500 still fails the read.
  - `run-stage.test.ts`: a refused token is cleared and emailed, and the run
    reaches the model; the stored draft carries the calendar fact on every
    option; the model is not given it.
  - `meeting-detail.test.ts`, `hebrew-labels.test.ts`,
    `MeetingDetail.test.tsx`: the names and both notes.
  - `participant-busy-db.test.ts`: checked against the local database.
- **Still open:** the full path with a real account that has no calendar is
  manual test 14.4. Supersedes the "stuck" part of the entry below.

## A new meeting never got a proposal: calendar permission missing — 2026-10-06

- **Seen:** "I asked to create a meeting and it didn't create one." It had
  been created; it just never got a proposal, and its card said it was
  searching. The Vercel log, every poll:
  `[a8] cycle failed … freebusy.query failed (403) … ACCESS_TOKEN_SCOPE_INSUFFICIENT`.
- **Cause:** three things in a row.
  - Google's consent screen shows the calendar permission as its own
    checkbox. A participant signed in with it unticked: the refresh token was
    stored and exchanges fine, and Google refuses every free/busy query with
    it.
  - `fetchBusy` (`lib/calendar/freebusy.ts`) classified a 403 only as a rate
    limit or as nothing, so this one became a generic fault: the meeting stayed
    in `weighing`, was retried on every poll, and nobody was told. B10's
    handling — clear the token, email the person, show "ההתאמה מחכה" — ran
    only for a _revoked_ token, the one way it had been seen to fail.
  - Had it run, its "חבר מחדש" link (and the B10 email's, and the
    notification's) went to `/api/auth/signin`. With `pages.signIn` set to
    `/`, that lands on the home page, which sends anyone signed in to
    `/groups` — so reconnecting was impossible without signing out first.
    Suspected from reading on the same day, confirmed by this report.
- **Fix:** [#206](https://github.com/ron14y-sys/squad_lock/pull/206). The
  calendar stays required (decided); what changed is that a missing one is
  _seen_:
  - that 403 is a `CalendarAuthError`, so B10's path runs;
  - a sign-in whose scope list lacks `calendar.freebusy` stores no token;
  - `/api/calendar/connect` starts Google's consent directly and returns to the
    page — used by the meeting page, the email and the notification;
  - the card and the meeting page read "תקוע — חסר חיבור ליומן" with no
    spinner; the person missing it sees "לא חיברת יומן" with a link, the
    others see who it is; no fast polling, and one info log line instead of an
    error per poll.
- **Proof:** `freebusy.test.ts` — the 403 body Google actually sent becomes a
  `CalendarAuthError` (fails on the old code). `consent.test.ts` — the sign-in
  rule. `GroupFeed.test.tsx` / `MeetingDetail.test.tsx` — blocked reads as
  stuck, not searching (fail on the old code). The connect route was checked on
  a local dev server (307 straight to Google with `prompt=consent`); the full
  round trip with a real account is manual test 14.4.
- **Still open:** superseded on 2026-10-07: the calendar became optional (entry
  above), and the "stuck" state was removed.

## A new meeting said "re-weighed" before anything was weighed — 2026-10-06

- **Seen:** right after opening a meeting, the first status shown was
  "משוקלל מחדש", and the meeting page said "מחפשים הצעה חדשה" — for a
  meeting that had never had a proposal.
- **Cause:** a new meeting starts in `weighing`, and `deriveMeetingCardStatus`
  (`lib/db/meeting-cards.ts`) maps every `weighing` meeting to `reweighing`.
  The vocabulary (spec §5.6) was written around the rejection loop and had no
  word for the opening search.
- **Fix:** [#205](https://github.com/ron14y-sys/squad_lock/pull/205). The status
  stays `reweighing` — the fast poll keys on it — and only the words change: a
  card with no `MatchRun` yet carries `firstSearch` and reads "מחפשים הצעה";
  the meeting page reads the same when it has no proposal.
- **Proof:** label, feed and meeting-page tests for the first search, each
  failing on the old code. The server-side `firstSearch` flag is read, not
  tested.
- **Still open:** nothing.

## The preference game forgot earlier answers — 2026-10-06

- **Seen:** answers given in the preference game "were not saved". Replaying
  the game showed every question blank, and nothing anywhere showed what had
  been chosen.
- **Cause:** two things together.
  - `PreferenceGame` always started from `answers = {}` and its container never
    loaded the saved profile, so the game had no idea what was already stored.
  - The save sends the whole `softPreferences` object, and the API replaces the
    column with it. Replaying the game and skipping a question therefore
    _erased_ the answer given to that question before — without the person
    ever seeing it.

  No screen displayed soft preferences, so "erased" and "never saved" looked
  the same from outside.

- **Fix:** [#203](https://github.com/ron14y-sys/squad_lock/pull/203). The game
  loads `/api/preferences` first and starts from it; the saved card is marked
  "הבחירה שלך עד עכשיו"; with a saved answer, skip reads "דלג — השאר כמו שהיה"
  and keeps it (decided: skipping never clears a saved answer); the closing
  screen and the profile page both list the four answers.
- **Proof:** `PreferenceGameContainer.test.tsx` — "a replayed game starts from
  the saved answers, and skipping keeps them" fails on the old code (it saved
  `{}`). `HardConstraintsForm.test.tsx` — the profile summary test.
- **Still open:** the same report also said hard constraints were lost. Nothing
  in the code deletes or overwrites them — the forms save only their own fields
  and the API updates only what it is sent. The leading explanation is looking
  at a different database than the one saved to (a Vercel Preview URL runs
  against staging since #157, `squadlock.vercel.app` against production). Not
  confirmed.

## A confirmed meeting never warned against a clash — 2026-09-30

- **Seen:** found while wiring meeting confirmation, not by a user. A dinner
  confirmed at 19:00 in one group gave no warning against a proposal at 20:00
  in another, and approving it double-booked the person.
- **Cause:** `findConflictingMeetings` (`lib/db/conflict-dismissal.ts`)
  filtered candidates to `OPEN_MEETING_STATUSES`, which excludes `closed`. It
  was written before any meeting could reach `closed`, so the filter was
  harmless then — and became wrong, silently, the day confirmation shipped.
- **Fix:** [#201](https://github.com/ron14y-sys/squad_lock/pull/201). Confirmed
  meetings take part, in pairs with at least one open meeting. The warning says
  approving will not cancel the confirmed one and offers no "change the other
  one"; `cancelConflictingMeetings` still never touches a confirmed meeting.
- **Proof:** `__tests__/confirmed-conflict-db.test.ts` — "pairs a confirmed
  meeting with an open one" fails on the old code. A `ConflictWarning` test for
  the confirmed wording fails against the old component.
- **Still open:** nothing.

## An approval carried over to the next proposal — 2026-09-30

- **Seen:** found while writing the manual test sheet
  ([#176](https://github.com/ron14y-sys/squad_lock/issues/176)). B approves
  proposal 1, C rejects it, proposal 2 arrives somewhere else — and B is still
  "approved". If the others approve, the meeting closes on a place B never saw;
  B gets no email and the feed shows nothing waiting on them.
- **Cause:** a `Response` row holds a person's answer but not _which proposal_
  it answered, and nothing reset it when a new proposal was written. The
  closing check counted every `approved` row. Same family as
  [lessons.md](lessons.md)'s rule on updated rows: a row that is a _state_ was
  being read as though it were tied to one moment.
- **Fix:** [#200](https://github.com/ron14y-sys/squad_lock/pull/200).
  `weigh()` resets every response except `cant_make_it` to `pending` in the
  same transaction that writes the new proposal. `doesnt_suit` resets too; its
  sentence stays on its `participant_meeting_contexts` row, which the timeline
  reads.
- **Proof:** `__tests__/response-reset-db.test.ts` — fails on the old code with
  `expected 'approved' to be 'pending'`. That `weigh()` calls the reset is read
  in the code, not tested.
- **Still open:** a stale click — approving after a new proposal landed but
  before the page refreshed — approves the new one. Planned as a follow-up.
  Earlier approvals no longer appear in the timeline (accepted).

---

## Before this log

Found through the manual test sheet on 2026-09-30 and fixed before this file
existed. Cause and fix are in each issue and PR.

| Bug                                                                          | Issue                                                       | Fixed in                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| The 404 page was Next.js's default, in English                               | [#190](https://github.com/ron14y-sys/squad_lock/issues/190) | [#191](https://github.com/ron14y-sys/squad_lock/pull/191) |
| Timeline showed the raw transport value: "אין car הערב"                      | [#175](https://github.com/ron14y-sys/squad_lock/issues/175) | [#178](https://github.com/ron14y-sys/squad_lock/pull/178) |
| Group size 3–6 was not enforced                                              | [#174](https://github.com/ron14y-sys/squad_lock/issues/174) | [#180](https://github.com/ron14y-sys/squad_lock/pull/180) |
| New users were never taken through onboarding                                | [#173](https://github.com/ron14y-sys/squad_lock/issues/173) | [#179](https://github.com/ron14y-sys/squad_lock/pull/179) |
| Venue search returned only restaurants                                       | [#165](https://github.com/ron14y-sys/squad_lock/issues/165) | [#177](https://github.com/ron14y-sys/squad_lock/pull/177) |
| Opening a meeting failed on the live site                                    | [#154](https://github.com/ron14y-sys/squad_lock/issues/154) | see the issue                                             |
| A profile's home coordinates were never written, so nothing could be weighed | [#132](https://github.com/ron14y-sys/squad_lock/issues/132) | see the issue                                             |

## Known and not yet fixed

- **"Too far" brings back the same venue** — a `distance` rejection blocks
  only the exact venue-and-hour pair, and nothing moves the next proposal
  closer. ([#211](https://github.com/ron14y-sys/squad_lock/issues/211))

- **Signing out opens NextAuth's default page, in English** — `התנתק` links to
  `/api/auth/signout`, and `auth.ts` sets a custom page only for sign-in.
  ([#171](https://github.com/ron14y-sys/squad_lock/issues/171))
- **Stale click approves an unseen proposal** — see the #176 entry above.
