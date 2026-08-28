"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
// Not "@/operations": that reaches Postgres, and this runs in the browser.
// This is the schema with nothing behind it, which is what lets the same rules
// answer a typo here and reject a crafted POST on the server.
import {
  ARRANGEMENTS,
  criteriaProblem,
  needsDistanceBounds,
  type Arrangement,
  type Criteria,
  type CriteriaInput,
  type CriteriaOutcome,
} from "@/criteria/schema";
import { saveCriteriaAction } from "./actions";

/** How each Arrangement reads on its checkbox. */
const ARRANGEMENT_LABELS: Record<Arrangement, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  remote: "Remote",
  onsite: "Onsite",
  hybrid: "Hybrid",
};

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
export function CriteriaForm({ initial }: CriteriaFormProps) {
  const stated = initial ?? BLANK;

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
        if (result.ok) showStored(result.criteria);
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

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          What are you looking for?
        </h1>
        <p className="text-sm text-gray-600">
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
        className="flex flex-col gap-8"
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

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Arrangements you accept</legend>
          <p className="text-xs text-gray-500">
            Roles structured in a way you cannot take are never shown.
          </p>
          <div className="mt-1 flex flex-wrap gap-3">
            {ARRANGEMENTS.map((arrangement) => (
              <label
                key={arrangement}
                className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={arrangements.includes(arrangement)}
                  onChange={() => toggleArrangement(arrangement)}
                />
                {ARRANGEMENT_LABELS[arrangement]}
              </label>
            ))}
          </div>
        </fieldset>

        {wantsDistance && (
          <fieldset className="flex flex-col gap-4">
            <legend className="text-sm font-medium">Commute</legend>
            <p className="-mt-1 text-xs text-gray-500">
              Onsite and hybrid roles are limited to somewhere you could get
              to. Remote roles ignore this.
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Home location</span>
              <input
                value={homeLocation}
                onChange={(event) => setHomeLocation(event.target.value)}
                autoComplete="address-level2"
                placeholder="Boston, MA"
                className="rounded-md border border-gray-300 px-3 py-2 text-base"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Radius (miles)</span>
              <input
                value={radiusMiles}
                onChange={(event) => setRadiusMiles(event.target.value)}
                inputMode="numeric"
                placeholder="30"
                className="rounded-md border border-gray-300 px-3 py-2 text-base"
              />
            </label>
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Minimum salary</span>
          <span className="text-xs text-gray-500">
            Leave blank to see every role. A posting that states no salary is
            always shown.
          </span>
          <input
            value={minSalary}
            onChange={(event) => setMinSalary(event.target.value)}
            inputMode="numeric"
            placeholder="150000"
            className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-base"
          />
        </label>

        <p role="alert" aria-live="polite" className="text-sm text-red-700">
          {problem}
        </p>
        {saved && (
          <p aria-live="polite" className="text-sm text-green-700">
            Saved.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save criteria"}
        </button>
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
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-gray-500">{hint}</p>

      <div className="mt-1 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-base"
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
        >
          Add
        </button>
      </div>

      {items.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-3 pr-1.5 text-sm"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item}`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900"
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
