# The Fetch schedule is system-wide, not user-configurable

The Fetch runs on one fixed nightly cron (`0 3 * * *`) for the whole application. Users cannot
configure when it runs, and the settings page deliberately offers no control over it.

This is a deliberate reversal of a stated requirement — the original brief asked for the schedule to
be configurable in the UI — and the reversal follows from two later decisions. Because the Corpus is
shared and the Fetch is corpus-wide (ADR 0001), there is no per-User Fetch to schedule; running one
per User is precisely what that decision forbids. And because Matches are computed by SQL against
the existing Corpus in milliseconds, a User's results are always current at page load and never need
recomputing on a timer. A per-User schedule would therefore control nothing observable.

An earlier draft of this decision had an hourly cron tick with a per-User due-check, to work around
Vercel Cron schedules being fixed in `vercel.json` at deploy time. That workaround is unnecessary
once nothing is scheduled per User.

Do not reintroduce per-User scheduling to make the settings page feel richer. The one case that
would genuinely justify it is a per-User notification digest, which is deferred; if that ships, the
thing being scheduled is the digest, not the Fetch.
