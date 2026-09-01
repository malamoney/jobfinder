# One shell width for every page behind the login

Every page that renders `AppNav` — the Dashboard, the Posting page, the Criteria page — uses the
same outer container: `mx-auto max-w-6xl px-6`, with `pt-24` to clear the fixed nav. The nav's own
inner container is the same `mx-auto max-w-6xl px-6`, so a page's content and the "Jobfinder" mark
in the nav share a left edge at every viewport.

Content that wants a narrower measure is held inside that shell, not by shrinking it: the Posting
description is `max-w-2xl`, and the Criteria form is a single `max-w-2xl` column left-aligned within
the wide shell.

## Why write it down

#60 gave the Dashboard `max-w-2xl`. #63 widened the Dashboard, the Posting page, and the nav to
`max-w-6xl` but deliberately left the Criteria form narrow "unless it looks stranded" — and it did:
the nav mark sat far left while the form heading sat centered two hundred pixels in, on the one
page where the two are most obviously meant to line up. #71 widened its shell to match and wrote down the
rule below.

The rule is now: a page behind the login does not choose its own shell width. If a new page reads
too wide, hold its *content* narrow inside the `max-w-6xl` shell, the way the Posting description
and the Criteria form already do.

## Not the signed-out pages

The landing page (`src/app/page.tsx`) and the auth pages (`login`, `signup`, via `credentials-form`)
are outside this. They have no nav, they are vertically centred, and they are a card, not a
document — `max-w-2xl` / `max-w-sm`. There is nothing for them to line up with.
