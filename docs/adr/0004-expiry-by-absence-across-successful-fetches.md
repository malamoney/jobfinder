# Expiry by absence across successful Fetches

A Posting is marked Expired when a Board that was fetched **successfully** stops returning it across
two consecutive Fetches. Expired Postings are retained in the database, never deleted, because
Review State outlives the listing — a Posting a User marked `applied` disappearing from their own
tracker is the worst failure this application could have. No Source offers a "this job is closed"
signal, so absence is the only available evidence.

## The invariant

**Only a successful Fetch of a Board is evidence of absence.** Anything else — a network error, a
timeout, a non-2xx response, or a **source response that fails schema validation** — marks the
Board's fetch task as errored and leaves every one of that Board's Postings untouched, including
`last_seen_at`.

This matters most for validation failures, because they are the case that looks like success. The
request returned 200, the body parsed as JSON, and only the shape was wrong. If that path is allowed
to fall through to "this Board returned no Postings," then a single renamed or added field at
Greenhouse silently expires every Greenhouse Posting in the Corpus over two nights, with no error
anyone would notice until the dashboard is empty.

Source response schemas therefore validate only the fields we depend on and strip everything else
(see the strict-inbound / lenient-outbound rule), and a validation error is routed to the error path
and never to the absence path. This must be covered by a test that asserts a malformed source
response expires nothing.
