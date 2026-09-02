import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readPosting } from "@/operations";
import { sanitizeDescription } from "@/postings/description";
import { AppNav } from "../../app-nav";
import { formatAge, formatSalary } from "../../format";
import { PostingTags } from "../../posting-tags";
import { ReviewControls } from "./review-controls";

export const metadata: Metadata = { title: "Posting · Jobfinder" };

/**
 * One Posting in full: everything the Source published, and the controls for
 * recording what the User thought of it.
 *
 * A Server Component, so the description is sanitized on the server and the
 * User is checked before anything renders. An unknown id — or one that is not a
 * Posting in the shared Corpus — is a 404, not an error.
 */
export default async function PostingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const signedIn = await currentUser(await headers());
  if (!signedIn) redirect("/login");

  const { id } = await params;
  const posting = await readPosting(signedIn.id, id);
  if (!posting) notFound();

  return (
    <>
      <AppNav />
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-20">
        <Link href="/dashboard" className="self-start text-sm underline">
          ← Back to dashboard
        </Link>

        {/* The same heading and tag treatment as the Dashboard card (#63), so a
            card and the page it opens read as one product: company and age, a
            large title, then the Arrangement and signal pills. */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-text-body">{posting.company}</span>
            <span className="text-xs text-label">
              {formatAge(posting.postedAt)}
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            {posting.title}
          </h1>

          <PostingTags posting={posting} />

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-body">
            <Fact label="Location" value={posting.location ?? "Not given"} />
            {/* Extraction (#11) fills salary from the Posting's text where it
                states one; an unknown reads as "not listed", never a number (#36). */}
            <Fact label="Salary" value={formatSalary(posting)} mono />
          </dl>

          <a
            href={posting.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start rounded-md border border-accent-edge bg-accent-wash px-4 py-2 text-sm font-medium text-accent-text"
          >
            Apply on the employer’s site
          </a>
        </header>

        <ReviewControls postingId={posting.id} review={posting.review} />

        <article
          className="description max-w-2xl text-sm leading-relaxed"
          // The HTML has been through `sanitizeDescription`: scripts, styles,
          // event handlers, and `javascript:` links do not survive it.
          dangerouslySetInnerHTML={{
            __html: sanitizeDescription(posting.description),
          }}
        />
      </main>
    </>
  );
}

function Fact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  /** Salary reads as a figure — the mono face, like every other number. */
  mono?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-label">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}
