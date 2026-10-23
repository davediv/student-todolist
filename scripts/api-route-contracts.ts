export type ApiRouteContract = {
	key: string;
	access: "public" | "session" | "better-auth";
	request: string;
	response: string;
	errors: string;
};

const sessionErrors = "Common session errors apply.";
const validatorJsonError =
	"Malformed JSON may return 500 internal through the existing catch-all handler.";
const planningErrors =
	"409 plan_changed for a stale preview, concurrent plan change, or missing study limits.";
const editErrors =
	"400 validation for invalid changes; 404 not_found for a missing or foreign deadline; 409 deadline_done for a done deadline; 409 plan_changed for a stale preview, concurrent plan change, or missing study limits.";
const scopeErrors =
	"400 validation for invalid series changes; 404 not_found for a missing or foreign series/anchor, or an anchor outside that series; 409 plan_changed for a stale preview, concurrent plan change, or missing study limits.";

/** Schema descriptions only. The documentation generator captures examples locally. */
export const apiRouteContracts: readonly ApiRouteContract[] = [
	{
		key: "GET /api/auth/*",
		access: "better-auth",
		request:
			"Better Auth gateway. Path, query, headers, and cookies depend on the selected auth endpoint; Google callback parameters are handled by Better Auth. No X-Local-Date is required.",
		response:
			"Delegated Better Auth response: endpoint-specific JSON, redirects, and/or Set-Cookie headers. This wildcard is one registered route, not a fixed application response schema.",
		errors:
			"Auth gateway errors and their response envelopes are delegated to Better Auth. Disabled email sign-in/sign-up paths and the production-disabled test sign-in endpoint are handled there; the application catch-all returns 500 internal for uncaught failures.",
	},
	{
		key: "POST /api/auth/*",
		access: "better-auth",
		request:
			"Better Auth gateway. Body and headers depend on the selected auth endpoint, including Google social sign-in and sign-out. Cookie/origin requirements are enforced by Better Auth. No X-Local-Date is required.",
		response:
			"Delegated Better Auth response: endpoint-specific JSON, redirects, and/or Set-Cookie headers. This wildcard is one registered route, not a fixed application response schema.",
		errors:
			"Auth gateway errors and their response envelopes are delegated to Better Auth. Invite-only user/session hooks reject non-allowlisted email addresses; the application catch-all returns 500 internal for uncaught failures.",
	},
	{
		key: "GET /api/test/sign-in",
		access: "public",
		request:
			"Query: email (valid email string). Available only when ENVIRONMENT is not production; the email must be allowlisted. No body or X-Local-Date is required.",
		response:
			"302 redirect to / with a Better Auth session cookie, after finding or creating the local test user and creating a session.",
		errors:
			"403 not_allowlisted for a rejected email; 404 not_found in production. Other query/auth gateway errors are delegated to Better Auth; uncaught failures return 500 internal.",
	},
	{
		key: "GET /api/health",
		access: "public",
		request: "No body, query, cookie, or X-Local-Date is required.",
		response: "200 JSON: { ok: true }.",
		errors: "No route-specific errors; uncaught failures return 500 internal.",
	},
	{
		key: "DELETE /api/account",
		access: "session",
		request:
			"No body. Deletes the authenticated user, owned planner data, linked auth accounts, sessions, and owned verification records.",
		response: "204 with an empty body and cleared authentication cookies.",
		errors: sessionErrors,
	},
	{
		key: "GET /api/me",
		access: "session",
		request: "No body or query.",
		response:
			"200 JSON: { id: string; name: string; email: string; image: string | null } for the authenticated user.",
		errors: sessionErrors,
	},
	{
		key: "GET /api/limits",
		access: "session",
		request: "No body or query.",
		response: "200 JSON: Limits, or null before limits are configured.",
		errors: sessionErrors,
	},
	{
		key: "PUT /api/limits",
		access: "session",
		request:
			"JSON: Limits. All seven weekday fields are required; values are integer minutes from 0 through 720 in multiples of 30. Extra keys are stripped.",
		response: "200 JSON: the saved Limits.",
		errors: `${sessionErrors} 400 validation, including malformed JSON, with field errors for invalid limits.`,
	},
	{
		key: "GET /api/overdue",
		access: "session",
		request: "No body or query. X-Local-Date determines which work is overdue.",
		response:
			"200 JSON: { sessions: DecoratedSession[]; todos: Todo[] }. Sessions are unticked, before today, and belong to active deadlines due today or later; todos are unfinished and dated before today.",
		errors: sessionErrors,
	},
	{
		key: "POST /api/replan/overdue",
		access: "session",
		request:
			"No body is required; supplied body content is ignored. Moves overdue unticked work while retaining existing future sessions and ticked work.",
		response:
			"200 JSON: { plans: { deadlineId: string; title: string; moved: PlanSession[]; movedMinutes: number; shortfallMinutes: number }[] }.",
		errors: `${sessionErrors} 409 plan_changed for concurrent plan changes or missing study limits.`,
	},
	{
		key: "POST /api/replan/all/preview",
		access: "session",
		request:
			"JSON: ReplanAllInput, including optional pending { id?: string; input: DeadlineInput } and optional previewVersion. Use {} for the current saved deadlines. A pending input is complete, not a partial edit; extra top-level keys are stripped.",
		response:
			"200 JSON: { plans: AllPlan[]; previewVersion: PreviewVersion }. Does not save changes. A new pending deadline has deadlineId pending-new in the returned plan.",
		errors: `${sessionErrors} 400 validation for invalid pending input; 404 not_found for a missing or foreign pending.id; 409 deadline_done for a done pending deadline. ${planningErrors} ${validatorJsonError}`,
	},
	{
		key: "POST /api/replan/all",
		access: "session",
		request:
			"JSON: ReplanAllInput. Saves the optional complete pending deadline input and replaces planned unticked sessions for replanned deadlines; ticked sessions are kept. Extra top-level keys are stripped.",
		response:
			"200 JSON: { plans: AllPlan[]; pendingDeadlineId: string | null; previewVersion: PreviewVersion }. pendingDeadlineId is the saved pending ID, while a newly created pending plan still uses deadlineId pending-new in plans. previewVersion describes the pre-save planning state.",
		errors: `${sessionErrors} 400 validation for invalid pending input; 404 not_found for a missing or foreign pending.id; 409 deadline_done for a done pending deadline. ${planningErrors} ${validatorJsonError}`,
	},
	{
		key: "POST /api/todos",
		access: "session",
		request:
			"JSON: TodoInput. title is trimmed to 1–120 characters; optional date is YYYY-MM-DD or null and defaults to null. A non-null date must be today or later. Unknown keys are rejected.",
		response: "201 JSON: { todo: Todo }, initially unfinished.",
		errors: `${sessionErrors} 400 validation for invalid fields, a past date, or unknown keys. ${validatorJsonError}`,
	},
	{
		key: "PATCH /api/todos/:id",
		access: "session",
		request:
			"Path: id (owned todo ID). JSON: TodoPatch, with at least one of title, date, or done. Unknown keys are rejected. An unchanged existing past date is allowed; changing to a different past date is rejected.",
		response:
			"200 JSON: { todo: Todo }. Setting done preserves its first doneAt/doneOn until unticked, which clears both fields.",
		errors: `${sessionErrors} 400 validation for invalid/empty changes, unknown keys, or changing to a past date; 404 not_found for a missing or foreign todo. ${validatorJsonError}`,
	},
	{
		key: "DELETE /api/todos/:id",
		access: "session",
		request: "Path: id (owned todo ID). No body.",
		response: "200 JSON: { deleted: string } containing the deleted todo ID.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign todo.`,
	},
	{
		key: "GET /api/days",
		access: "session",
		request:
			"Query: from and to (YYYY-MM-DD), inclusive and ordered, covering 1–31 calendar days. No body.",
		response:
			"200 JSON: { days: { date: string; isDayOff: boolean; limitMinutes: number; plannedMinutes: number; overLimit: boolean; sessions: DecoratedSession[]; todos: Todo[] }[]; anytime: Todo[] }. Todos are unfinished or completed on X-Local-Date; anytime contains the undated todos.",
		errors: `${sessionErrors} 400 validation for missing/invalid dates, reversed range, or more than 31 days; 409 limits_required before limits are configured.`,
	},
	{
		key: "GET /api/days-off",
		access: "session",
		request: "No body or query.",
		response:
			"200 JSON: DayOff[], sorted by date and limited to dates on or after X-Local-Date.",
		errors: sessionErrors,
	},
	{
		key: "POST /api/days-off",
		access: "session",
		request:
			"JSON: { date: string; limitMinutes: number }. date is YYYY-MM-DD on or after today; limitMinutes is an integer from 0 through 720 in multiples of 30. Extra keys are stripped.",
		response:
			"201 JSON: DayOff. Saves the capacity override without moving existing sessions.",
		errors: `${sessionErrors} 400 validation for invalid input; 409 duplicate if this user already has an override for the date; 409 plan_changed for a concurrent plan change. ${validatorJsonError}`,
	},
	{
		key: "DELETE /api/days-off/:id",
		access: "session",
		request: "Path: id (owned day-off ID). No body.",
		response:
			"200 JSON: { deleted: string } containing the deleted day-off ID.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign day off; 409 plan_changed for a concurrent plan change.`,
	},
	{
		key: "PATCH /api/sessions/:id",
		access: "session",
		request:
			"Path: id (owned study-session ID). JSON: SessionPatch. Supply ticked alone, or date and/or minutes; the object must be nonempty and reject unknown keys. date is YYYY-MM-DD; minutes is an integer from 30 through 720 in multiples of 30. A supplied date must be today through the day before the deadline due date.",
		response:
			"200 JSON: { session: Session }. Moving onto another unticked session for the same deadline merges minutes and returns the target session, deleting the source; manual edits may exceed capacity.",
		errors: `${sessionErrors} 400 validation for invalid patch or date range; 404 not_found for a missing or foreign session; 409 session_ticked when resizing/moving ticked work or merging into a ticked target; 409 plan_changed for a concurrent plan change. ${validatorJsonError}`,
	},
	{
		key: "DELETE /api/sessions/:id",
		access: "session",
		request: "Path: id (owned study-session ID). No body.",
		response:
			"200 JSON: { deleted: string } containing the deleted session ID.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign session; 409 plan_changed for a concurrent plan change.`,
	},
	{
		key: "GET /api/stats/weekly",
		access: "session",
		request:
			"No body or query. X-Local-Date selects the current Monday–Sunday week.",
		response:
			"200 JSON: { weeks: { startDate: string; endDate: string; doneMinutes: number; plannedMinutes: number }[] }. Exactly four weeks, current first, summing surviving owned sessions by session date; ticked sessions contribute to both totals.",
		errors: sessionErrors,
	},
	{
		key: "POST /api/series/preview",
		access: "session",
		request:
			"JSON: SeriesInput & { previewVersion?: PreviewVersion }. At least one selected weekday must occur after today through endDate. Extra keys are stripped.",
		response:
			"200 JSON: { occurrences: { dueDate: string; startDate: string; sessions: PlanSession[]; shortfallMinutes: number }[]; previewVersion: PreviewVersion }. Does not save a series or sessions.",
		errors: `${sessionErrors} 400 validation for invalid fields or no occurrence before endDate. ${planningErrors} ${validatorJsonError}`,
	},
	{
		key: "POST /api/series",
		access: "session",
		request:
			"JSON: SeriesInput & { previewVersion?: PreviewVersion }. Saves the template, generated occurrences, and their planned sessions atomically. Extra keys are stripped.",
		response:
			"201 JSON: { series: Series; occurrences: { id: string; dueDate: string; startDate: string; sessions: PlanSession[]; shortfallMinutes: number }[] }. Each occurrence ID identifies its created deadline.",
		errors: `${sessionErrors} 400 validation for invalid fields or no occurrence before endDate. ${planningErrors} ${validatorJsonError}`,
	},
	{
		key: "GET /api/series/:id",
		access: "session",
		request: "Path: id (owned series ID). No body.",
		response: "200 JSON: { series: Series }.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign series.`,
	},
	{
		key: "POST /api/series/:seriesId/occurrences/:id/preview",
		access: "session",
		request:
			"Path: seriesId (owned series ID), id (owned anchor deadline in that series). JSON: SeriesScopeInput. Applies to active occurrences due on/after the anchor due date; unknown keys, including weekdays, are rejected. {} is valid. Extending endDate can create occurrences; shortening it can remove them.",
		response:
			"200 JSON: { occurrences: ScopeOccurrence[]; removed: { id: string; title: string; dueDate: string }[]; previewVersion: PreviewVersion }. New occurrence IDs use new:<dueDate>; no changes are saved.",
		errors: `${sessionErrors} ${scopeErrors} ${validatorJsonError}`,
	},
	{
		key: "PATCH /api/series/:seriesId/occurrences/:id",
		access: "session",
		request:
			"Path: seriesId (owned series ID), id (owned anchor deadline in that series). JSON: SeriesScopeInput. Updates the template and this/following active occurrences, retains ticked sessions on retained occurrences, and deletes all sessions for removed occurrences. {} is valid; unknown keys are rejected.",
		response:
			"200 JSON: { occurrences: ScopeOccurrence[]; removed: { id: string; title: string; dueDate: string }[] }. Newly added occurrences contain persisted deadline IDs; generated sessions are date/minute plans, not persisted session records.",
		errors: `${sessionErrors} ${scopeErrors} ${validatorJsonError}`,
	},
	{
		key: "DELETE /api/series/:seriesId/occurrences/:id",
		access: "session",
		request:
			"Path: seriesId (owned series ID), id (owned anchor deadline in that series). No body. Deletes active occurrences due on/after the anchor due date and truncates the series endDate; done occurrences remain.",
		response:
			"200 JSON: { deleted: string[] } containing deleted deadline IDs.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign series/anchor, or an anchor outside that series; 409 plan_changed for concurrent plan changes or missing study limits.`,
	},
	{
		key: "POST /api/deadlines/preview",
		access: "session",
		request:
			"JSON: DeadlineInput. Due date must be after today; start date must precede due date and may precede today. Extra keys are stripped.",
		response:
			"200 JSON: { sessions: PlanSession[]; shortfallMinutes: number }. Does not create a deadline or sessions.",
		errors: `${sessionErrors} 400 validation, including malformed JSON, with field errors for invalid deadline input; 409 limits_required before limits are configured.`,
	},
	{
		key: "POST /api/deadlines",
		access: "session",
		request:
			"JSON: DeadlineInput. Creates an active standalone deadline and the newly calculated sessions atomically; does not accept a preview token. Extra keys are stripped.",
		response:
			"201 JSON: { deadline: CreationSummary; sessions: PlanSession[]; shortfallMinutes: number }. Immediate deadline response contains the submitted fields and summary totals; seriesId is not included in this creation response.",
		errors: `${sessionErrors} 400 validation, including malformed JSON, with field errors for invalid deadline input; 409 limits_required before limits are configured; 409 plan_changed if capacity or the plan revision changes while saving.`,
	},
	{
		key: "GET /api/deadlines",
		access: "session",
		request: "No body or query.",
		response:
			"200 JSON: { pastDue: DeadlineSummary[]; active: DeadlineSummary[]; done: DeadlineSummary[] }. Done status takes precedence; pastDue means an active deadline due before X-Local-Date. Each group is ordered by due date then creation time.",
		errors: sessionErrors,
	},
	{
		key: "GET /api/deadlines/:id",
		access: "session",
		request: "Path: id (owned deadline ID). No body.",
		response:
			"200 JSON: { deadline: DeadlineSummary; sessions: Session[] }, with sessions ordered by date.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign deadline.`,
	},
	{
		key: "POST /api/deadlines/:id/preview",
		access: "session",
		request:
			"Path: id (owned deadline ID). JSON: DeadlineEditInput. Partial fields and optional previewVersion; {} is valid and extra keys are stripped. Changing dueDate, startDate, or estimateMinutes requires a due date after today; metadata-only edits may retain a past due date.",
		response:
			"200 JSON: { sessions: PlanSession[]; keptSessions: Session[]; shortfallMinutes: number; previewVersion: PreviewVersion }. No changes are saved; keptSessions are ticked sessions.",
		errors: `${sessionErrors} ${editErrors} ${validatorJsonError}`,
	},
	{
		key: "PATCH /api/deadlines/:id",
		access: "session",
		request:
			"Path: id (owned deadline ID). JSON: DeadlineEditInput. Partial fields and optional previewVersion; {} is valid and extra keys are stripped. Planning-field changes replace unticked sessions while retaining ticked sessions; metadata-only changes keep every session.",
		response:
			"200 JSON: { deadline: Deadline; sessions: PlanSession[]; keptSessions: Session[]; shortfallMinutes: number }. This deadline is a raw record without the GET summary totals.",
		errors: `${sessionErrors} ${editErrors} ${validatorJsonError}`,
	},
	{
		key: "POST /api/deadlines/:id/done",
		access: "session",
		request:
			"Path: id (owned deadline ID). No body is required; supplied body content is ignored. Marks the deadline done and deletes unticked sessions, retaining ticked sessions and the original doneAt if already done.",
		response: "200 JSON: { deadline: Deadline }.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign deadline; 409 plan_changed for a concurrent plan change.`,
	},
	{
		key: "DELETE /api/deadlines/:id",
		access: "session",
		request:
			"Path: id (owned deadline ID). No body. Deletes the deadline and all its sessions, including ticked sessions.",
		response:
			"200 JSON: { deleted: string } containing the deleted deadline ID.",
		errors: `${sessionErrors} 404 not_found for a missing or foreign deadline; 409 plan_changed for a concurrent plan change.`,
	},
];
