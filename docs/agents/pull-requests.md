# Pull requests

How to write a PR description in this repo.

## Every PR opens with a TLDR

The **first** section of every PR body, immediately after the `Closes #N` line, is:

```markdown
## TLDR;

<what this PR solves, in simple terms>
```

Write it the way you would explain the change to someone who does not work on this codebase:
what was wrong or missing before, what is true now, and why that matters. No domain jargon, no
type names, no library names unless the library *is* the point. Prefer a concrete image over an
abstraction — "a door you could try unlimited keys on" lands where "unbounded authentication
attempts" does not.

It is not a summary of the diff. It is the answer to "what does this solve?"

A few sentences to a few short paragraphs. If it needs more than that, the PR is probably doing
more than one thing.

## What goes under it

The rest of the body is for whoever reviews the code: what changed and why, decisions that were
close calls, defects found along the way, and what was deliberately left undone. Say plainly
where something is unverified or only partly met — a reviewer who finds a gap you did not mention
stops trusting the parts you did.

## Why the TLDR is first

The people who most need to know what a change does are the least likely to read to the end of a
PR body. Putting it last means it is read by exactly the people who did not need it.
