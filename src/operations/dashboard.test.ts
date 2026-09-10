import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { dashboardMatchQuery } from "./dashboard";

/**
 * The cost regression for #138: the Dashboard read must not carry the
 * description text. It is 95% of a Posting row, the card renders none of it, and
 * the only consumer — `chooseRepresentative` — needs a length, not the text.
 *
 * Asserted against the generated SQL rather than the rendered cards: a card
 * test would pass just as well with the column selected and then ignored. The
 * property is the point, so the property is what is pinned.
 */
describe("the Dashboard Posting read", () => {
  const { sql: text } = dashboardMatchQuery(
    getDb(),
    "00000000-0000-0000-0000-000000000000",
  ).toSQL();

  it("does not select the description column as text", () => {
    // The only place the column name may appear is as the argument to
    // `length(...)`. With those calls removed, the text of the query must not
    // name `description` at all — anywhere else is the whole column coming back
    // over the wire.
    const withoutLengthCalls = text.replace(/length\([^)]*\)/gi, "");
    expect(withoutLengthCalls).not.toMatch(/description/i);
  });

  it("asks the database for the description's length instead", () => {
    expect(text.toLowerCase()).toContain('length("postings"."description")');
  });

  it("still selects every column the card, its order, and its flags need", () => {
    for (const column of [
      "id",
      "company",
      "title",
      "posted_at",
      "apply_url",
      "location",
      "arrangements",
      "salary_min",
      "salary_max",
      "salary_period",
      "dedup_key",
      "first_seen_at",
      "source",
      "source_id",
      "absent_fetches",
      "expires_at",
    ]) {
      expect(text).toContain(`"${column}"`);
    }
  });
});
