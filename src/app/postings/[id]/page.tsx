import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readPosting } from "@/operations";
import { sanitizeDescription } from "@/postings/description";
import { AppNav } from "../../app-nav";
import { formatDay, formatSalary } from "../../format";
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
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 pb-16 pt-24">
        <Link href="/dashboard" className="self-start text-sm underline">
          ← Back to dashboard
        </Link>

        <header className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {posting.title}
              </h1>
              <p className="text-sm text-gray-600">{posting.company}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {posting.expired && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                  Expired
                </span>
              )}
              {posting.unresolvedLocation && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  Location unresolved
                </span>
              )}
            </div>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <Fact label="Location" value={posting.location ?? "Not given"} />
            {/* Extraction (#11) fills salary from the Posting's text where it
                states one; an unknown reads as "not listed", never a number (#36). */}
            <Fact label="Salary" value={formatSalary(posting)} />
            <Fact
              label="Posted"
              value={formatDay(posting.postedAt, "Date not given")}
            />
          </dl>

          <a
            href={posting.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            Apply on the employer’s site
          </a>
        </header>

        <ReviewControls postingId={posting.id} review={posting.review} />

        <article
          className="description text-sm leading-relaxed text-gray-800"
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-gray-400">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
