/**
 * The primary seam: the operations the application performs.
 *
 * Per the testing decisions in #2, one module exports the operations — run a
 * Fetch, match a User's Criteria, read the Dashboard, mutate Review State,
 * read and write Criteria — and tests call these directly against a real
 * Postgres, with MSW supplying whatever a Source returns.
 *
 * Source adapters are deliberately tested *through* this seam rather than
 * given their own, so a single assertion exercises the adapter, the Source Key
 * upsert, and persistence together.
 *
 * Deliberately empty until #5 adds the first real operation. The worked
 * example of the shape lives in `src/test/harness-operations.ts`; the only
 * lower seam the spec allows is pure normalizers, which get tested directly.
 */

export {};
