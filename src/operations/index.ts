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
 * upsert, and persistence together. The only lower seam the spec allows is
 * pure normalizers, which get tested directly.
 */

export {
  addBoard,
  listBoards,
  seedBoards,
  type BoardEntry,
  type CuratedBoard,
} from "./boards";
export { readCriteria, saveCriteria } from "./criteria";
export {
  readDashboard,
  type Dashboard,
  type DashboardFilter,
  type DashboardPosting,
} from "./dashboard";
export {
  boardTimeoutFor,
  fetchBoard,
  type Board,
  type BoardAddress,
  type BoardFetchOptions,
} from "./fetch-board";
export { probeBoard, type BoardProbe } from "./probe";
export {
  readFetchRun,
  runFetchBatch,
  startFetchRun,
  type FetchBatchOptions,
  type FetchBatchResult,
  type FetchRunId,
  type FetchRunReport,
  type FetchTaskReport,
} from "./fetch-run";
export {
  drainAndRematch,
  drainFetchQueue,
  readLatestFetchRun,
  requestFetch,
  DEFAULT_DRAIN_BUDGET_MS,
  FETCH_COOLDOWN_MS,
  type DrainOptions,
  type DrainResult,
  type FetchFailure,
  type FetchRequestOutcome,
  type FetchRunSummary,
} from "./fetch-schedule";
export { matchAllUsers, matchCriteria } from "./matching";
export { isExpired, listPostings } from "./postings";
export { pruneNonUsPostings, PRUNE_BATCH_SIZE } from "./prune";
export {
  readPosting,
  setNotes,
  setSaved,
  setStatus,
  type PostingDetails,
} from "./review";
