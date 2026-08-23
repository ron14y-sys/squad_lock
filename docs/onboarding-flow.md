# Onboarding — screens, data, and permissions

Full plan for the first flow a new user goes through: from the invite link to a usable profile. This consolidates and details what [spec.md](spec.md) already commits to (§5.1, §5.2, §6.3) plus tasks B2, C2, C3, C3b in [tasks/todo.md](../tasks/todo.md) — it does not introduce new architecture, it is the single reference for building this flow.

**Success criterion this flow exists to satisfy** (spec §12.1): *"A friend receives an emailed link, signs in with Google, and completes a profile in under a minute."*

---

## 0. Confirmed: no password, no local account

**There is no username/password screen anywhere in this flow.** The only sign-in method is "Continue with Google." This was checked explicitly (not assumed) because the app needs read access to the user's Google Calendar to compute availability — that access is only possible through a Google sign-in, so a separate local account would be a second identity system solving nothing. One identity, one consent screen, one set of credentials to leak.

---

## 1. Entry point — the invite link

- A user is invited to a group by email (see B4). The email carries a link with an invite token.
- Opening the link on a phone with no account yet routes to **Screen 1**. An already-onboarded user who clicks it instead joins the group directly and skips to the group feed.
- An expired or already-used token shows a plain error state, not a broken page.

---

## 2. Screen 1 — Continue with Google

**What the user sees:** one button, "Continue with Google," and one sentence explaining why: *"We use this to check when your friends are free — nothing is posted or shared without your say-so."*

**What happens technically:**

1. The button starts Google's OAuth flow, requesting exactly one scope: **`calendar.freebusy`** — free/busy times only, no event titles, locations, or details.
2. Google's own consent screen shows the user what they're granting. This is Google's screen, not ours — we don't design it, only choose the scope.
3. On approval, a `User` row is created (or matched, if this Google account already exists) — see B2.

**Why this exact scope and not full calendar read:** `calendar.freebusy` appears to be classified **non-sensitive** by Google (to be confirmed once in the Cloud Console, before Week 2 — see design-review-prep.md §4.6). A non-sensitive scope means:
- No Google verification review (which takes weeks).
- The app can be published **"In production"** immediately instead of staying in restricted "Testing" mode.
- **This avoids a real bug that was caught in review:** an app left in "Testing" mode has its refresh tokens expire **every 7 days**, which would silently break calendar access for anyone who hasn't reopened the app in a week — including, potentially, on the day of a demo.

**What we deliberately do not ask for:** write access, event contents, contacts, email send-as. If a future version needs more, that is a new consent screen and a new decision — not a default to reach for now.

**Error states:**
- User declines the Google consent screen → back to Screen 1 with a short explanation, not a dead end.
- Google account has no calendar at all (rare) → proceed; availability for that user is treated as always-free until they add events, not as a blocker to onboarding.

---

## 3. Screen 2 — Preference game (this-or-that)

**Purpose:** get a usable soft-preference profile without a form. Pairs like *"Loud bar or quiet café?"* · *"Hike in nature or a museum tour?"* · *"Student budget or once-in-a-lifetime splurge?"*.

**Acceptance (C2):** completed in **under 60 seconds**, timed on someone seeing it for the first time.

**Output:** the soft-preference fields on `PreferenceProfile` — cuisine, budget, atmosphere, noise level. No free text at this stage; every question is a forced choice, which is what keeps it fast and keeps the output structured (nothing here needs an LLM to parse).

---

## 4. Screen 3 — Hard constraints

**Purpose:** the things that must never be violated: kosher, allergies, fixed unavailable hours (e.g. "never before 8pm on weekdays").

**Explicit, not inferred (C3).** These are never guessed by a model — they're the fields the hard-constraint filter (A2) reads directly, and getting one wrong here means a real allergy risk downstream, not a bad restaurant suggestion.

**Interaction:** a short checklist plus free-input for anything not on the checklist (e.g. a specific allergen). Skippable — "none of these apply to me" is a valid, fast answer, not a screen the user has to fight through.

---

## 5. Screen 4 — Home location and mobility

**Purpose:** the inputs the distance-fairness scoring (A3) and the candidate funnel (B7b) need for every future match.

**Home location (C3b):**
- Set at **neighbourhood granularity, not a street address** — precise enough for the distance math, coarse enough that a group of friends isn't holding each other's home addresses.
- The privacy framing is visible in the UI itself: something like *"We only store your area, never your exact address."*

**Travel tolerance:**
- A **labelled slider**, not a raw number: *"on foot · the neighbourhood · half the city · anywhere."*
- Stored as **kilometres** underneath the slider (decision D2) — a label is what the user sees; a number is what the fairness math needs, and it's the value that gets unit-tested.

**Recurring mobility rules:**
- Optional, e.g. *"no car on Fridays."* These are set here because they're predictable and belong in the standing profile — the alternative (asking about it every single time) is what the "my situation tonight is different" control (C7) exists for instead, and that's for the one-off exception, not the standing rule.

---

## 6. What gets written, end to end

| Screen | Entity | Fields |
|---|---|---|
| 1 — Google sign-in | `User` | Google account identity, calendar grant |
| 2 — Preference game | `PreferenceProfile` | cuisine, budget, atmosphere, noise level |
| 3 — Hard constraints | `PreferenceProfile` | kosher, allergies, fixed unavailable hours |
| 4 — Location & mobility | `PreferenceProfile` | home neighbourhood (lat/lng, area granularity), `tolerance_km`, recurring mobility rules |

A user is not required to belong to a group to complete onboarding — group membership (via the invite link, or created afterward) is a separate step. Onboarding produces a usable profile on its own.

---

## 7. Failure and unavailability states

Everything above is the happy path. This section is what each part of the flow does when something is broken, unreachable, or declined — so none of it has to be improvised while building.

### Before Screen 1 — the invite link itself

| Situation | What happens |
|---|---|
| Token expired | A plain error screen: *"This invite has expired — ask [inviter] to send a new one."* Not a broken page, not a silent redirect to the homepage. |
| Token already used, by someone already onboarded | Sign in and go straight to the group feed. This is the normal case of re-clicking an old email, not a failure — it should not error. |
| Token malformed or unknown | A generic *"this link isn't valid"* screen. No detail about which part failed — a bad token is data from outside the app, not something worth debugging for the visitor. |

### Screen 1 — Google sign-in

| Situation | What happens |
|---|---|
| User declines the consent screen | Back to Screen 1 with the explanation restated. Nothing was created — declining is a valid choice, not an error state. |
| Google's OAuth service is unreachable (network drop, Google outage) | A retry state, not a generic crash screen. This is the one external dependency the flow has no fallback for — there is no local substitute for "can't reach Google." |
| App still in Testing mode, and this Google account isn't on the added-testers list | **Google's own consent screen blocks this before it ever reaches us** — with Google's "app hasn't completed verification" message, which we cannot intercept or restyle. This is exactly why the `calendar.freebusy` / production-publishing question (§9) is load-bearing: every day the app stays in Testing is a day a friend outside the pre-added tester list is silently locked out, at the exact point furthest from anyone on the team noticing. |
| The Google account belongs to a Workspace (school/work) domain whose admin blocks third-party apps | Indistinguishable from a decline on our side — Google refuses before the redirect back to us. No workaround exists; documented as a known limitation, since the target users (spec §1.2 — friend groups) are expected to sign in with personal Gmail accounts, not managed work accounts. |

### Screens 2–4 — the profile steps

| Situation | What happens |
|---|---|
| App closed or connection lost mid-flow | Each screen's answers save as that screen is completed, not only at the very end. Reopening the invite link, or the app directly once signed in, resumes at the next incomplete screen — never back at Screen 1. |
| A save request fails (dropped connection, server error) | The screen stays exactly as filled in, with a retry — never a silent loss of answers the user already gave. |
| Screen 4's location step | **Deliberately has no device-location permission dialog.** The user searches for and picks a neighbourhood by name rather than the app requesting GPS access. This removes an entire class of failure (denied or unavailable location permission, GPS drift, low-accuracy readings) at no product cost, since neighbourhood-level input was already the target granularity — there was never a reason to ask for anything more precise. |

### After the flow — an incomplete profile

| Situation | What happens |
|---|---|
| User signs in but stops before Screen 4 | The account and whatever was completed so far persist as-is. They can still be added to a group and see the feed, but stay **excluded from a matching run's participant set** until the profile is complete — a half-finished profile must never silently feed bad input into the matching agent. |

---

## 8. Acceptance checklist

- [ ] The whole flow (screens 1–4) completes in under a minute for someone who has never seen the app, per success criterion §12.1
- [ ] The Google consent screen lists **only** `calendar.freebusy` — nothing broader
- [ ] A token issued through this flow is still valid **8 days later** (proves the app is not stuck in the 7-day Testing-mode expiry)
- [ ] Declining the Google consent screen returns to Screen 1 with an explanation, not an error page
- [ ] "None of these apply to me" is a valid, fast answer on Screen 3
- [ ] The stored home location is never a precise street address
- [ ] The stored travel tolerance is a number in kilometres, not the slider's label
- [ ] A user can complete onboarding before belonging to any group
- [ ] An expired, used, or malformed invite token each show their own correct state — not a generic crash
- [ ] Closing the app mid-onboarding and reopening the link resumes at the next incomplete screen, not from scratch
- [ ] A user who abandons onboarding early is excluded from matching runs until their profile is complete

---

## 9. Open item

**Before Week 2, a two-minute check (design-review-prep.md §4.6):** confirm in the Google Cloud Console that `calendar.freebusy` is actually classified non-sensitive. The whole "publish In production, skip verification, no 7-day expiry" plan above depends on this. If it turns out to be sensitive after all, this screen still works exactly as designed — only the backend publishing status changes (Testing mode, with a weekly re-consent to plan around).
