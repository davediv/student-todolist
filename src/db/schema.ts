import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = () => ({
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date()),
});
export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.notNull()
		.default(false),
	image: text("image"),
	planRevision: integer("plan_revision").notNull().default(0),
	...timestamps(),
});
export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		token: text("token").notNull().unique(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		...timestamps(),
	},
	(t) => [index("session_user_id_idx").on(t.userId)],
);
export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		...timestamps(),
	},
	(t) => [index("account_user_id_idx").on(t.userId)],
);
export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps(),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const activityDays = sqliteTable(
	"activity_days",
	{
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		date: text("date").notNull(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.date] })],
);

export const studyLimits = sqliteTable("study_limits", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	monday: integer("monday").notNull(),
	tuesday: integer("tuesday").notNull(),
	wednesday: integer("wednesday").notNull(),
	thursday: integer("thursday").notNull(),
	friday: integer("friday").notNull(),
	saturday: integer("saturday").notNull(),
	sunday: integer("sunday").notNull(),
	setAt: integer("set_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

export const deadlines = sqliteTable(
	"deadlines",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		type: text("type", {
			enum: ["assignment", "exam", "project", "reading", "other"],
		}).notNull(),
		dueDate: text("due_date").notNull(),
		startDate: text("start_date").notNull(),
		estimateMinutes: integer("estimate_minutes").notNull(),
		notes: text("notes").notNull().default(""),
		status: text("status", { enum: ["active", "done"] })
			.notNull()
			.default("active"),
		doneAt: integer("done_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [index("deadlines_user_due_idx").on(t.userId, t.dueDate)],
);
export const studySessions = sqliteTable(
	"study_sessions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		deadlineId: text("deadline_id")
			.notNull()
			.references(() => deadlines.id, { onDelete: "cascade" }),
		date: text("date").notNull(),
		minutes: integer("minutes").notNull(),
		ticked: integer("ticked", { mode: "boolean" }).notNull().default(false),
		tickedAt: integer("ticked_at", { mode: "timestamp_ms" }),
	},
	(t) => [
		uniqueIndex("study_sessions_deadline_date_idx").on(t.deadlineId, t.date),
		index("study_sessions_user_date_idx").on(t.userId, t.date),
	],
);
