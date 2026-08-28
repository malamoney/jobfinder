import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readCriteria } from "@/operations";
import { logOutAction } from "../actions";

export const metadata: Metadata = { title: "Dashboard · Jobfinder" };

/**
 * The first page behind a login, and the seam the real Dashboard (#9) fills in.
 *
 * The redirect is what #4 has to demonstrate: a page that needs a User checks
 * for one on the server, before anything renders, rather than showing a shell
 * and hoping the client notices.
 */
export default async function DashboardPage() {
  const signedIn = await currentUser(await headers());
  if (!signedIn) redirect("/login");

  const stated = await readCriteria(signedIn.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          You are logged in
        </h1>
        <p className="text-sm text-gray-600">
          Signed in as {signedIn.email}.{" "}
          {stated
            ? "Your criteria are set; the matches come next."
            : "Tell Jobfinder what you are looking for, and the matches come next."}
        </p>
      </div>

      <Link
        href="/criteria"
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
      >
        {stated ? "Edit your criteria" : "State your criteria"}
      </Link>

      <form action={logOutAction}>
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
