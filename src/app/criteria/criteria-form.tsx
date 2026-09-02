"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
// Not "@/operations": that reaches Postgres, and this runs in the browser.
// This is the schema with nothing behind it, which is what lets the same rules
// answer a typo here and reject a crafted POST on the server.
import {
  EMPLOYMENT_ARRANGEMENTS,
  LOCATION_ARRANGEMENTS,
  criteriaProblem,
  needsDistanceBounds,
  type Arrangement,
  type Criteria,
  type CriteriaInput,
  type CriteriaOutcome,
} from "@/criteria/schema";
import { formatCompactAge } from "../format";
import { MonoLabel } from "../mono-label";
import { saveCriteriaAction } from "./actions";

/** How each Arrangement reads on its checkbox. */
const ARRANGEMENT_LABELS: Record<Arrangement, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  remote: "Remote",
  onsite: "Onsite",
  hybrid: "Hybrid",
};

/**
 * The checkboxes, split by the two axes Matching reads a selection along
 * (`@/criteria/schema`). Leaving a group empty constrains nothing on that axis
 * — so the groups are shown, and labelled, rather than one flat list that hides
 * why an untouched value is not a filter.
 */
const ARRANGEMENT_GROUPS = [
  { legend: "Where you work", values: LOCATION_ARRANGEMENTS },
  { legend: "Employment type", values: EMPLOYMENT_ARRANGEMENTS },
] as const;

/** An empty statement, for a User stating Criteria for the first time. */
const BLANK: Criteria = {
  titles: [],
  keywords: [],
  arrangements: [],
  homeLocation: null,
  radiusMiles: null,
  minSalary: null,
};

type CriteriaFormProps = {
  /** What the User has stated before, or null if they never have. */
  initial: Criteria | null;
  /** When the statement was last saved, for the kicker; null if never. */
  lastSavedAt: Date | null;
};

/**
 * A number typed into a field, or null when the field was left blank.
 *
 * Digits only, with commas allowed as grouping so `150,000` is a number and
 * not a rejection. Anything else — `1e6`, `0x10`, `30.5` — becomes `NaN`, which
 * the schema turns into a "whole number" message rather than accepting silently.
 */
function typedNumber(value: string): number | null {
  const cleaned = value.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  return /^-?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}

/**
 * The one screen where a User says what work they are looking for.
 *
 * Titles and keywords are built up item by item rather than retyped, so the
 * list state lives here and the whole statement posts at once. The location
 * and radius fields are shown only when an onsite or hybrid Arrangement is
 * ticked — `needsDistanceBounds` is the same predicate the server validates
 * with.
 */
export function CriteriaForm({ initial, lastSavedAt }: CriteriaFormProps) {
  const stated = initial ?? BLANK;

  // The kicker's "LAST SAVED …" clause. Seeded from the server's timestamp and
  // moved to "just now" the moment a save succeeds, so it never lags the form.
  const [savedAt, setSavedAt] = useState<Date | null>(lastSavedAt);

  const [titles, setTitles] = useState<string[]>(stated.titles);
  const [titleDraft, setTitleDraft] = useState("");
  const [keywords, setKeywords] = useState<string[]>(stated.keywords);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [arrangements, setArrangements] = useState<Arrangement[]>(
    stated.arrangements,
  );
  const [homeLocation, setHomeLocation] = useState(stated.homeLocation ?? "");
  const [radiusMiles, setRadiusMiles] = useState(
    stated.radiusMiles?.toString() ?? "",
  );
  const [minSalary, setMinSalary] = useState(stated.minSalary?.toString() ?? "");

  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CriteriaOutcome | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const wantsDistance = needsDistanceBounds(arrangements);

  /** Fills every field from the stored, normalized values a save answered with. */
  function showStored(saved: Criteria) {
    setTitles(saved.titles);
    setKeywords(saved.keywords);
    setArrangements(saved.arrangements);
    setHomeLocation(saved.homeLocation ?? "");
    setRadiusMiles(saved.radiusMiles?.toString() ?? "");
    setMinSalary(saved.minSalary?.toString() ?? "");
    setRefused(null);
  }

  /**
   * Clears the last save's verdict the moment a field changes, so a stale
   * "Saved." cannot sit over edits that have not been stored.
   */
  function edited() {
    setOutcome(null);
    setRefused(null);
  }

  function currentInput(): CriteriaInput {
    return {
      titles,
      keywords,
      arrangements,
      homeLocation: wantsDistance ? homeLocation.trim() || null : null,
      radiusMiles: wantsDistance ? typedNumber(radiusMiles) : null,
      minSalary: typedNumber(minSalary),
    };
  }

  function addTitle() {
    const value = titleDraft.trim();
    if (!value) return;
    setTitles((current) =>
      current.includes(value) ? current : [...current, value],
    );
    setTitleDraft("");
    edited();
  }

  function removeTitle(value: string) {
    setTitles((current) => current.filter((entry) => entry !== value));
    edited();
  }

  function addKeyword() {
    const value = keywordDraft.trim();
    if (!value) return;
    setKeywords((current) =>
      current.includes(value) ? current : [...current, value],
    );
    setKeywordDraft("");
    edited();
  }

  function removeKeyword(value: string) {
    setKeywords((current) => current.filter((entry) => entry !== value));
    edited();
  }

  function toggleArrangement(value: Arrangement) {
    setArrangements((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    );
    edited();
  }

  /** Enter adds the drafted item rather than submitting the whole form. */
  function onDraftKeyDown(event: KeyboardEvent, add: () => void) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  }

  function save() {
    const input = currentInput();
    const problem = criteriaProblem(input);
    setRefused(problem);
    if (problem) return;

    startTransition(async () => {
      try {
        const result = await saveCriteriaAction(null, input);
        setOutcome(result);
        if (result.ok) {
          showStored(result.criteria);
          setSavedAt(new Date());
        }
      } catch {
        // A save operation throws only on an infrastructure failure — the
        // schema's verdicts come back as an outcome, not an exception. Keep it
        // in the same message slot rather than letting it reach an error
        // boundary and take the half-filled form down with it.
        setOutcome({
          ok: false,
          message: "Something went wrong saving that. Try again in a moment.",
        });
      }
    });
  }

  const serverProblem = outcome && !outcome.ok ? outcome.message : null;
  const problem = refused ?? serverProblem;
  const saved = outcome?.ok === true && !refused;
  const savedAge = formatCompactAge(savedAt);

  return (
    // The page shell matches every other page behind the login (`max-w-6xl`,
    // ADR 0012). The form itself stays a single narrow column — a text field
    // 72rem wide helps no one — held to a reading measure and aligned with the
    // nav's left edge, the way the Posting page holds its description.
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 pb-16 pt-20">
      <div className="flex w-full max-w-2xl flex-col gap-2">
        {/* Canvas 4c: a mono kicker over the heading. The "LAST SAVED" clause
            is dropped entirely for a User stating Criteria for the first time
            (`formatCompactAge` returns null), so it never reads "LAST SAVED
            NEVER". */}
        <MonoLabel as="p">
          Criteria{savedAge && ` · Last saved ${savedAge}`}
        </MonoLabel>
        <h1 className="text-[27px] font-medium leading-tight tracking-tight">
          What are you looking for?
        </h1>
        <p className="text-[13.5px] text-label">
          State it once. You can come back and change any of it whenever your
          search does.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        onChange={edited}
        className="flex w-full max-w-2xl flex-col gap-7"
        noValidate
      >
        <ChipField
          legend="Job titles"
          hint="The roles you want. Add them one at a time."
          items={titles}
          draft={titleDraft}
          setDraft={setTitleDraft}
          onAdd={addTitle}
          onRemove={removeTitle}
          onDraftKeyDown={(event) => onDraftKeyDown(event, addTitle)}
          placeholder="Staff Engineer"
        />

        <ChipField
          legend="Description keywords"
          hint="Words to look for in a posting's text — a technology, a domain. Optional."
          items={keywords}
          draft={keywordDraft}
          setDraft={setKeywordDraft}
          onAdd={addKeyword}
          onRemove={removeKeyword}
          onDraftKeyDown={(event) => onDraftKeyDown(event, addKeyword)}
          placeholder="postgres"
        />

        {/* Canvas 4c: the arrangement groups sit in a `--surface` card. The two
            groups are kept — leaving one untouched constrains nothing on that
            axis, and the mockup's single flat row would hide that — but styled
            as chips. */}
        <div className="flex flex-col gap-3.5 rounded-card border border-border bg-surface p-4">
          <div className="flex flex-col gap-1.5">
            <MonoLabel as="p">Arrangements you accept</MonoLabel>
            <p className="text-[12.5px] text-label">
              Roles structured in a way you cannot take are never shown. A group
              you leave untouched is not used to filter — so leave one blank if
              you have no preference there.
            </p>
          </div>
          {ARRANGEMENT_GROUPS.map(({ legend, values }) => (
            <fieldset key={legend} className="flex flex-col gap-2">
              <legend className="text-[12.5px] text-label">{legend}</legend>
              <div className="flex flex-wrap gap-2">
                {values.map((arrangement) => (
                  <label
                    key={arrangement}
                    className="group flex items-center gap-2 rounded-control border border-border px-3 py-1.5 text-[12.5px] text-label has-[:checked]:border-accent-edge has-[:checked]:bg-accent-wash has-[:checked]:text-accent-text has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-wash"
                  >
                    <input
                      type="checkbox"
                      checked={arrangements.includes(arrangement)}
                      onChange={() => toggleArrangement(arrangement)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="flex size-[13px] items-center justify-center rounded-[3px] border border-border text-[9px] leading-none text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-bg"
                    >
                      ✓
                    </span>
                    {ARRANGEMENT_LABELS[arrangement]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {wantsDistance && (
          // Canvas 4c: a 2px `--accent` left border and a wash fading out to the
          // right mark the fieldset the onsite/hybrid tick brought in.
          <fieldset className="flex flex-col gap-3 border-l-2 border-accent bg-[linear-gradient(90deg,var(--accent-wash),transparent_60%)] p-4">
            <div className="flex flex-col gap-1">
              <MonoLabel as="legend" tone="accent">
                Commute
              </MonoLabel>
              <p className="text-[12.5px] text-label">
                Onsite and hybrid roles are limited to somewhere you could get
                to. Remote roles ignore this.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] text-label">Home location</span>
                <input
                  value={homeLocation}
                  onChange={(event) => setHomeLocation(event.target.value)}
                  autoComplete="address-level2"
                  placeholder="Boston, MA"
                  className="rounded-control border border-border bg-field px-3 py-2 text-[13.5px]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] text-label">Radius (mi)</span>
                <input
                  value={radiusMiles}
                  onChange={(event) => setRadiusMiles(event.target.value)}
                  inputMode="numeric"
                  placeholder="30"
                  className="rounded-control border border-border bg-field px-3 py-2 font-mono text-[13.5px]"
                />
              </label>
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5">
          <MonoLabel>Minimum salary</MonoLabel>
          <span className="text-[12.5px] text-label">
            Leave blank to see every role. A posting that states no salary is
            always shown.
          </span>
          <input
            value={minSalary}
            onChange={(event) => setMinSalary(event.target.value)}
            inputMode="numeric"
            placeholder="150000"
            className="mt-1 max-w-[220px] rounded-control border border-border bg-field px-3 py-2 font-mono text-[13.5px]"
          />
        </label>

        <p role="alert" aria-live="polite" className="text-[12.5px] text-danger">
          {problem}
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-control border border-accent-edge bg-accent-wash px-3.5 py-[7px] text-[12.5px] font-medium text-accent-text disabled:border-border disabled:bg-transparent disabled:text-label"
          >
            {pending ? "Saving…" : "Save criteria"}
          </button>
          {saved && (
            <span aria-live="polite" className="micro-label text-ok">
              Saved
            </span>
          )}
        </div>
      </form>
    </main>
  );
}

type ChipFieldProps = {
  legend: string;
  hint: string;
  items: string[];
  draft: string;
  setDraft: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
  onDraftKeyDown: (event: KeyboardEvent) => void;
  placeholder: string;
};

/** A text input that turns what is typed into a removable list of chips. */
function ChipField({
  legend,
  hint,
  items,
  draft,
  setDraft,
  onAdd,
  onRemove,
  onDraftKeyDown,
  placeholder,
}: ChipFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <MonoLabel as="legend">{legend}</MonoLabel>
      <p className="text-[12.5px] text-label">{hint}</p>

      <div className="mt-1 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded-control border border-border bg-field px-3 py-2 text-[13.5px]"
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-control border border-border px-3.5 py-2 text-[12.5px] font-medium text-label hover:text-text"
        >
          Add
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1.5 rounded-full bg-tag py-1 pl-3 pr-1.5 text-[12.5px] text-text-body"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item}`}
                className="flex size-4 items-center justify-center rounded-full text-disabled hover:bg-border hover:text-text"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
