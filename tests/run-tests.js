#!/usr/bin/env node
/*
 * run-tests.js — command-line test runner.
 *
 *   node tests/run-tests.js
 *
 * Runs the shared suite from tests/test-cases.js, plus the checks that need
 * file access and therefore cannot run inside a double-clicked page: an
 * end-to-end pass over synthetic_example.csv, and a scan of the source for
 * anything that could reach the network.
 *
 * The same shared suite also runs in the browser: open tests.html.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

/* Load the application modules in the same order index.html does. */
require(path.join(projectRoot, "js", "privacy.js"));
require(path.join(projectRoot, "js", "csv.js"));
require(path.join(projectRoot, "js", "stats.js"));
require(path.join(projectRoot, "js", "validate.js"));
require(path.join(projectRoot, "js", "analysis.js"));

require(path.join(__dirname, "harness.js"));
require(path.join(__dirname, "test-cases.js"));

const PBA = globalThis.PBA;
const test = PBA.testing.test;

/* ------------------------------------------------------------------------ */
/* End-to-end pass over the synthetic example file.                          */
/* This is the only file the tests read, and it contains invented data.      */
/* ------------------------------------------------------------------------ */

const SYNTHETIC_PATH = path.join(projectRoot, "synthetic_example.csv");
const syntheticText = fs.readFileSync(SYNTHETIC_PATH, "utf8");

function loadSynthetic() {
  const parsed = PBA.csv.parseCSV(syntheticText);
  const mapping = PBA.validate.guessMapping(parsed.headers);
  const records = PBA.validate.flagRecords(
    PBA.validate.buildRecords(parsed.rows, mapping), mapping);
  const profiles = PBA.analysis.profileColumns(parsed.headers, records);
  return { parsed, mapping, records, profiles };
}

test("Synthetic file", "the columns are recognised automatically", (t) => {
  const { parsed, mapping } = loadSynthetic();
  t.equal(parsed.warnings.length, 0, "the file is structurally clean");
  t.equal(mapping.specimen_id, "specimen_id");
  t.equal(mapping.length, "total_length_mm");
  t.equal(mapping.body_mass, "body_mass_g");
  t.equal(mapping.somatic_mass, "somatic_mass_g");
  t.equal(mapping.gonad_mass, "gonad_mass_g");
  t.equal(mapping.liver_mass, "liver_mass_g");
});

test("Synthetic file", "every data row becomes exactly one record", (t) => {
  const { parsed, records } = loadSynthetic();
  t.equal(parsed.rows.length, 61, "61 data rows are present");
  t.equal(records.length, 61, "and 61 records come out");
});

test("Synthetic file", "the planted duplicate identifier is found", (t) => {
  const { records } = loadSynthetic();
  const duplicated = records.filter((r) =>
    r.flags.some((f) => f.code === "duplicate_id"));
  t.equal(duplicated.length, 2, "two rows share an identifier");
  t.equal(duplicated[0].values.specimen_id, "RG005");
  t.equal(duplicated[1].values.specimen_id, "RG005");

  const ids = new Set(records.map((r) => r.values.specimen_id.trim()));
  t.equal(ids.size, 60, "60 distinct identifiers across 61 rows");
});

test("Synthetic file", "the planted impossible organ mass is found", (t) => {
  const { records } = loadSynthetic();
  const flagged = records.filter((r) =>
    r.flags.some((f) => f.code === "organ_above_body_mass"));
  t.equal(flagged.length, 1, "one row has an organ heavier than the whole animal");
  t.equal(flagged[0].values.specimen_id, "RG010");
  t.ok(flagged[0].flags.some((f) => f.code === "organ_above_somatic_mass"),
    "the same row also exceeds the somatic mass");
});

test("Synthetic file", "no row is unusable and none is removed", (t) => {
  const { records } = loadSynthetic();
  t.equal(PBA.validate.countRowsWithSeverity(records, "error"), 0,
    "no missing, non-numeric or nonpositive required values");
  t.equal(PBA.validate.countRowsWithSeverity(records, "warning"), 3,
    "two duplicate rows and one impossible organ mass");
});

test("Synthetic file", "both indices are computable for every row", (t) => {
  const { records } = loadSynthetic();
  const coverage = PBA.validate.indexCoverage(records);
  t.equal(coverage.gsi, 61);
  t.equal(coverage.hsi, 61);
});

test("Synthetic file", "the default plan runs and uses every row", (t) => {
  const { mapping, records, profiles } = loadSynthetic();
  const plan = PBA.analysis.defaultPlan(mapping, profiles, records);
  const result = PBA.analysis.runAnalysis(records, plan);

  t.ok(result.ok, "the plan is valid");
  t.equal(result.rowsUsed, 61, "all rows enter the model");
  t.equal(result.rowsExcluded, 0);
  t.ok(result.model.ok, "a model was fitted");
  t.equal(result.model.n, 61);

  /* Cross-check against an independent computation from the raw text. */
  const rows = syntheticText.trim().split("\n").slice(1)
    .map((line) => line.split(","));
  const logLength = rows.map((cells) => Math.log(Number(cells[1])));
  const logMass = rows.map((cells) => Math.log(Number(cells[2])));
  const expected = PBA.stats.simpleOLS(logLength, logMass);

  t.close(result.model.coefficients[1], expected.slope, 1e-9,
    "the slope matches a separate calculation from the raw file");
  t.close(result.model.r2, expected.r2, 1e-9, "and so does R²");
  t.ok(result.model.r2 > 0 && result.model.r2 <= 1, "R² is a proportion");
});

test("Synthetic file", "grouping by the mapped categorical fields works", (t) => {
  const { records } = loadSynthetic();
  const grouped = PBA.analysis.summarizeGroups(records, {
    groupFields: ["site"], outcome: "body_mass_g", predictors: ["total_length_mm"]
  });
  t.deepEqual(grouped.summaries.map((s) => s.group), ["A", "B", "C"]);
  t.equal(grouped.summaries.reduce((sum, s) => sum + s.n, 0), 61,
    "every record lands in exactly one group");
});

test("Synthetic file", "the flag report lists one line per flag", (t) => {
  const { records } = loadSynthetic();
  const flagCount = records.reduce((sum, r) => sum + r.flags.length, 0);
  t.equal(flagCount, 4, "two duplicate flags plus two mass flags on RG010");
});

/* ------------------------------------------------------------------------ */
/* Source scan: the privacy rule, checked against the files themselves.      */
/* ------------------------------------------------------------------------ */

const SOURCE_FILES = [
  "index.html",
  "tests.html",
  "css/app.css",
  "js/privacy.js",
  "js/csv.js",
  "js/stats.js",
  "js/validate.js",
  "js/analysis.js",
  "js/ui.js",
  "tests/harness.js",
  "tests/test-cases.js",
  "tests/browser-runner.js"
].filter((relative) => fs.existsSync(path.join(projectRoot, relative)));

function readSource(relative) {
  return fs.readFileSync(path.join(projectRoot, relative), "utf8");
}

test("Privacy: source scan", "no source file references an external address", (t) => {
  SOURCE_FILES.forEach((relative) => {
    const matches = readSource(relative).match(/https?:\/\/[^\s"'<>)]*/g) || [];
    matches.forEach((url) => {
      t.ok(url.indexOf("example.invalid") >= 0,
        relative + " contains the external address " + url);
    });
  });
});

test("Privacy: source scan", "no external script, stylesheet, font or image is loaded", (t) => {
  SOURCE_FILES.forEach((relative) => {
    const source = readSource(relative);
    t.notOk(/<script[^>]+src\s*=\s*["'](?:https?:)?\/\//i.test(source),
      relative + " loads a remote script");
    t.notOk(/<link[^>]+href\s*=\s*["'](?:https?:)?\/\//i.test(source),
      relative + " loads a remote stylesheet");
    t.notOk(/@import\s+url\(\s*["']?(?:https?:)?\/\//i.test(source),
      relative + " imports a remote stylesheet");
    t.notOk(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)/i.test(source),
      relative + " references a remote asset");
  });
});

test("Privacy: source scan", "only privacy.js and the tests mention network APIs", (t) => {
  const pattern = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/;
  const allowed = ["js/privacy.js", "tests/test-cases.js", "tests/run-tests.js", "tests/browser-runner.js"];
  SOURCE_FILES.forEach((relative) => {
    if (allowed.indexOf(relative) >= 0) return;
    t.notOk(pattern.test(readSource(relative)),
      relative + " mentions a network API");
  });
});

test("Privacy: source scan", "the page declares a policy that forbids connections", (t) => {
  const html = readSource("index.html");
  const policy = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1];
  t.ok(policy, "a Content-Security-Policy meta tag is present");
  t.ok(policy.indexOf("connect-src 'none'") >= 0, "connect-src 'none' is declared");
  t.ok(policy.indexOf("default-src 'none'") >= 0, "default-src 'none' is declared");
  t.ok(policy.indexOf("form-action 'none'") >= 0, "no form may be submitted anywhere");
});

test("Privacy: source scan", "no storage API is used, so nothing outlives the tab", (t) => {
  SOURCE_FILES.forEach((relative) => {
    t.notOk(/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/
      .test(readSource(relative)), relative + " persists data outside the tab");
  });
});

test("Privacy: source scan", "the only file the app reads is the one the user picks", (t) => {
  const ui = readSource("js/ui.js");
  const reads = (ui.match(/\b(readAsText|\.text\(\)|FileReader)\b/g) || []).length;
  t.ok(reads > 0, "the file the user selects is read");
  t.notOk(/webkitdirectory|showDirectoryPicker|showOpenFilePicker|DataTransfer|drop\b/
    .test(ui), "no directory picker or drag-and-drop path exists");
  t.notOk(/\brequire\(|\bimport\s*\(/.test(ui), "no dynamic loading of other files");
});

test("Privacy: source scan", "the app loads only local scripts, in a fixed order", (t) => {
  const html = readSource("index.html");
  const sources = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g)).map((m) => m[1]);
  t.deepEqual(sources, [
    "js/privacy.js", "js/csv.js", "js/stats.js",
    "js/validate.js", "js/analysis.js", "js/ui.js"
  ], "privacy.js must be first so the kill switch is installed before anything else");
  t.notOk(/type="module"/.test(html),
    "ES modules would break the double-click launch from a file:// page");
});

/* ------------------------------------------------------------------------ */
/* Report                                                                    */
/* ------------------------------------------------------------------------ */

const summary = PBA.testing.run();

let currentGroup = "";
summary.results.forEach((result) => {
  if (result.group !== currentGroup) {
    currentGroup = result.group;
    process.stdout.write("\n" + currentGroup + "\n");
  }
  if (result.ok) {
    process.stdout.write("  PASS  " + result.name + "\n");
  } else {
    process.stdout.write("  FAIL  " + result.name + "\n");
    process.stdout.write("        " + result.error + "\n");
  }
});

process.stdout.write("\n" + "-".repeat(60) + "\n");
process.stdout.write(
  summary.passed + " passed, " + summary.failed + " failed, " +
  summary.total + " total\n");

process.exit(summary.failed ? 1 : 0);
