import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readPosting } from "@/operations";
import { sanitizeDescription } from "@/postings/description";
import { AppNav } from "../../app-nav";
import { formatAge, formatSalary } from "../../format";
import { MonoLabel } from "../../mono-label";
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
      {/* The shell is `max-w-6xl` for every page behind the login (ADR 0012).
          This page's sections — the header, the review panel, the description —
          all span it, so no section sits wider than the one stacked under it. */}
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-20">
        <Link
          href="/dashboard"
          className="self-start text-[12.5px] text-label hover:text-text"
        >
          ← Back to dashboard
        </Link>

        {/* The same heading and tag treatment as the Dashboard card (#63), so a
            card and the page it opens read as one product: company and age, a
            large title, then the Arrangement and signal pills (canvas 4a). */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-label">
            <span>{posting.company}</span>
            <span>{formatAge(posting.postedAt)}</span>
          </div>

          <h1 className="text-[27px] font-medium leading-tight tracking-tight">
            {posting.title}
          </h1>

          <PostingTags posting={posting} />

          <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
            <Fact label="Location" value={posting.location ?? "Not given"} />
            {/* Extraction (#11) fills salary from the Posting's text where it
                states one; an unknown reads as "not listed", never a number (#36). */}
            <Fact label="Salary" value={formatSalary(posting)} mono />
          </dl>

          <a
            href={posting.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 self-start rounded-control border border-accent-edge bg-accent-wash px-3.5 py-[7px] text-[12.5px] font-medium text-accent-text"
          >
            Apply on the employer’s site
          </a>
        </header>

        <ReviewControls postingId={posting.id} review={posting.review} />

        <article
          className="description text-[13.5px] leading-[1.75]"
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
    <div className="flex items-baseline gap-2">
      <dt>
        <MonoLabel>{label}</MonoLabel>
      </dt>
      <dd
        className={
          mono
            ? "font-mono text-[13px] font-medium text-text"
            : "text-[12.5px] text-label"
        }
      >
        {value}
      </dd>
    </div>
  );
}
