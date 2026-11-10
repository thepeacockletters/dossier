# Developing Dossier

Next.js 16 (App Router) + Prisma 7 + SQLite, run with Node.js 24 and Yarn 4 on the host. For installing and running Dossier, see the [README](README.md); for how it's secured, [SECURITY.md](SECURITY.md).

## Getting started

```bash
corepack enable                 # Yarn, at the version pinned in package.json
yarn install
cp .env.example .env
yarn hash-password              # set DOSSIER_PASSWORD in .env to what it prints
# set DOSSIER_SECRET (openssl rand -base64 32) in .env
# set DATABASE_URL to a file by its full path, e.g. file:/Users/you/dossier/data/dossier.db
# set DOSSIER_DATA_DIR to a folder for backups, e.g. /Users/you/dossier/data
yarn generate
yarn prisma migrate deploy
yarn prisma db seed
yarn dev
```

Open [http://localhost:3000](http://localhost:3000). `yarn dev` hot-reloads as you edit, and keeps its build in `.next/dev`, apart from a production build. `./data`, the usual home for the database file and backups, is ignored by git.

`.env.example` documents every variable. The server refuses to start while `DOSSIER_PASSWORD` or `DOSSIER_SECRET` is missing, `DOSSIER_PASSWORD` isn't a password hash, or the secret is shorter than 32 characters, and logs which variable to fix.
Server code reads configuration from the validated `env` object instead of `process.env`:

```ts
import { env } from "@/lib/env";
```

After pulling changes, run `yarn install`, `yarn generate` and `yarn prisma migrate deploy` before `yarn dev`.

## Database

Dossier keeps its data in one SQLite file, named by `DATABASE_URL` (`file:` and the file's full path). `src/lib/database.ts` makes the client.

Define models in `prisma/schema.prisma`, then create and apply a migration, and regenerate the client:

```bash
yarn prisma migrate dev --name <migration-name>
yarn generate
```

Since Prisma 7, `migrate dev` no longer runs `prisma generate` on its own; restart `yarn dev` afterwards. A test checks that the migrations make exactly the schema.

Keep to what SQLite does:

- No `skipDuplicates` and no `SELECT … FOR UPDATE`: lock a row with a write that changes nothing, `UPDATE "Application" SET id = id WHERE id = …`.
- Inside `prisma.$transaction(async (tx) => …)`, query through `tx` only. SQLite has one connection, so a query through `prisma` waits until the transaction ends, and the transaction times out. Transactions run one at a time, so they need no locks of their own.
- Enums sort by name, not in the order they're declared.
- What Prisma doesn't manage is added to the migrations by hand: the built-in themes' delete trigger, and `COLLATE NOCASE` for the unique Skill and Language names. NOCASE only ignores the case of ASCII letters.
- SQLite can't change most columns in place, so for those Prisma's migration rebuilds the table: it creates `new_<Table>`, copies the rows, drops the old table and renames the new one. That drops the trigger (on Theme) and `COLLATE NOCASE` (on Skill and Language) too. When a migration rebuilds one of these tables, add them back by hand: `COLLATE NOCASE` in its `CREATE TABLE`, and the trigger after the rename, as in `prisma/migrations/20261102120000_init/migration.sql`. The database tests fail when one is missing.

To browse and edit rows, run `yarn prisma studio` and open [http://localhost:5555](http://localhost:5555). It has no sign-in and can edit every row, so stop it when you're done.

Query the database from server code with the shared client:

```ts
import { prisma } from "@/lib/prisma";
```

JSON columns (document units, the posting's extracted details, the match, chat edits) are validated with the zod schemas in `src/lib/application-data.ts`.
Change an application's status only through `setStatus` in `src/lib/status-actions.ts` (or `changeStatus()` in client code, which adds the Undo toast), so the funnel figures stay consistent.

### Seed data

`yarn prisma db seed` creates the six built-in themes, an empty profile and default settings. It never overwrites your profile or settings. To load the prototype's sample data (Jane Doe and nine applications):

```bash
yarn prisma db seed -- --demo           # refuses if you already have a profile or applications
yarn prisma db seed -- --demo --reset   # deletes your profile and applications first
```

## Mutations and private routes

Every mutation goes through one of two helpers. Both check the session first, keep unexpected errors out of responses (they're logged on the server without the data involved), and let `redirect()` and `notFound()` work as usual.

**Server Actions** are the default. Define them with `action(schema, handler)` in a `"use server"` file: the input is validated with zod, and the action returns `{ ok: true, data, toast? } | { ok: false, error, fieldErrors? }`, with messages written for the user.

```ts
// src/app/(app)/settings/actions.ts
"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";

export const renameTheme = action(
  z.object({ id: z.string(), name: z.string().trim().min(1, "Give the theme a name.") }),
  async ({ id, name }, { toast }) => {
    const theme = await prisma.theme.findUnique({ where: { id } });
    if (!theme) throw new ActionError("That theme no longer exists."); // shown to the user
    await prisma.theme.update({ where: { id }, data: { name } });
    toast(`Renamed to “${name}”.`);
    return { id, name };
  },
);
```

On the client, `toastResult()` from `@/components/toast` shows the action's `toast` or its error, and `toast("…")` shows any other message:

```tsx
const result = toastResult(await renameTheme({ id, name }));
```

Next.js already refuses Server Actions whose `Origin` doesn't match the host (or `X-Forwarded-Host` behind a proxy), so keep `experimental.serverActions.allowedOrigins` empty unless the proxy rewrites the host. Action bodies are limited to 1 MB, so large uploads such as imports go through a route handler.

**Route handlers** are for responses a Server Action can't give: files (PDFs, exports), uploads and progress streams. Wrap them in `route()`, which also refuses cross-origin requests (403) and signed-out ones (401), and marks responses `Cache-Control: private, no-store` unless the handler sets its own.

```ts
// src/app/api/pdf/[id]/route.ts
import { route } from "@/lib/route";

export const GET = route<RouteContext<"/api/pdf/[id]">>(async (request, { params }) => {
  const { id } = await params;
  const pdf = await renderPdf(id);
  return new Response(pdf, { headers: { "content-type": "application/pdf" } });
});
```

Both get the session from `getSession()` in `src/lib/auth/session.ts` (see [Sign-in](#sign-in)).

## Sign-in

Dossier has one user and no accounts: you sign in with the password that `DOSSIER_PASSWORD` is a hash of. The session is an encrypted token (JWE, keyed from `DOSSIER_SECRET`) in an HttpOnly, SameSite=Lax cookie, so nothing is stored on the server. It lasts until the browser closes, but at most 24 hours; with "Keep me signed in", 30 days.

The hash is argon2id with OWASP's settings (19 MiB, 2 passes, 1 lane) from Node's own `crypto.argon2`, made by `yarn hash-password` (`scripts/hash-password.ts`, which the image bundles as the `hash-password` command). Checking a password against it is in `src/lib/auth/password-hash.ts`, and `src/lib/env.ts` refuses anything that isn't a hash. It's written as `argon2id:m=19456,t=2,p=1:<salt>:<hash>` rather than the usual `$argon2id$v=19$…`, because Next.js and Docker Compose expand `$` in `.env` files, even inside quotes. The settings are part of each hash, so stronger ones can come later without breaking existing hashes.

Sign out from the sidebar ends the session in that browser. To sign out everywhere, set `DOSSIER_PASSWORD` to a new hash (even of the same password, since each has its own salt) or rotate `DOSSIER_SECRET` and restart: every session carries a fingerprint of the password and is encrypted with a key from the secret, so all existing sessions stop working. Rotating the secret also means API keys saved in Settings have to be entered again, since they're encrypted with it too.

In server code, `getSession()` returns the session or null, and `verifySession()` (for pages and layouts) sends the visitor to `/login` when there is none. `action()` and `route()` already check it.

Failed sign-ins are rate-limited in the database: after 5 failures within a minute from one IP, attempts are refused for 30 seconds, then 60, 120 and so on up to 15 minutes. The IP is the last `X-Forwarded-For` entry, which is the real client behind a reverse proxy but can be faked when the app is exposed directly, so 30 failures within 10 minutes from all IPs together also trigger the backoff. If you lock yourself out while developing, clear the counters with `DELETE FROM "LoginThrottle"` in `yarn prisma studio`, or `sqlite3 data/dossier.db 'DELETE FROM "LoginThrottle"'`.

## AI provider

Dossier reads job postings and writes drafts with the model you choose in Settings → AI provider: a local model through Ollama or llama.cpp, LM Studio, any OpenAI-compatible server, Anthropic or Mistral. Until you save a choice there, the `DOSSIER_AI_*` variables decide (see `.env.example`). API keys are stored encrypted with a key derived from `DOSSIER_SECRET`, and never sent back to the browser.

A server that speaks OpenAI's API with a difference (an address people tend to get wrong, a header it requires, a field every request needs) doesn't need a provider of its own: give it an entry in `src/lib/ai/providers/servers.ts` and a case in `servers.test.ts`. DeepSeek, OpenRouter and OpenCode are there already.

Long AI tasks run as background jobs (`src/lib/jobs`): the page follows their named steps as they happen and picks them up again after a reload. A job's input and result hold personal data, so they don't last: a job that works on an application names it (`startJob(…, { applicationId })`) and is deleted with it, and finished jobs are deleted once they're older than **Keep task data for** in Settings → Your data (`src/lib/jobs/retention.ts`). Keep nothing in a job that has to outlast that; Undo on a toast and a page reattaching after a reload are fine. The prompts live in `src/lib/ai/tasks`; in strict mode ("Never invent experience", on by default) a fact guard flags names and numbers that aren't in the profile or the posting.

The Usage screen shows the tokens each task used, as the servers counted them. Every request names its task (`task`, one of `USAGE_TASKS` in `src/lib/usage.ts`, where a new task gets its label), and a provider passes each answer's counts to `call.used`, null where the server sends none. That includes answers it asks again and answers that end in an error, since those used tokens too. Nothing of the prompt or the answer is kept.

To try the AI features without a hosted provider, run a small model with [Ollama](https://ollama.com) (`ollama pull qwen2.5:3b`, about 2 GB) and pick Local model in Settings with the address `http://localhost:11434`.

The tests use a mock provider. To check the providers and prompts against real models, run the live tests, which are skipped otherwise:

```bash
AI_LIVE=ollama yarn vitest run src/lib/ai/providers.live.test.ts src/lib/ai/tasks/tasks.live.test.ts
```

`AI_LIVE=mistral` checks Mistral instead, with the key saved in Settings → AI provider while Mistral is chosen there, or with `DOSSIER_AI_KEY` (and `DOSSIER_AI_MODEL`) passed with `-e`.

`AI_LIVE=anthropic` checks Anthropic in `providers.live.test.ts` the same way, with the key saved while Anthropic is chosen, or with `-e DOSSIER_AI_KEY=…` (and `DOSSIER_AI_MODEL`, by default `claude-haiku-4-5`). Besides the provider checks, it imports a profile from a short resume: the profile's schema is too large for the API's structured output, so it goes in the prompt instead (#230).

`AI_LIVE=lmstudio` checks LM Studio, with the model saved in Settings while LM Studio is chosen there, or with `-e DOSSIER_AI_MODEL=…` (and `DOSSIER_AI_URL`, by default `http://host.docker.internal:1234`). A model that isn't loaded gets loaded and stays loaded until you eject it.

## Job search

Find jobs (`/jobs`) searches the job source chosen in Settings → Job search: JSearch, Adzuna, FreeHire or the Bundesagentur für Arbeit. Until a choice is saved, `DOSSIER_JOBS_SOURCE` and the key variables decide (see `.env.example`). In the code, "job" already means a background task (`Job`, `src/lib/jobs`), so a job ad is a "posting", and job search lives in `src/lib/job-search`:

- `search.ts` and `sources.ts`: the query and posting shapes every source maps to, the URL format, and what each source covers. Shared with the browser.
- One adapter per source (`jsearch.ts`, `adzuna.ts`, `arbeitsagentur.ts`, `freehire.ts`), behind `index.ts`, which checks the country, caches answers in memory for 30 minutes and logs a source that changed or isn't answering, without the search. Failures are a `JobSearchError` with a message for the screen.
- `config.ts`: which source and key are in effect. Job source keys are encrypted like the AI key, each kind of secret under its own derived key (`src/lib/secrets.ts`). FreeHire needs no key; `DOSSIER_FREEHIRE_URL` points at a self-hosted catalogue when set.
- `src/lib/postings.ts`: the `Posting` table holds what the user saved, dismissed or started an application from. `src/lib/posting-searches.ts`: every search, kept with what it found (`PostingSearch`) until the user removes it, so opening one again asks the source nothing.

The tests use answers in each source's shape (`src/test/job-search-fixtures.ts`). The live tests check the real services, and are skipped otherwise. JSearch and Adzuna spend searches from your plan; the Arbeitsagentur and FreeHire are free:

```bash
JOBS_LIVE=jsearch JSEARCH_TEST_KEY=… yarn vitest run src/lib/job-search/jsearch.live.test.ts
JOBS_LIVE=arbeitsagentur yarn vitest run src/lib/job-search/sources.live.test.ts
JOBS_LIVE=adzuna ADZUNA_TEST_APP_ID=… ADZUNA_TEST_KEY=… yarn vitest run src/lib/job-search/sources.live.test.ts
JOBS_LIVE=freehire yarn vitest run src/lib/job-search/sources.live.test.ts
```

## Scoring

Score in Find jobs and the job agent score postings with what Settings → Scoring chose (`src/lib/scoring`): the AI model's `score-posting` task, or Jev, TypeSafe's System One model, with the user's TypeSafe key. Until a choice is saved, `DOSSIER_SCORER` and `DOSSIER_TYPESAFE_KEY` decide. `loadPostingScorer()` in `index.ts` sets up either one; both give a score from 0 to 100 with up to four reasons and three red flags, and `scoredWith` names what made it.

Jev answers typed questions and writes no text, so `jev.ts` asks, in one request, three Scores about the whole posting (how much of it the profile covers, how close the past work is, the level), three Nouls (a location or permit the profile can't meet, a missing language, a posting too thin to judge) and, for each line `posting-lines.ts` finds (bullets and sentences, wrapped lines joined), whether it's asked of applicants and whether the profile shows it. Code weighs the Scores (`JEV_WEIGHTS`), takes off for the mismatches and quotes the lines: "Covers: …", "Missing: …". `typesafe.ts` is the HTTP client: it retries 429 and 529 and turns failures into an `AiError` with a message for people.

The live tests ask the real Jev with the key saved in Settings → Scoring, or `DOSSIER_TYPESAFE_KEY`, and spend tokens on that account. `check` scores two postings against the demo profile; `compare` scores the job agent's latest 40 candidates again, against the profile in the database, and prints Jev's scores next to the AI model's, what was done with each posting, and the weights that would come closest to the AI model's scores. To compare on your own data, import an export of it into the development app first (Settings → Your data, which backs up what's there):

```bash
JEV_LIVE=check yarn vitest run src/lib/scoring/jev.live.test.ts
JEV_LIVE=compare yarn vitest run src/lib/scoring/jev.live.test.ts
```

## Your data

Settings → Your data exports everything (profile, custom themes, settings, applications with their history, documents, chat and notes, and the postings kept from Find jobs) as one JSON file, and imports such a file to restore it. An import replaces all data in one transaction, after writing a backup of the current data to `DOSSIER_DATA_DIR/backups` (default `/data`; `./data` in development, which git ignores). "Download all PDFs" zips every tailored document there too, in `downloads`, and removes the zip once it's downloaded.

With "Nightly backups" on (the default), the app writes the same export to `backups` every night at 03:00 server time and deletes backups older than `DOSSIER_BACKUP_RETENTION_DAYS` (14 by default). The timer runs inside the app process, so run a single instance of the app. These are the app's own backups: back up the PostgreSQL database itself too, the way your host does it (for example `pg_dump` on a schedule), or the SQLite file: stop the app and copy the file.

### Import size limit

Import files and resume imports are capped at 50 MB. The limit comes from Next.js, which buffers request bodies up to [`experimental.proxyClientMaxBodySize`](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize) (set to 50 MB in `next.config.ts`) because `src/proxy.ts` runs on every request; larger bodies are cut off, so the app refuses them up front. To accept bigger files, raise that option together with `IMPORT_MAX_BYTES` in `src/lib/import-limits.ts` and `RESUME_MAX_BYTES` in `src/lib/resume-text.ts`. Behind a reverse proxy, its own limit applies as well: with nginx, raise `client_max_body_size` (see [Troubleshooting](https://github.com/AienTech/dossier/wiki/Troubleshooting) in the wiki).

## Job agent

The job agent (`src/lib/agent`, the `/agent` screen and Settings → Job agent) runs up to three named recurring searches on one shared daily schedule, scores what's new and can prepare drafts. Disabled searches count toward the three-search storage cap but consume no source requests:

- **`agent-scan`** (`run.ts`, defined in `jobs.ts` with the key `agent`): one batch, protected by a PostgreSQL session advisory lock (on SQLite, one process on one file, a lock held in the process; `scan-lock.ts`). The other agent locks are transaction advisory locks through `lockForTransaction()` (`src/lib/db-lock.ts`), which does nothing on SQLite, where transactions already run one at a time. It snapshots all enabled searches and the shared source configuration, requests only the first page of each search sequentially in saved order, and continues after individual source failures. It drops what Find jobs has saved, dismissed or applied for and what the agent has seen (`newPostings()`, by source and id or by `agentDedupeKey()`, a hash of the link without tracking parameters, else of company, title and place). Unique new postings are scored round-robin across searches, newest first within each, with one shared score cap and automatic-draft cap, not one cap per search.
  Scoring uses the provider chosen in Settings → Scoring (`src/lib/scoring`, see [Scoring](#scoring)).
- **`agent-draft`** (`draft.ts`, keyed `agent-candidate:<id>`): one draft. The candidate is claimed (SCORED → DRAFTING → DRAFTED) so nothing makes two, and the documents are written by `createApplicationFromDocuments()` in `src/lib/application-create.ts`, which New application uses too. The draft is `origin: AGENT` with `awaitingReview` set, which keeps it off Applications, the board, the dashboard and Find jobs until Approve.
- **Limits** (`runs.ts`): the durable `agentRuns` ledger counts source requests, not batches or Job rows (which the task-data sweep deletes). At most **3 source requests in any rolling 24 hours**, including attempted failures. Admission reserves enough slots for the entire enabled collection atomically; a two-search batch waits when only one slot remains, rather than running a subset. Dispatch timestamps move slots to actual attempt time. Interrupted scans conservatively keep every reserved slot, even if not sent, because dispatch and persistence cannot be atomic; reconciliation marks their outcome interrupted. Manual runs also wait at least an hour after the previous run. AI evaluation and drafts use the shared `agentMaxScores` and `agentMaxDrafts` limits.
- **Schedule** (`schedule.ts`): a timer in the process, like the nightly backups, that checks every 15 minutes and starts the day's batch after `agentHour` in `lastKnownTimeZone()`, with an additional wake at quota expiry. Budget deferral can shift the effective daily run time until the whole batch fits. Run one app instance. At startup, candidates left DRAFTING go back to SCORED.

Recurring searches are stored in `AgentSearch`, through `src/lib/agent/searches.ts` (`listAgentSearches`, `saveAgentSearch`, `deleteAgentSearch`). `src/lib/agent/search.ts` shares the normalized input schema and fixed cap of three with forms. Settings uses authenticated Server Actions for create/edit/reorder/toggle/delete; execution reads the collection directly, with no legacy settings bridge. Toggles patch only `enabled` by ID under the shared search-write lock and validate the current query's country when enabling, so a stale tab cannot overwrite another tab's name, query or order. Explicit editor saves still replace the submitted form values; they are not a general edit-conflict merge. Writes and imports serialize the cap check with a transaction advisory lock; disabled searches count too. Attribution takes the same lock before reading, so imports and wipes cannot remove its foreign-key targets mid-write. `AgentCandidateSearch` links only kept candidates, with immutable name snapshots and a nullable search link, so renaming or deleting a search doesn't rewrite history. Deleting a search leaves candidates, applications and historical labels intact; deleting a candidate cascades its attribution. Candidate dismissal takes the same lock and deletes its attribution, including deleted-search labels. Undo restores the candidate's content, not its old labels. `attributeAgentCandidates()` checks eligibility through its transaction and links source results to existing candidates, including overlaps, without storing raw result pages. Later independent Find jobs saves or dismissals do not erase historical candidate labels.

Backup/export schema **11** includes `agentSearches` and `agentCandidateSearches`, with stable IDs, query/order/enabled state and historical labels (including deleted-search labels). Imports of schemas 1–10 convert a meaningful `agentQuery` setting to “My search”, repairing optional fields just like SQL, without inventing past attribution. SQL performs that conversion during an upgrade and removes the setting; v8 imports ignore `agentQuery`. Provider credentials remain global and excluded unless explicitly requested on export. The `agentRuns` ledger is installation-local, excluded from exports and preserved across imports so a restore cannot reset quota. Delete everything removes it with searches, candidates and attribution.

Per-search history reports **source collection**, not successful AI evaluation: found/new counts can overlap between searches and precede batch dedupe/scoring. A completed source request can coexist with model failure; its batch outcome is shown separately. Candidate attribution retains historical names after search rename/delete, but candidate dismissal removes it. Rendering is read-only: it shows interrupted reservations when no queued/live scan owns them, without acquiring the execution lock or changing the ledger; the next scan persists reconciliation under execution ownership. The broader scan-versus-destructive-import lifecycle race is pre-existing and not solved by the narrow attribution lock: an import/wipe can replace scan inputs while a batch is in flight. Do not treat that lock as whole-scan lifecycle serialization.

Database tests cover migration/bootstrap, backup round-trips, exclusion/overlap, reservation accounting and schedule deferral. No real source or paid AI requests are needed.

## Usage ping

The usage ping is opt-in. A production server asks once after sign-in (`src/app/(app)/usage-ping-dialog.tsx`, shown by the signed-in layout while nobody has answered and `DOSSIER_TELEMETRY` isn't set) and sends nothing before a yes. After one, on each day someone signed in opens a page, it sends `https://telemetry.dossier.aien.me/ping` the install's random ID and the version, once (`src/lib/usage-ping.ts`, called with `after()` from the signed-in layout). `DOSSIER_TELEMETRY=on` or `off` answers in advance and wins while it's set.

The answer, when it was given and the version of the question's text are the settings `usagePingChoice`, `usagePingChoiceAt` and `usagePingChoiceText`; the ID and the day of the last ping are `usagePingId` and `usagePingDay`. Exports leave them all out and imports keep them (`INSTALL_SETTINGS` in `src/lib/data-export.ts`). A no deletes the ID. When the question's text changes, raise `USAGE_PING_TEXT_VERSION`, and everyone is asked again. Development servers and tests never ask or send it (`NODE_ENV` isn't `production`).

The receiving end is a small service on the project's own server that isn't published with the app. Change what the ping sends only together with it, the wiki's [Privacy](https://github.com/AienTech/dossier/wiki/Privacy) page and Settings → About.

## Announcements

The project can publish short notices, such as a security fix, and each page shows them in a card over the page (`src/app/(app)/announcement-notice.tsx`), one at a time, until they're dismissed. The sidebar's notice is for updates only. The signed-in layout starts the check after a page load, using the settings it read anyway, so a page costs nothing until a check is due (`src/lib/announcements/check.ts`). When to ask next comes from the answer's `Cache-Control`, between 1 hour and 7 days.

- **The request carries nothing about the install,** only `User-Agent: Dossier`. Which notices apply (version range, expiry, dismissed) is decided on the install (`src/lib/announcements/visible.ts`).
- **A failure changes nothing:** the last good answer stays, and nothing is shown or logged.
- **Notices are plain text,** with one optional link, which can go anywhere on the web. Anything but `http` or `https` is dropped, because the link becomes an `href`. This is not a channel for advertising.

The answer and the dismissed IDs are the settings `announcementFeed` and `announcementsDismissed`, which exports leave out and imports keep (`INSTALL_SETTINGS` in `src/lib/data-export.ts`).

The backend is the project's own service and isn't published with the app. `src/lib/announcements/api-v1.schema.json` is a copy of its contract, and a test compares it with what the app reads, so update the copy when the contract grows. The API only grows, so the app ignores what it doesn't know.

A production server asks `https://api.dossier.aien.me/v1`. A development server only asks while `DOSSIER_API_URL` is set, and then on every page, so a change shows without the wait: the first reload asks, and the next one shows it. To try it against a local copy of the backend, set that variable, for example in an untracked `compose.override.yml`. The variable isn't in `.env.example` or `compose.production.yml`, because nobody running the image needs it.
## Tests and checks

Tests use [Vitest](https://vitest.dev). They read `.env` and run in UTC:

```bash
yarn test          # run all tests once
yarn test:watch    # re-run tests on change
yarn test:coverage # run once with coverage (report in coverage/index.html)
yarn lint
yarn typecheck     # generates Next.js route types, then runs tsc
```

Put tests next to the code they cover. `*.test.ts` files run in Node (server code, pure logic);
`*.test.tsx` files run in jsdom with [Testing Library](https://testing-library.com) and its `jest-dom` matchers (components and hooks).
`*.db.test.ts` files run against a real database: the file next to `DATABASE_URL`'s with `_test` added to its name (`data/dossier_test.db`), or `TEST_DATABASE_URL`, which is created and migrated at the start of each run, and which each test empties with `resetDatabase()` from `src/test/db.ts`.
They refuse to run against a file whose name doesn't end in `_test`, so your development data is never touched.

The coverage thresholds in `vitest.config.mts` ratchet: they sit a few points below the coverage when they were set, and `yarn test:coverage` fails if coverage drops below them. Raise them when you add tests.

## The production image

The `Dockerfile` makes the production image. It holds the standalone Next.js server, Playwright's Chromium for PDFs, and Prisma's CLI for migrations, runs as `node`, and starts with `docker/start.sh`: `prisma migrate deploy`, the seed (compiled with esbuild at build time), then the server. To build and try it with Docker:

```bash
docker build -t dossier:local .
DOSSIER_IMAGE=dossier:local DOSSIER_PORT=3300 docker compose -f compose.production.yml -p dossier-local up -d
```

## Reset

Stop the server and delete the database file (and its `-journal`, if there is one), then run `yarn prisma migrate deploy` and `yarn prisma db seed` again.
