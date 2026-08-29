import { describe, expect, it } from "vitest";
import { sanitizeDescription } from "./description";

/**
 * The description a Source hands back is HTML written by whoever posted the job.
 * These pin what survives rendering and what does not — a secondary seam,
 * because the input space is HTML and driving it through a Fetch would be
 * absurdly indirect.
 */
describe("sanitizing a Posting description", () => {
  it("keeps the tags a job description is written with", () => {
    const clean = sanitizeDescription(
      "<h2>About</h2><p>Build <strong>things</strong>.</p><ul><li>One</li></ul>",
    );

    expect(clean).toBe(
      "<h2>About</h2><p>Build <strong>things</strong>.</p><ul><li>One</li></ul>",
    );
  });

  it("strips a script tag and its contents", () => {
    const clean = sanitizeDescription(
      "<p>Real text.</p><script>fetch('/steal')</script>",
    );

    expect(clean).toBe("<p>Real text.</p>");
  });

  it("drops event-handler attributes", () => {
    const clean = sanitizeDescription('<p onclick="steal()">Click me</p>');

    expect(clean).toBe("<p>Click me</p>");
  });

  it("removes a javascript: link but keeps its text", () => {
    const clean = sanitizeDescription(
      '<a href="javascript:alert(1)">Apply now</a>',
    );

    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("Apply now");
  });

  it("keeps an http link and hardens it", () => {
    const clean = sanitizeDescription(
      '<a href="https://example.com/jobs/1">Full posting</a>',
    );

    expect(clean).toContain('href="https://example.com/jobs/1"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('target="_blank"');
  });

  it("strips an iframe", () => {
    const clean = sanitizeDescription(
      '<p>Watch:</p><iframe src="https://evil.example"></iframe>',
    );

    expect(clean).toBe("<p>Watch:</p>");
  });
});
