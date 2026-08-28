import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          You are logged in
        </h1>
        <p className="text-sm text-gray-600">
          Signed in as {signedIn.email}. Stating what you are looking for
          comes next, and the matches after that.
        </p>
      </div>

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
