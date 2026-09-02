import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { readCriteria, readCriteriaSavedAt } from "@/operations";
import { AppNav } from "../app-nav";
import { CriteriaForm } from "./criteria-form";

export const metadata: Metadata = { title: "Your criteria · Jobfinder" };

/**
 * The screen where a User states, and later revises, what work they want.
 *
 * The User is checked on the server before anything renders, the same way the
 * Dashboard does it — a page behind a login does not show a shell and hope the
 * client notices. Their stated Criteria, if any, are loaded here so the form
 * comes up filled in.
 */
export default async function CriteriaPage() {
  const signedIn = await currentUser(await headers());
  if (!signedIn) redirect("/login");

  const [stated, lastSavedAt] = await Promise.all([
    readCriteria(signedIn.id),
    readCriteriaSavedAt(signedIn.id),
  ]);

  return (
    <>
      <AppNav active="criteria" />
      <CriteriaForm initial={stated} lastSavedAt={lastSavedAt} />
    </>
  );
}
