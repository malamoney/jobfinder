import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readCriteria, readDashboard, type DashboardPosting } from "@/operations";
import { logOutAction } from "../actions";

export const metadata: Metadata = { title: "Dashboard · Jobfinder" };

/**
 * The Dashboard: every Posting matching the signed-in User's Criteria, on one
 * page.
 *
 * The User is checked on the server before anything renders, the same way the
 * Criteria page does it. Matching has already run — `saveCriteria` re-matches
 * on every save and the nightly Fetch re-matches after it collects — so this
 * only reads what is there.
 */
export default async function DashboardPage() {
  const signedIn = await currentUser(await headers());
  if (!signedIn) redirect("/login");

  const stated = await readCriteria(signedIn.id);
  const { postings, unreviewedCount } = stated
    ? await readDashboard(signedIn.id)
    : { postings: [], unreviewedCount: 0 };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <form action={logOutAction}>
            <button type="submit" className="text-sm text-gray-500 underline">
              Log out
            </button>
          </form>
        </div>
        <p className="text-sm text-gray-600">Signed in as {signedIn.email}.</p>
      </header>

      {!stated ? (
        <Empty
          message="Tell Jobfinder what you are looking for, and the matches appear here."
          cta="State your criteria"
        />
      ) : postings.length === 0 ? (
        <Empty
          message="Nothing in the corpus matches your criteria yet. New postings are collected every night."
          cta="Edit your criteria"
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">
                {unreviewedCount}
              </span>{" "}
              {unreviewedCount === 1 ? "posting" : "postings"} not yet reviewed
            </p>
            <Link href="/criteria" className="text-sm underline">
              Edit your criteria
            </Link>
          </div>

          <ul className="flex flex-col gap-4">
            {postings.map((posting) => (
              <PostingCard key={posting.id} posting={posting} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

/** Shown when there is no statement of Criteria, or nothing matched it. */
function Empty({ message, cta }: { message: string; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-gray-300 p-6">
      <p className="text-sm text-gray-600">{message}</p>
      <Link
        href="/criteria"
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
      >
        {cta}
      </Link>
    </div>
  );
}

/** One matched Posting, triageable at a glance. */
function PostingCard({ posting }: { posting: DashboardPosting }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium text-gray-900">{posting.title}</h2>
          <span className="text-sm text-gray-600">{posting.company}</span>
        </div>
        {posting.expired && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            Expired
          </span>
        )}
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
        <Fact label="Location" value={posting.location ?? "Not given"} />
        {/* Salary Extraction is #11; until then no Posting carries one, and an
            unknown salary is shown as "not listed" rather than a number (#36). */}
        <Fact label="Salary" value="Not listed" />
        <Fact label="Posted" value={formatPostedAt(posting.postedAt)} />
      </dl>

      {posting.matchedKeywords.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {posting.matchedKeywords.map((keyword) => (
            <li
              key={keyword}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
            >
              {keyword}
            </li>
          ))}
        </ul>
      )}
    </li>
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

/** A posted date the way a person reads it, or a plain note when there is none. */
function formatPostedAt(postedAt: Date | null): string {
  if (!postedAt) return "Date not given";
  return postedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
