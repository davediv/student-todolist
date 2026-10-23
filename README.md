# Student Todo

A private study planner for a small group of students. Add deadlines and estimated work, preview study sessions within your daily limits, and manage sessions and plain todos from Today and Upcoming. Each Google account has its own data.

The app runs as a React SPA with TanStack Start, a Hono API, Better Auth Google sign-in, and Drizzle on Cloudflare D1. Development runs the Worker in local workerd through the Cloudflare Vite plugin; production runs on Cloudflare Workers.

## Prerequisites

- Node.js 22.12 or newer and npm (Node.js 24 is also supported).
- Git, a Google account, and a browser.
- For real Google sign-in: a Google Cloud project and an OAuth web client.
- For deployment: a Cloudflare account on Workers Free, with a workers.dev subdomain. Wrangler is installed in this project's dev dependencies; use `npx wrangler`, without a global install.

## Local setup

```bash
git clone https://github.com/davediv/student-todolist.git
cd student-todolist
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` using the values below. Generate a random authentication secret, then paste its output into `BETTER_AUTH_SECRET`:

```bash
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

| Binding | Local value | Production value |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `production`, set in `env.production.vars` in `wrangler.jsonc` |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters | A separate random secret, stored as a Worker secret |
| `BETTER_AUTH_URL` | `http://localhost:3000` | The exact HTTPS origin, without a trailing slash, in `env.production.vars` |
| `GOOGLE_CLIENT_ID` | OAuth web client ID | OAuth web client ID registered for the production callback |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret | OAuth web client secret, stored as a Worker secret |
| `ALLOWED_EMAILS` | Comma-separated permitted Google emails, for example `student@example.com,friend@example.com` | The builder and invited students' Google emails, stored as a Worker secret |
| `DB` | Local D1 binding from top-level `wrangler.jsonc` | Remote D1 binding from `env.production.d1_databases` |

Email matching trims whitespace and ignores case. An empty allowlist permits nobody. `.dev.vars` is ignored by Git; keep real credentials out of source control. Production secrets are configured separately and are not uploaded from `.dev.vars`.

Apply migrations and start the app:

```bash
npm run db:migrate:local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). A signed-out browser reaches the sign-in screen. Local D1 data is stored under `.wrangler/state/` and survives server restarts. No Cloudflare login or remote database is needed for local development.

The example's placeholder Google values are enough to load the sign-in screen and use the local test route. Real Google sign-in needs the OAuth setup below. For a local session without Google, open:

[http://localhost:3000/api/test/sign-in?email=student@example.com](http://localhost:3000/api/test/sign-in?email=student@example.com)

The email must be in the local allowlist. This creates a local session and redirects to the app; new students set their weekday study limits first. This route and Better Auth's test sign-in endpoint are disabled when `ENVIRONMENT=production`.

If port 3000 is occupied, stop the conflicting development server or use a different port consistently: change `BETTER_AUTH_URL`, register the matching Google callback, and start `npm run dev -- --port 3002 --strictPort`. A port chosen automatically by Vite does not update OAuth settings.

## Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create the project, then open **Google Auth platform**. In **Branding**, enter the app name, support email, and developer contact email. Choose **External** in **Audience** to allow the builder and friends with personal Google accounts; Internal is limited to the selected Workspace organization.
2. Keep the app in **Testing** while setting it up and add the builder and invited accounts under **Audience → Test users**. These Google test users and the app's `ALLOWED_EMAILS` are separate settings; configure both. Before a wider release, review Google's publishing requirements in Audience.
3. In **Data Access**, use only the basic sign-in scopes `openid`, `email`, and `profile`. The app does not require Gmail, Calendar, or other Google API access.
4. In **Clients**, create an OAuth client with application type **Web application**. Add these **Authorized redirect URIs** exactly:

   ```text
   http://localhost:3000/api/auth/callback/google
   https://<worker>.workers.dev/api/auth/callback/google
   ```

   Replace `<worker>` with the complete hostname prefix from the production deploy output, including the account subdomain. The configured production origin is `https://student-todolist.davdiv.workers.dev`, so its callback is `https://student-todolist.davdiv.workers.dev/api/auth/callback/google`. For your own account, substitute your deployed hostname. These are redirect URIs, not just JavaScript origins. Scheme, hostname, port, and path must match; do not add a trailing slash.
5. Copy the client ID and client secret into `.dev.vars`, then restart the dev server. Set the same values as production secrets before deploying. Separate local and production OAuth clients are also supported if each has its respective callback.
6. Click **Sign in with Google** locally. An allowlisted account should return to first-run limits or Today. An account absent from `ALLOWED_EMAILS` should see **This app is invite-only** and receive no app session.

See Google's [consent-screen setup](https://developers.google.com/workspace/guides/configure-oauth-consent) and [web application OAuth configuration](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred). A `redirect_uri_mismatch` means the configured callback differs from the request, commonly because `BETTER_AUTH_URL` or the port is wrong.

## Commands and tests

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite, local Worker, and local D1 on port 3000 |
| `npm run build` | Build the default local configuration; does not deploy |
| `npm run preview` | Build and serve the local production bundle with local bindings |
| `npm run test:unit` | Pure planning, date, and validation tests in Node |
| `npm run test:web` | React and routing tests in jsdom |
| `npm run test:api` | Hono, auth, and database tests in workerd with isolated local D1 |
| `npm test` | All three Vitest projects |
| `npm run test:e2e` | Three critical browser journeys against an isolated local app |
| `npm run test:a11y` | WCAG 2.2 AA scans in light/dark mode and keyboard journeys against an isolated built app |
| `npm run format:check` | Check formatting |
| `npm run lint` | Check lint rules |
| `npm run typecheck` | Check TypeScript |
| `npm run check` | Combined Biome check |
| `npm run db:generate` | Generate a migration after changing the Drizzle schema |
| `npm run db:migrate:local` | Apply committed migrations to local D1 |
| `npm run generate-routes` | Regenerate the file-route tree |
| `npm run cf-typegen` | Regenerate Worker binding types after config changes |
| `npm run deploy:prod` | Build the production environment and deploy it |

Tests provide their own fake Google credentials and use the development-only sign-in route. They do not contact Google or a remote D1 database. The API test project needs a runtime that permits workerd to bind local sockets.

Install browser binaries once with `npx playwright install chromium`. Browser tests create disposable local D1 state and fake credentials; they do not use `.dev.vars`. The accessibility suite saves axe JSON, accessibility trees, and screenshots in the Playwright report. It checks all app screens and the overdue, over-limit, and offline states, including 24×24 px controls and keyboard focus. Run browser checks and builds sequentially; the default accessibility port is 3022 (`BROWSER_TEST_PORT` overrides it).

For Google sign-in in `npm run preview`, set `BETTER_AUTH_URL` to the preview origin (normally `http://localhost:4173`) before building and register that origin's `/api/auth/callback/google` URI too. Restore the local development origin before using `npm run dev` again.

After a schema change, review the generated SQL under `migrations/`, apply it locally, and run the affected API tests. Do not edit or delete migrations that have already been applied to production.

## Performance

Install Chromium once with `npx playwright install chromium`, then run these checks sequentially:

```bash
npm run bench:planner
npm run perf:today
```

Each command builds the app and starts a temporary local Worker with its own migrated D1 database, fake authentication, and seeded student. It removes that state on exit and never uses the development or production database. The default ports are 3020 and 3021 respectively; set `BROWSER_TEST_PORT` to choose a free port. Run browser/build commands sequentially because Cloudflare's build integration shares a deployment-config pointer.

The planner check seeds 50 active deadlines and their sessions, warms each preview once, then measures 20 HTTP requests per endpoint, including the response body. It reports median and nearest-rank p95; either p95 at or above 300 ms fails the command.

The Today check measures navigation until a seeded study-session checkbox is visible, over five fresh Chromium contexts at 390×844 with 4× CPU slowdown. It uses Chrome's [Fast 4G preset](https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/cdp/PredefinedNetworkConditions.ts): 8.1 Mbps download, 1.35 Mbps upload, and 165 ms latency. HTTP caches and persisted query caches start empty; service workers are blocked. The fixture uses the current Jakarta date so native browser timing remains untouched. A median at or above 2,000 ms fails the command.

Measured locally on 2026-10-23, macOS arm64, Node v24.21.0:

| Check | Median | p95 | Target |
| --- | --- | --- | --- |
| `POST /api/deadlines/preview`, 50 active deadlines | 8.8 ms | 10.8 ms | p95 <300 ms |
| `POST /api/replan/all/preview`, 50 active deadlines | 10.0 ms | 11.4 ms | p95 <300 ms |
| Today list visible, cold mobile load | 1,568.2 ms | — | median <2,000 ms |

These are local built-app measurements, not production latency or a Google OAuth benchmark. Today starts fetching its plan in the route loader while its UI code loads.

## Code layout

- `src/routes/`: TanStack Start file routes, app layout and route guards; the app uses SPA mode so calendar dates come from the student's browser.
- `src/routes/api/$.ts`: Catch-all route that forwards HTTP methods and Worker bindings to the Hono app.
- `src/server/`: Hono API routes, authentication/allowlist guards, request-local dates, and atomic planner mutations.
- `src/lib/planner.ts`: Pure scheduling engine. Durations are integer minutes; dates are ISO calendar dates.
- `src/lib/`: Typed Hono client, TanStack Query options, form schemas, and auth clients. Authenticated app requests include the browser's `X-Local-Date` header.
- `src/components/`: Reusable planner, deadline, todo, and form UI.
- `src/db/schema.ts`, `migrations/`: Drizzle schema and versioned D1 migrations, including Better Auth tables.
- `tests/unit/`, `tests/web/`, `tests/api/`: The three Vitest projects configured in `vitest.config.ts`.
- `wrangler.jsonc`, `vite.config.ts`: Source Worker bindings/environments and the Cloudflare Vite integration.

## Deploy to workers.dev

Production uses the named `production` environment and a remote D1 database. The top-level development binding remains local. The configured target below is not live until you complete the deployment. Keep `ENVIRONMENT=production` in `env.production.vars` so neither test sign-in endpoint is available.

1. Authenticate:

   ```bash
   npx wrangler login
   ```

   This repository already configures the remote `student-todo` database for the builder's account. When deploying to a different account, create a database once if it does not already exist:

   ```bash
   npx wrangler d1 create student-todo --config wrangler.jsonc
   ```

   Put the returned database ID in `env.production.d1_databases[0].database_id` in `wrangler.jsonc`. Keep `binding: "DB"`, `database_name: "student-todo"`, and `migrations_dir: "migrations"`. Do not replace the local binding's placeholder ID with the remote ID. Workers Free is sufficient for this app's configuration.
2. Confirm the production Worker name and your account's workers.dev subdomain in Cloudflare. This repository sets `env.production.name` to `student-todolist`; the configured account's origin is `https://student-todolist.davdiv.workers.dev`. For your own account, set `env.production.vars.BETTER_AUTH_URL` to your exact HTTPS origin and register its Google production callback. `BETTER_AUTH_URL` is public configuration; do not also create a secret with that name. If your account does not yet have a workers.dev subdomain, set it up in **Workers & Pages** first.
3. Set the secrets with Wrangler's interactive prompts:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env production --config wrangler.jsonc
   npx wrangler secret put GOOGLE_CLIENT_ID --env production --config wrangler.jsonc
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env production --config wrangler.jsonc
   npx wrangler secret put ALLOWED_EMAILS --env production --config wrangler.jsonc
   ```

   Use a separate production auth secret, real OAuth credentials, and the production email allowlist. The explicit source config makes these administrative commands select the named environment even after a build has generated a flattened deployment config.
4. Apply remote migrations, then build and deploy:

   ```bash
   npx wrangler d1 migrations apply DB --remote --env production --config wrangler.jsonc
   npm run deploy:prod
   ```

   `deploy:prod` runs these two steps in order:

   ```bash
   CLOUDFLARE_ENV=production npm run build
   npx wrangler deploy
   ```

   The Cloudflare Vite plugin selects the production environment **at build time** and writes a flattened `dist/**/wrangler.json` plus a `.wrangler/deploy/config.json` pointer. Wrangler automatically deploys that built config; do not add `--env production` to the deploy command or force the source config for deployment. See [Cloudflare's Vite environment documentation](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).
5. Verify the release using the exact URL from deploy output:

   ```bash
   curl -sSI 'https://<worker>.workers.dev/api/health'
   curl -i 'https://<worker>.workers.dev/api/test/sign-in?email=student@example.com'
   npx wrangler tail --env production --config wrangler.jsonc
   ```

   Health should return 200 over HTTPS without `-k`; test sign-in should return 404. Open `/upcoming` directly to confirm the SPA deep link loads. Complete real Google sign-in with an allowlisted account, set limits, and preview/save a deadline. Check that a non-allowlisted account is rejected and the production session cookie has `HttpOnly`, `Secure`, and `SameSite=Lax`. Workers Logs are enabled by `observability.enabled`; `wrangler tail` streams live logs (Ctrl+C to stop).

## Restore D1 with Time Travel

D1 Time Travel is always enabled. **Workers Free retains 7 days** of recovery history; Workers Paid retains 30 days. See the [current D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Time Travel guide](https://developers.cloudflare.com/d1/reference/time-travel/).

Before a risky migration, record the current production bookmark:

```bash
npx wrangler d1 time-travel info DB --env production --config wrangler.jsonc
```

To inspect the bookmark for a UTC time within your retention window, replace the example timestamp:

```bash
npx wrangler d1 time-travel info DB --timestamp='2026-10-23T10:00:00Z' --env production --config wrangler.jsonc
```

Restoring overwrites the production database in place, loses changes after that point, and interrupts in-flight queries. Record the current bookmark first, then substitute the recovery bookmark and confirm Wrangler's prompt:

```bash
npx wrangler d1 time-travel restore DB --bookmark='<recovery-bookmark>' --env production --config wrangler.jsonc
```

Wrangler prints a previous bookmark that can undo the restore within the retention window. Restoring the database also restores its migration history; compare the restored schema with the deployed app before accepting new traffic. Time Travel is for remote D1, not the local emulator.

## Read the success metric

Authenticated API requests record one row per student and browser-local date in `activity_days`. The goal is at least three distinct days of use per week for the builder and at least two friends throughout the term.

Run the checked-in query against local or production D1:

```bash
npx wrangler d1 execute DB --local --config wrangler.jsonc --file scripts/activity-metric.sql
npx wrangler d1 execute DB --remote --env production --config wrangler.jsonc --file scripts/activity-metric.sql
```

[`scripts/activity-metric.sql`](scripts/activity-metric.sql) groups by student and ISO week (Monday–Sunday, with the ISO week-year):

```sql
SELECT
  u.id AS user_id,
  u.email,
  strftime('%G-W%V', a.date) AS iso_week,
  COUNT(*) AS days_used,
  COUNT(*) >= 3 AS meets_goal
FROM activity_days AS a
JOIN user AS u ON u.id = a.user_id
GROUP BY u.id, u.email, iso_week
ORDER BY iso_week, u.email;
```

`meets_goal` is `1` for at least three days and `0` otherwise. Only weeks with activity appear; missing weeks count as zero when assessing the full term. Treat the current partial week separately. Public health/auth requests do not count, and deleting an account also deletes its activity history.

The API query test makes authenticated requests with three distinct `X-Local-Date` values, checks repeat requests are deduplicated, keeps students separate, and covers the ISO year boundary (`2021-01-01` belongs to `2020-W53`):

```bash
npm run test:api -- activity-metric
```
