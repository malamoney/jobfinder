import Link from "next/link";

/**
 * What a visitor sees before they have an account.
 *
 * States what the application does before asking for anything, because the
 * three sentences below are the only thing a stranger has to judge whether an
 * account is worth making.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Jobfinder</h1>
        <p className="text-lg text-gray-700">
          Job hunting without the hunting. Say once what you are looking for,
          and Jobfinder checks hundreds of company job boards every night for
          anything that matches.
        </p>
        <p className="text-base text-gray-600">
          It reads the boards directly rather than scraping aggregators, so
          every match links straight to the company&rsquo;s own application
          page. Roles that get filled are marked as gone rather than deleted,
          so the ones you applied for stay in your records.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
