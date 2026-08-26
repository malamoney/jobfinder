# Jobfinder

Fetches job openings on a schedule, filters them against your stated criteria, and presents the
matches for review.

`CONTEXT.md` is the glossary — Posting, Board, Corpus, Criteria, Match, Review State — and its
vocabulary is used throughout the code. Decisions that were hard to reverse are recorded in
`docs/adr/`.

## Stack

Next.js 16 with React 19 and TypeScript, Tailwind 4, Neon Postgres through Drizzle. Tests run on
Vitest against a real Postgres, with outbound HTTP controlled by MSW.

## Getting started

Requires Node 22+, pnpm, and a Postgres you can reach.

```bash
pnpm install
cp .env.example .env.local   # then fill in DATABASE_URL
pnpm dev
```

## Database

`DATABASE_URL` is a standard Postgres connection string. Neon is reached over the ordinary Postgres
wire protocol through its pooled connection string, so the same driver serves production, local
development, and tests.

```bash
pnpm db:generate   # generate a migration from src/db/schema.ts
pnpm db:migrate    # apply migrations to DATABASE_URL
```

## The curated set of Boards

A sweep covers the Boards listed in `scripts/data/greenhouse-boards.ts`, maintained by hand.
Curation rather than harvesting is a cost decision — see ADR 0003.

```bash
pnpm seed:boards   # probe every listed Board, then write it to the curated set
pnpm discover      # harvest fresh candidates, probe them, print what is worth promoting
```

Seeding probes each Slug before writing it, so it proves the set is fetchable rather than
asserting it, and a Board that cannot be read is added disabled rather than skipped. Both are
safe to re-run: a Board keeps the id its Postings already reference.

`pnpm discover` is run by hand and by nothing else. It writes nothing — it harvests candidate
Slugs from Common Crawl, probes a random sample of them, and prints the live ones ranked by how
many roles they have open. Promoting a Board means pasting its Slug into the seed file and
re-running `pnpm seed:boards`. Roughly one in six Slugs goes dead over time, so the set needs
re-validating periodically; `listBoards()` reports each Board's last Fetch outcome.

```bash
pnpm discover -- --limit 300      # probe 300 candidates rather than the default 200
pnpm discover -- --records 50000  # read fewer crawl records when harvesting
```

## Tests

```bash
pnpm test          # once
pnpm test:watch    # watch mode
```

Tests need a running Postgres and nothing else. The test database is created and migrated
automatically on the first run; `.env.test` holds the local default, and `.env.test.local`
(gitignored) is where to put an override if your Postgres wants credentials.

### The testing convention

`src/test/harness.test.ts` is the worked example every later test copies. Four rules hold:

- **Test at the primary seam.** `src/operations` exports the operations the application performs —
  run a Fetch, match Criteria, read the Dashboard, mutate Review State. Tests call these directly.
  Source adapters are tested *through* this seam rather than given their own, so one assertion
  exercises the adapter, the upsert, and persistence together. The only lower seam is pure
  normalizers, which are tested directly.
- **A real database, never a fake.** Operations reach for the same `getDb()` handle in tests as in
  production, pointed at a test database. No test-shaped hole for injecting a client.
- **HTTP is controlled with MSW, not an injected client.** Code under test calls `fetch` exactly as
  it does in production; a test declares the responses it needs with `server.use(...)`. A request no
  test declared fails loudly rather than reaching the network.
- **Assert on externally observable behaviour** — what ended up stored, what came back — rather than
  on how the code got there.

Each test starts from empty tables: `resetDatabase()` truncates the `public` schema before every
test. Truncating rather than wrapping each test in a transaction is what lets the code under test
manage transactions of its own, which Fetch orchestration needs when it claims tasks. Nothing
survives between tests, so reference data such as Boards is seeded per test. Because the suite
shares one database, `fileParallelism` is off — concurrent files would truncate each other's rows
mid-test.

`src/db/test-schema.ts`, `drizzle/test/`, and `src/test/harness-operations.ts` exist only to give
the harness something real to exercise. They are never applied to production.

## CI

`.github/workflows/ci.yml` runs `typecheck`, `lint`, `test`, and `build` on every pull request and
on pushes to `main`. The `test` job runs against a Postgres service container.

These four job names are what the `required_status_checks` rule on the `main` ruleset names.
