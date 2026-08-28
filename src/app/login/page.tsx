import type { Metadata } from "next";
import { logInAction } from "../actions";
import { CredentialsForm } from "../credentials-form";

export const metadata: Metadata = { title: "Log in · Jobfinder" };

export default function LogInPage() {
  return (
    <CredentialsForm
      heading="Log in"
      blurb="Pick up where you left off."
      submitLabel="Log in"
      action={logInAction}
      footer={{
        prompt: "No account yet?",
        href: "/signup",
        linkLabel: "Sign up",
      }}
    />
  );
}
