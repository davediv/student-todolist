# Student Todo API and planner reference

This is the reference for the implemented REST API and study planner. Paths are relative to the app origin. The same Cloudflare Worker serves the TanStack Start SPA and the Hono app under `/api`.

Generated with `npm run docs:api`. Edit the contract descriptions in `scripts/api-route-contracts.ts` and this narrative in `scripts/api-reference.md`, then regenerate. `docs/API.md` is intentionally local and ignored by Git under the repository's existing documentation policy. The generator checks the actual Hono route table using the same deduplication and middleware exclusion as `tests/api/isolation.test.ts`.

Every request/response example below was captured from an HTTP call to a freshly built local Worker with a disposable migrated D1 database and fake Google credentials. No Google request, production database, deployment, or existing development state is involved. Cookie values and authentication tokens are redacted; resource IDs and timestamps are the values returned by the local app. Examples are a sequence, not independent fixtures: the calendar date advances from Monday `2026-10-19` to Wednesday `2026-10-21` for the overdue cases. Timestamps use the real server clock. Extra setup/error requests do not add routes to the inventory.

## 1. Routes

### Authentication, dates, and errors

The 32 session-protected entries require a Better Auth session cookie and `X-Local-Date: YYYY-MM-DD`. The browser sends its own calendar date on every application request. Authentication is checked before date validation. Every authenticated, date-valid application request records a day of use before the handler runs, including previews and requests that later fail validation. Application JSON handlers use `Cache-Control: no-store`. Raw Better Auth gateway responses and the local sign-in redirect retain their delegated headers and can omit it.

Google is the sole social provider. Email/password sign-in and email sign-up are disabled. The comma-separated allowlist is trimmed and compared without case before creating users or sessions. Session cookies are HttpOnly and SameSite=Lax, and Secure when the auth origin is HTTPS. Better Auth enforces endpoint-specific origin/cookie checks for auth writes; use the configured app origin. Its error redirect goes to `/sign-in`.

The GET and POST `/api/auth/*` entries are gateways. The captured GET example calls `/api/auth/get-session`; the captured POST example calls `/api/auth/sign-out`. Other paths, including Google sign-in/callback and the nonproduction `/api/auth/test-sign-in` plugin, are delegated through these gateways rather than separate Hono registrations. Both test-sign-in entry points are disabled in production. The local wrapper requires an explicit valid, allowlisted `email`; it has no default.

There is no caller-supplied owner selector. Reads and writes use the signed-in user; an unknown resource ID and another student's resource ID both return `404 not_found`. IDs are opaque strings, not a UUID input contract. Successful timestamps serialize as ISO strings, while planner dates have no time or timezone. Durations and capacity are **integer minutes**, not hours.

| HTTP | Application error code | Meaning |
| --- | --- | --- |
| 400 | `invalid_local_date` | Missing or invalid `X-Local-Date` on an authenticated application request |
| 400 | `validation` | Schema, date-range, or field validation failed; optional `fields` maps field names to arrays of messages |
| 401 | `unauthenticated` | No live session; sign in again |
| 403 | `not_allowlisted` | Local sign-in wrapper rejected an email outside the allowlist |
| 404 | `not_found` | Missing/foreign resource, unknown route, or disabled production test-sign-in wrapper |
| 409 | `limits_required` | Set study limits before `/days` or new deadline preview/create |
| 409 | `plan_changed` | Planning revision/day changed, or planning state has no limits; reload state and preview again |
| 409 | `duplicate` | A day off already exists for that date |
| 409 | `deadline_done` | An edit or pending edit targets a Done deadline |
| 409 | `session_ticked` | Untick a study session before moving/resizing it, or choose a target without a ticked session |
| 500 | `internal` | Unexpected handler failure |

Application error shape: `{ error: { code: string, message: string, fields?: Record<string, string[]> } }`. Better Auth's gateway has its own status codes, bodies, and redirects. Do not assume it uses this envelope.

**Malformed JSON caveat:** valid JSON with invalid fields returns `400 validation`. Malformed `application/json` on Hono JSON-validator routes currently reaches the app's catch-all exception handler and returns `500 internal`. PUT limits and new single-deadline preview/create catch their own JSON parse failures and return `400 validation`. This describes the existing implementation; callers should always send valid JSON with the appropriate content type.

### Request schemas

The following are schema descriptions, not sample HTTP bodies. All fields are required unless marked `?`.

```ts
type ISODate = string // valid YYYY-MM-DD calendar date
type Timestamp = string // ISO timestamp from a Date value
type DeadlineType = "assignment" | "exam" | "project" | "reading" | "other"
type PreviewVersion = { revision: number /* integer >= 0 */, today: ISODate }
type Limits = {
  monday: number, tuesday: number, wednesday: number, thursday: number,
  friday: number, saturday: number, sunday: number
} // each integer 0..720, multiple of 30

type DeadlineInput = {
  title: string, // trimmed, 1..120 characters
  type: DeadlineType,
  dueDate: ISODate, // strictly after X-Local-Date
  startDate: ISODate, // strictly before dueDate; may be before today
  estimateMinutes: number, // integer 30..6000, multiple of 30
  notes?: string // defaults to ""
}
type DeadlineEditInput = Partial<DeadlineInput> & { previewVersion?: PreviewVersion }
// Empty edit is accepted. Constraints apply to the merged deadline. Only changing
// dueDate, startDate, or estimateMinutes requires a due date after today.

type TodoInput = { title: string, date?: ISODate | null }
// Trimmed title 1..120; omitted date becomes null; a nonnull new date is >=today.
type TodoPatch = { title?: string, date?: ISODate | null, done?: boolean }
// Strict, nonempty subset. An existing past date may be retained, not newly chosen.
type SessionPatch = { ticked?: boolean, date?: ISODate, minutes?: number }
// Strict, nonempty. ticked cannot accompany date/minutes. minutes is integer
// 30..720 in 30-minute steps; a new date is >=today and <the deadline's dueDate.
type ReplanAllInput = {
  pending?: { id?: string, input: DeadlineInput },
  previewVersion?: PreviewVersion
} // {} is valid; pending.id edits an owned Active deadline, absent id creates one.
type SeriesInput = {
  title: string, type: DeadlineType, estimateMinutes: number, notes?: string,
  weekdays: number[], // 1..7 entries, integers 0=Sunday..6=Saturday; deduped/sorted
  leadDays?: number, // integer 1..60, default 7
  endDate: ISODate, // tomorrow through today+365, inclusive
  previewVersion?: PreviewVersion
} // title/type/estimate/notes follow DeadlineInput; at least one occurrence must fit.
type SeriesScopeInput = {
  title?: string, type?: DeadlineType, notes?: string, estimateMinutes?: number,
  leadDays?: number, endDate?: ISODate, previewVersion?: PreviewVersion
} // Strict; {} is valid. Weekdays cannot be changed. Existing endDate may be kept
// even if past; a changed endDate must be tomorrow through today+365.
```

### Response schemas

```ts
type PlanSession = { date: ISODate, minutes: number }
type Session = {
  id: string, userId: string, deadlineId: string, date: ISODate,
  minutes: number, ticked: boolean, tickedAt: Timestamp | null
}
type DecoratedSession = Session & { title: string, type: DeadlineType, dueDate: ISODate }
type Todo = {
  id: string, userId: string, title: string, date: ISODate | null,
  done: boolean, doneAt: Timestamp | null, doneOn: ISODate | null, createdAt: Timestamp
}
type Deadline = {
  id: string, userId: string, seriesId: string | null, title: string, type: DeadlineType,
  dueDate: ISODate, startDate: ISODate, estimateMinutes: number, notes: string,
  status: "active" | "done", doneAt: Timestamp | null, createdAt: Timestamp
}
type DeadlineSummary = Deadline & {
  tickedMinutes: number, plannedMinutes: number, unplannedMinutes: number
}
type CreationSummary = Omit<DeadlineSummary, "seriesId">
// Creation constructs its summary before rereading D1; seriesId is omitted there.
type DayOff = { id: string, userId: string, date: ISODate, limitMinutes: number }
type Series = {
  id: string, userId: string, title: string, type: DeadlineType, notes: string,
  estimateMinutes: number, weekdays: number[], leadDays: number,
  endDate: ISODate, createdAt: Timestamp
}
type AllPlan = {
  deadlineId: string, title: string, dueDate: ISODate, sessions: PlanSession[],
  keptSessions: { id: string, date: ISODate, minutes: number }[], shortfallMinutes: number
}
type ScopeOccurrence = {
  id: string, dueDate: ISODate, startDate: ISODate, sessions: PlanSession[],
  keptSessions: Session[], shortfallMinutes: number, title: string, type: DeadlineType,
  notes: string, estimateMinutes: number, action: "create" | "update"
}
```

`plannedMinutes` sums stored study sessions, including ticked sessions. A deadline's `unplannedMinutes` is `max(0, estimateMinutes - plannedMinutes)`. Weekly progress sums live study sessions: ticked minutes are done, all minutes are planned; deletions change those totals. It is not an immutable historical ledger.

### Route inventory

<!-- ROUTES -->

### Captured error examples

These calls use the same disposable local fixture. Each example's response was returned by the app, including the implementation-specific malformed JSON behavior.

<!-- ERRORS -->

## 2. How planning works

### Glossary

| Term | Meaning |
| --- | --- |
| Deadline | One piece of work with a due date, start date, type, estimate, and notes |
| Study session | A dated block of a deadline's planned minutes; it has no time of day |
| Daily limit | Available study minutes on a weekday, replaced by a date-specific day-off limit when present |
| Day off | A one-date capacity override, including a zero-minute day; it need not remove every minute |
| Shortfall | Remaining work that does not fit inside the planning window and available capacity |
| Re-plan | Explicitly recalculate eligible unticked study sessions; it is not an automatic background action |

Plain todos have no duration and never consume study capacity. Ticking a study session counts its full duration; there is no timer or partial completion.

### Window, capacity, front-loading, and buffer

1. Start at the later of today and the deadline's start date. End on the day before its due date. Never allocate a session on the due date.
2. For each date, use its day-off override if present, otherwise its weekday daily limit. Subtract reserved study minutes; both ticked and unticked study sessions consume capacity. Capacity cannot be negative.
3. Fill the earliest dates first, using only complete 30-minute steps. Create at most one study session per deadline per date. If that deadline already has a ticked study session on a date, skip that entire date for new work.
4. The final day before the due date is the buffer. It is used only after earlier days fill. If there is only one available day, that day may be used as the buffer fallback.
5. Report unplaced minutes as `shortfallMinutes`. Do not exceed a daily limit or allocate beyond the window to hide a shortfall. With no window, all remaining minutes are shortfall.

For an existing deadline, the remaining work is `max(0, estimateMinutes - all ticked minutes)`. Changing its estimate, start date, or due date replaces all its unticked study sessions. Ticked IDs, dates, durations, and timestamps remain. Changing only title/type/notes leaves the plan in place, including for an existing past-due deadline. Done deadlines cannot be edited.

### Worked example: 6h, 3h/day, Monday, due Friday

The fixture exactly matches `planDeadline > front-loads the PRD's six-hour Monday-to-Friday worked example` in `tests/unit/planner.test.ts`: today and start date Monday `2026-10-19`, due Friday `2026-10-23`, estimate 360 minutes, every daily limit 180 minutes, no existing study sessions or days off. The generator asserts the HTTP preview equals a direct engine call and the expected unit-test result.

<!-- WORKED_EXAMPLE -->

Wednesday has no session. Thursday is the unused buffer; Friday is the due date and is never available. The two sessions total 6h, with zero shortfall.

### Overdue re-plan

An overdue study session is unticked and dated before today. The API's Overdue list and one-tap re-plan include only Active deadlines due today or later. Past-due deadlines must be extended or marked Done separately. Overdue todos are listed too, but study-session re-planning never changes todos.

`POST /api/replan/overdue` removes only affected overdue study-session rows and redistributes their minutes within each deadline's remaining window. It preserves ticked sessions, unrelated deadlines, and existing future allocations. Added overdue minutes can merge into an existing unticked session on the same date, increasing that session's duration without moving its pre-existing minutes. Affected deadlines are processed by soonest due date, then earliest creation time. Work that cannot fit is reported as shortfall.

### Re-plan all

`POST /api/replan/all/preview` previews Active deadlines whose due date is today or later. It releases their unticked reservations, retains every ticked study session and excluded deadlines' allocations, then plans each eligible deadline in due-date order. Ties use the earliest-created deadline. Each completed plan reserves capacity before the next deadline is considered. Start dates and days off apply throughout.

An optional pending new or edited deadline participates in the same ordering and is written atomically with the replacement plan. A preview uses `pending-new` for a new pending deadline; the save returns its real `pendingDeadlineId`, but the current save response's `plans` still use `pending-new`. Saving replaces only eligible unticked study sessions. Cancel sends no save request and changes no planner entities.

### Recurring occurrences

A recurring series chooses one or more weekday numbers, with Sunday=0 through Saturday=6. It generates due dates from tomorrow through its inclusive end date, at most 365 days from today. Lead days default to 7 (range 1–60); each occurrence starts that many calendar days before its due date, even if that is before today.

All occurrences are created up front as ordinary deadlines linked to the series. There is no background scheduler. Occurrences plan in due-date order and reserve shared capacity for later occurrences.

- **This occurrence:** use the normal deadline edit/delete routes.
- **This and following:** use the series/occurrence scope routes. They affect Active occurrences with due dates at or after the chosen anchor, preserving earlier and Done occurrences. The anchor must belong to the owned series; it need not itself be Active. Retained occurrences keep ticked sessions and re-plan their unticked work. Fields omitted from a scoped edit keep individual occurrence exceptions.
- Shortening the end date removes later Active occurrences and all their sessions, including ticked history. Extending it creates missing selected weekdays beyond the previous end date without duplicates. Scoped deletion caps the template end date at the day before the anchor. Weekdays are not editable through the scope routes.

### Saving, concurrency, and manual changes

Previews do not write deadlines, sessions, or series. The middleware can still record the day of use. Saves recompute plans on the server; a client's proposed session list is never authoritative.

Existing-deadline edits, re-plan all, recurring creation, and recurring-scope previews return `previewVersion: { revision, today }`. Send it back on save to reject a stale preview after a relevant write or a new local day. It is optional: without it, the server recomputes from current state. New single-deadline preview/create does not expose a preview version.

Planning writes read a per-user revision, then increment/check it and perform all related writes in one D1 batch. A race rolls back with `409 plan_changed`. Some save responses return the precommit preview version; get a new preview before a later save rather than reusing it. Missing limits also produce `plan_changed` on edit/re-plan/series operations, while `/days` and new deadline preview/create use `limits_required`.

Changing weekday limits or adding/removing a day off changes future planning capacity and the revision; it does not move existing sessions. Manual moves/resizes may exceed a daily limit, in which case the day is over limit. A move date must be today or later and strictly before the due date. Moving onto an unticked session of the same deadline merges them and returns the target ID; a ticked source or target must be unticked first. Deleting a study session leaves unplanned work until an explicit re-plan or planning edit. Marking a deadline Done removes unticked sessions and keeps ticked history; deleting it removes all its sessions.

### Maintenance sources

Check `src/server/api.ts` and `tests/api/isolation.test.ts` for the route inventory; `src/lib/planner.ts` and `tests/unit/planner.test.ts` for allocation; `src/server/planning-state.ts` for revisions; and the deadline, overdue, re-plan-all, series, and series-scope modules for persistence rules. PRD terminology comes from `docs/PRD.md` §3.4, §5.2, and §7. When desired behavior changes, update code, tests, and this reference together.
