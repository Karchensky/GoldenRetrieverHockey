import { test } from "node:test";
import assert from "node:assert/strict";
import {
  namesMatch,
  givenNamesMatch,
  surnamesMatch,
  canonicalGiven,
  splitName,
  editDistance,
} from "../src/names.ts";

// ---------------------------------------------------------------------------
// THE SIBLING VETO. These are the most important tests in the project.
// Merging brothers erases real people from their own team's history, and no
// later pass can undo it. Every one of these names is real and owner-confirmed.
// ---------------------------------------------------------------------------

test("VETO: the three Kaplewicz brothers are never merged", () => {
  const brothers = ["Adam Kaplewicz", "Jason Kaplewicz", "Brendan Kaplewicz"];
  for (const a of brothers) {
    for (const b of brothers) {
      if (a === b) continue;
      const v = namesMatch(a, b);
      assert.equal(v.match, false, `${a} and ${b} are different people`);
      assert.match(v.reason, /given-name conflict/);
    }
  }
});

test("VETO holds against the NICKNAME form too: Jay vs Adam vs Brendan", () => {
  assert.equal(namesMatch("Jay Kaplewicz", "Adam Kaplewicz").match, false);
  assert.equal(namesMatch("Jay Kaplewicz", "Brenden Kaplewicz").match, false);
});

test("VETO: the Suffoletto brothers are never merged", () => {
  assert.equal(namesMatch("Greg Suffoletto", "Alex Suffoletto").match, false);
  assert.equal(namesMatch("Gregory Suffoletto", "Alex Suffoletto").match, false);
});

test("VETO survives a surname MISSPELLING — the dangerous combination", () => {
  // A fuzzy surname matcher plus a shared roster is exactly how brothers get
  // merged. The given-name veto must fire even when the surname is fuzzy.
  assert.equal(namesMatch("Adam Kaplewitz", "Brendan Kaplewicz").match, false);
});

// ---------------------------------------------------------------------------
// THE CONFIRMED MERGES. One man must not stay split across four spellings.
// ---------------------------------------------------------------------------

test("MERGE: every recorded form of Vinny Terrana is one man", () => {
  // Four spellings across four sources, all wearing #89 for fourteen years.
  const forms = ["Vinny Terrana", "Vinny Terrara", "Vinny Terana", "Vincent Terrana"];
  for (const a of forms) {
    for (const b of forms) {
      assert.equal(namesMatch(a, b).match, true, `${a} == ${b}`);
    }
  }
});

test("MERGE: Corey / Coroy / Cory Muff is one goalie", () => {
  assert.equal(namesMatch("Corey Muff", "Coroy Muff").match, true);
  assert.equal(namesMatch("Corey Muff", "Cory Muff").match, true);
});

test("MERGE: nickname pairs observed in this archive", () => {
  const pairs: [string, string][] = [
    ["Jay Kaplewicz", "Jason Kaplewicz"],
    ["Rich Fedele", "Richard Fedele"],
    ["Dan Schmitt", "Daniel Schmitt"],
    ["Greg Suffoletto", "Gregory Suffoletto"],
    ["Mike Hymes", "Michael Hymes"],
    ["Andy Murphy", "Andrew Murphy"],
  ];
  for (const [a, b] of pairs) {
    const v = namesMatch(a, b);
    assert.equal(v.match, true, `${a} == ${b}`);
    assert.match(v.reason, /nickname/);
  }
});

test("MERGE: surname misspellings observed in this archive", () => {
  assert.equal(namesMatch("Jake Steinmetz", "Jake Stienmetz").match, true);
  assert.equal(namesMatch("John Rein", "Jonh Rein").match, true);
  assert.equal(namesMatch("Robert Kaczynski", "Robert Kacznski").match, true);
  assert.equal(namesMatch("Jeremy McDonald", "Jeremy MacDonald").match, true);
});

test("MERGE: given-name spelling variance (Brenden/Brendan)", () => {
  assert.equal(namesMatch("Brenden Kaplewicz", "Brendan Kaplewicz").match, true);
});

// ---------------------------------------------------------------------------
// Boundaries.
// ---------------------------------------------------------------------------

test("different surnames never match", () => {
  assert.equal(namesMatch("Adam Kaplewicz", "Adam Boeing").match, false);
  assert.equal(namesMatch("Bryan Karchensky", "Bryan Koeppel").match, false);
});

test("a one-letter difference in a SHORT given name is not a match", () => {
  // "Jay" vs "Ray" is one edit but a different person; short names get no
  // spelling tolerance at all.
  assert.equal(givenNamesMatch("jay", "ray"), false);
  assert.equal(givenNamesMatch("dan", "ian"), false);
});

test("an absent given name proves nothing", () => {
  assert.equal(givenNamesMatch("", "adam"), false);
  assert.equal(namesMatch("Kaplewicz", "Adam Kaplewicz").match, false);
});

test("canonicalGiven resolves nicknames and passes through the rest", () => {
  assert.equal(canonicalGiven("Vinny"), "vincent");
  assert.equal(canonicalGiven("JAY"), "jason");
  assert.equal(canonicalGiven("Adam"), "adam");
});

test("splitName handles multi-word surnames", () => {
  assert.deepEqual(splitName("Jeremy Mac Donald"), { given: "jeremy", surname: "mac donald" });
  assert.deepEqual(splitName("O'Brien"), { given: "", surname: "obrien" });
});

test("surnamesMatch is tolerant but not reckless", () => {
  assert.equal(surnamesMatch("terrana", "terana"), true);
  assert.equal(surnamesMatch("muff", "muff"), true);
  assert.equal(surnamesMatch("muff", "murphy"), false);
  // Short surnames get almost no tolerance: 4 chars, 1 edit max.
  assert.equal(surnamesMatch("rein", "ryan"), false);
});

test("editDistance counts a TRANSPOSITION as one edit, not two", () => {
  // A transposition is one slip of the fingers. Plain Levenshtein scores it 2
  // and so refuses to merge "Jonh Rein" with "John Rein" -- leaving one man
  // split across spellings. This archive is full of transpositions.
  assert.equal(editDistance("john", "jonh"), 1);
  assert.equal(editDistance("steinmetz", "stienmetz"), 1);
  assert.equal(editDistance("corey", "coroy"), 1);
});

test("editDistance basics", () => {
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("terrana", "terana"), 1);
});

test("the sibling veto has a wide margin over the typo threshold", () => {
  // The given-name tolerance is 1 edit. If any sibling pair sat near that, the
  // veto would be one bad transcription away from erasing a brother. Measured:
  // the closest real pair (greg/alex) is 3 edits — 3x the tolerance.
  const siblings: [string, string][] = [
    ["adam", "jason"],
    ["adam", "brendan"],
    ["jason", "brendan"],
    ["greg", "alex"],
  ];
  for (const [a, b] of siblings) {
    assert.equal(givenNamesMatch(a, b), false, `${a}/${b} must never match`);
    assert.ok(editDistance(a, b) >= 3, `${a}/${b} margin is ${editDistance(a, b)}, want >=3`);
  }
});

test("every match carries a stated reason — never merge silently", () => {
  const v = namesMatch("Vinny Terrara", "Vincent Terrana");
  assert.equal(v.match, true);
  assert.ok(v.reason.length > 0);
  assert.match(v.reason, /nickname|spelling/);
});
