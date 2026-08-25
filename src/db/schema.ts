// The application's Drizzle schema.
//
// Deliberately empty: #3 sets up the harness only. #4 adds the better-auth
// user and session tables, #5 adds the Corpus (Postings), and later tickets
// add Boards, fetch runs, Criteria, and Review State.
//
// `resetDatabase()` in `src/test/database.ts` truncates every table in the
// `public` schema before each test, so no table declared here keeps rows
// between tests and reference data must be seeded per test.

export {};
