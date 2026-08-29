import sanitizeHtml from "sanitize-html";

/**
 * A Posting's description, cleaned so it is safe to render.
 *
 * Descriptions are stored as HTML exactly as the Source published them (#5), and
 * that HTML is written by whoever posted the job — it is untrusted. Rendering it
 * verbatim would run their markup in the reader's browser, so this keeps only
 * the tags a job description legitimately uses (text structure, lists, links,
 * emphasis, simple tables) and drops everything else: scripts, styles, iframes,
 * embedded objects, event-handler attributes, and `javascript:` URLs.
 *
 * Every surviving link is forced to open in a new tab and carry
 * `rel="noopener noreferrer nofollow"` — it points somewhere we do not control.
 */
export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "blockquote",
      "code",
      "pre",
      "a",
      "span",
      "div",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      // `rel` and `target` are set by the transform below, not by the Source,
      // but must be allowed through for it to keep them.
      a: ["href", "title", "rel", "target"],
    },
    // A link scheme not on this list — `javascript:` above all — is dropped.
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  });
}
