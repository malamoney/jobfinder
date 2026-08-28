import type { Metadata } from "next";
import { signUpAction } from "../actions";
import { CredentialsForm } from "../credentials-form";

export const metadata: Metadata = { title: "Sign up · Jobfinder" };

export default function SignUpPage() {
  return (
    <CredentialsForm
      heading="Create an account"
      blurb="Tell Jobfinder what you are looking for, and it will watch for it."
      submitLabel="Create account"
      action={signUpAction}
      showPasswordRule
      footer={{
        prompt: "Already have an account?",
        href: "/login",
        linkLabel: "Log in",
      }}
    />
  );
}
