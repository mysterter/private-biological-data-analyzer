/*
 * test-cases.js — the shared test suite.
 *
 * Every fixture in this file is invented for the test. No laboratory data is
 * embedded here, and nothing in this file reads from disk, so the same cases
 * run in Node and inside a double-clicked tests.html.
 */
(function (root) {
  "use strict";

  var PBA = root.PBA;
  var test = PBA.testing.test;
  var csv = PBA.csv;
  var stats = PBA.stats;
  var validate = PBA.validate;
  var analysis = PBA.analysis;

  var HEADER = "specimen_id,total_length_mm,body_mass_g,somatic_mass_g," +
               "gonad_mass_g,liver_mass_g,sex,site,invasion_stage";

  /** Parse, map and flag a small CSV fixture the way the app does. */
  function load(text, mappingOverrides) {
    var parsed = csv.parseCSV(text);
    var mapping = validate.guessMapping(parsed.headers);
    Object.keys(mappingOverrides || {}).forEach(function (key) {
      mapping[key] = mappingOverrides[key];
    });
    var records = validate.flagRecords(validate.buildRecords(parsed.rows, mapping), mapping);
    return { parsed: parsed, mapping: mapping, records: records };
  }

  function flagCodes(record) {
    return record.flags.map(function (f) { return f.code + ":" + f.field; });
  }

  function hasFlag(record, code, field) {
    return record.flags.some(function (f) {
      return f.code === code && (field === undefined || f.field === field);
    });
  }

  function warningCodes(parsed) {
    return parsed.warnings.map(function (w) { return w.code; });
  }

  /* ==================================================== quoted CSV fields */

  test("CSV: quoted fields", "a quoted field may contain a comma", function (t) {
    var parsed = csv.parseCSV('id,label\n"A1","Site B, north"\n');
    t.equal(parsed.rows.length, 1, "one data row");
    t.equal(parsed.rows[0].data.label, "Site B, north", "comma kept inside the value");
    t.equal(parsed.rows[0].data.id, "A1", "quoted id unwrapped");
  });

  test("CSV: quoted fields", "a doubled quote becomes one literal quote", function (t) {
    var parsed = csv.parseCSV('id,label\n"A1","He said ""yes"" twice"\n');
    t.equal(parsed.rows[0].data.label, 'He said "yes" twice');
  });

  test("CSV: quoted fields", "a quoted field may contain a newline", function (t) {
    var parsed = csv.parseCSV('id,label\n"A1","line one\nline two"\nA2,plain\n');
    t.equal(parsed.rows.length, 2, "the embedded newline does not split the record");
    t.equal(parsed.rows[0].data.label, "line one\nline two");
    t.equal(parsed.rows[1].sourceRow, 4, "the next record reports its true file line");
  });

  test("CSV: quoted fields", "a quoted empty field stays empty", function (t) {
    var parsed = csv.parseCSV('id,label\n"A1",""\n');
    t.equal(parsed.rows[0].data.label, "");
  });

  test("CSV: quoted fields", "CRLF line endings are handled", function (t) {
    var parsed = csv.parseCSV('id,label\r\nA1,x\r\n"A2","y,z"\r\n');
    t.equal(parsed.rows.length, 2);
    t.equal(parsed.rows[0].data.label, "x", "no stray carriage return");
    t.equal(parsed.rows[1].data.label, "y,z");
  });

  test("CSV: quoted fields", "a byte-order mark is stripped from the first header", function (t) {
    var parsed = csv.parseCSV("﻿id,label\nA1,x\n");
    t.equal(parsed.headers[0], "id");
  });

  test("CSV: quoted fields", "quoting is preserved through a write/read round trip", function (t) {
    var text = csv.toCSV([["id", "label"], ["A1", 'a,b "c"\nd']]);
    var parsed = csv.parseCSV(text + "\n");
    t.equal(parsed.rows[0].data.label, 'a,b "c"\nd');
  });

  /* ============================================= other structural problems */

  test("CSV: structure", "duplicate headers are renamed, not dropped", function (t) {
    var parsed = csv.parseCSV("id,mass,mass\nA1,1,2\n");
    t.deepEqual(parsed.headers, ["id", "mass", "mass__2"]);
    t.equal(parsed.rows[0].data.mass, "1");
    t.equal(parsed.rows[0].data.mass__2, "2", "the second column is kept");
    t.ok(warningCodes(parsed).indexOf("duplicate_header") >= 0, "a warning is reported");
  });

  test("CSV: structure", "a blank header name is replaced and reported", function (t) {
    var parsed = csv.parseCSV("id,,x\nA1,1,2\n");
    t.equal(parsed.headers[1], "column_2");
    t.ok(warningCodes(parsed).indexOf("blank_header") >= 0);
  });

  test("CSV: structure", "short and long rows are flagged rather than hidden", function (t) {
    var short = csv.parseCSV("id,a,b\nA1,1\n");
    t.equal(short.rows[0].data.b, "", "missing trailing value reads as empty");
    t.ok(warningCodes(short).indexOf("short_row") >= 0);

    var long = csv.parseCSV("id,a\nA1,1,2\n");
    t.ok(warningCodes(long).indexOf("long_row") >= 0);
  });

  test("CSV: structure", "completely blank lines are skipped and counted", function (t) {
    var parsed = csv.parseCSV("id,a\nA1,1\n\n\nA2,2\n");
    t.equal(parsed.rows.length, 2);
    t.equal(parsed.blankRowsSkipped, 2);
  });

  test("CSV: structure", "an unterminated quote is reported and the text kept", function (t) {
    var parsed = csv.parseCSV('id,a\nA1,"unclosed\n');
    t.equal(parsed.rows.length, 1);
    t.ok(warningCodes(parsed).indexOf("unterminated_quote") >= 0);
    t.ok(parsed.rows[0].data.a.indexOf("unclosed") === 0, "the value survives");
  });

  test("CSV: structure", "an empty file is rejected clearly", function (t) {
    t.throws(function () { csv.parseCSV(""); }, "empty text should throw");
  });

  /* ================================================ missing required values */

  test("Validation: missing values", "a missing specimen ID is flagged", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      ",101,11,9,0.5,0.3,F,A,front\n");
    t.equal(loaded.records.length, 2, "no row was removed");
    t.notOk(hasFlag(loaded.records[0], "missing_required"), "complete row is clean");
    t.ok(hasFlag(loaded.records[1], "missing_required", "specimen_id"));
    t.equal(loaded.records[1].flags[0].severity, "error");
  });

  test("Validation: missing values", "a missing length or body mass is flagged", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,,10,9,0.5,0.3,F,A,front\n" +
      "RG2,101,,9,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "missing_required", "length"));
    t.ok(hasFlag(loaded.records[1], "missing_required", "body_mass"));
    t.equal(loaded.records.length, 2, "flagged rows are kept");
  });

  test("Validation: missing values", "a blank optional value raises no flag", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,10,,,,F,A,front\n");
    t.equal(loaded.records[0].flags.length, 0, "optional blanks are not errors");
  });

  test("Validation: missing values", "a non-numeric measurement is flagged", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,not_a_number,10,9,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "nonnumeric", "length"));
    t.isNaN(loaded.records[0].numbers.length, "the value does not silently become 0");
  });

  /* ========================================================= duplicate IDs */

  test("Validation: duplicate IDs", "repeated IDs flag every affected row", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,101,11,9,0.5,0.3,F,A,front\n" +
      "RG1,102,12,9,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "duplicate_id"), "first occurrence flagged");
    t.notOk(hasFlag(loaded.records[1], "duplicate_id"), "unique ID not flagged");
    t.ok(hasFlag(loaded.records[2], "duplicate_id"), "second occurrence flagged");
    t.equal(loaded.records.length, 3, "duplicates are kept, not de-duplicated");

    var summary = validate.summarizeFlags(loaded.records).filter(function (s) {
      return s.code === "duplicate_id";
    })[0];
    t.equal(summary.rows, 2, "two rows are affected");
    t.equal(summary.severity, "warning", "a duplicate is questionable, not unusable");
  });

  test("Validation: duplicate IDs", "identifiers that collide with object internals are safe", function (t) {
    var loaded = load(HEADER + "\n" +
      "__proto__,100,10,9,0.5,0.3,F,A,front\n" +
      "__proto__,101,11,9,0.5,0.3,F,A,front\n" +
      "constructor,102,12,9,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "duplicate_id"));
    t.ok(hasFlag(loaded.records[1], "duplicate_id"));
    t.notOk(hasFlag(loaded.records[2], "duplicate_id"));
  });

  test("Validation: duplicate IDs", "blank IDs are not treated as duplicates of each other", function (t) {
    var loaded = load(HEADER + "\n" +
      ",100,10,9,0.5,0.3,F,A,front\n" +
      ",101,11,9,0.5,0.3,F,A,front\n");
    t.notOk(hasFlag(loaded.records[0], "duplicate_id"), "missing IDs are reported as missing");
    t.ok(hasFlag(loaded.records[0], "missing_required", "specimen_id"));
  });

  /* ================================================ nonpositive measurements */

  test("Validation: nonpositive values", "zero and negative required measurements are errors", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,0,10,9,0.5,0.3,F,A,front\n" +
      "RG2,100,-2,9,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "nonpositive", "length"));
    t.ok(hasFlag(loaded.records[1], "nonpositive", "body_mass"));
    t.equal(loaded.records[0].flags[0].severity, "error");
  });

  test("Validation: nonpositive values", "a nonpositive optional measurement is a warning", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,10,9,0,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "nonpositive", "gonad_mass"));
    t.equal(loaded.records[0].flags[0].severity, "warning",
      "a zero gonad mass is questionable but not unusable");
  });

  test("Validation: nonpositive values", "the original value is preserved, not deleted", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,-5,10,9,0.5,0.3,F,A,front\n");
    t.equal(loaded.records[0].numbers.length, -5, "the number is still readable");
    t.equal(loaded.records[0].values.length, "-5", "the raw text is still readable");
    t.equal(loaded.records.length, 1);
  });

  /* ============================================= organ mass above body mass */

  test("Validation: organ mass", "an organ heavier than the body is flagged", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,98.21,12.653,11.685,14.653,0.313,M,A,established\n");
    t.ok(hasFlag(loaded.records[0], "organ_above_body_mass", "gonad_mass"));
    t.equal(loaded.records.length, 1, "the row is kept for review");
  });

  test("Validation: organ mass", "a plausible row raises no mass flag", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,139.45,35.306,32.021,1.275,0.851,F,A,established\n");
    t.deepEqual(flagCodes(loaded.records[0]), [], "no flags at all");
  });

  test("Validation: organ mass", "somatic mass above body mass is flagged", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,10,12,0.5,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "organ_above_body_mass", "somatic_mass"));
  });

  test("Validation: organ mass", "an organ heavier than somatic mass is flagged separately", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,50,10,20,0.3,F,A,front\n");
    t.ok(hasFlag(loaded.records[0], "organ_above_somatic_mass", "gonad_mass"),
      "gonad above somatic mass makes the index exceed 100%");
    t.notOk(hasFlag(loaded.records[0], "organ_above_body_mass", "gonad_mass"),
      "but it is still below the body mass");
  });

  /* ========================================================= GSI and HSI */

  test("Indices: GSI and HSI", "both indices use somatic mass as the denominator", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,60,50,2,1.5,F,A,front\n");
    t.close(loaded.records[0].derived.gsi, 4, 1e-12, "GSI = 100 x 2 / 50");
    t.close(loaded.records[0].derived.hsi, 3, 1e-12, "HSI = 100 x 1.5 / 50");
  });

  test("Indices: GSI and HSI", "an index above 100% is computed and flagged, not clipped", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,80,50,60,1.5,F,A,front\n");
    t.close(loaded.records[0].derived.gsi, 120, 1e-12);
    t.ok(hasFlag(loaded.records[0], "organ_above_somatic_mass", "gonad_mass"));
  });

  test("Indices: GSI and HSI", "a missing somatic mass leaves the index undefined", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,60,,2,1.5,F,A,front\n");
    t.isNaN(loaded.records[0].derived.gsi, "not zero, not a guess");
    t.isNaN(loaded.records[0].derived.hsi);
  });

  test("Indices: GSI and HSI", "a zero somatic mass does not divide by zero", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,60,0,2,1.5,F,A,front\n");
    t.isNaN(loaded.records[0].derived.gsi, "no Infinity is produced");
    t.ok(hasFlag(loaded.records[0], "nonpositive", "somatic_mass"));
  });

  test("Indices: GSI and HSI", "one index can be available while the other is not", function (t) {
    var loaded = load(HEADER + "\n" + "RG1,100,60,50,,1.5,F,A,front\n");
    t.isNaN(loaded.records[0].derived.gsi, "no gonad mass recorded");
    t.close(loaded.records[0].derived.hsi, 3, 1e-12);
  });

  test("Indices: GSI and HSI", "coverage is counted honestly", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,60,50,2,1.5,F,A,front\n" +
      "RG2,100,60,,2,1.5,F,A,front\n");
    var coverage = validate.indexCoverage(loaded.records);
    t.equal(coverage.gsi, 1);
    t.equal(coverage.hsi, 1);
    t.equal(coverage.total, 2);
  });

  /* ============================================== simple regression maths */

  test("Regression: simple", "a perfect line is recovered exactly", function (t) {
    var model = stats.simpleOLS([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]);
    t.ok(model.ok);
    t.close(model.slope, 2, 1e-12);
    t.close(model.intercept, 1, 1e-12);
    t.close(model.r2, 1, 1e-12);
    t.equal(model.n, 5);
  });

  test("Regression: simple", "a hand-computed example matches", function (t) {
    /* x = 1..4, y = 2,4,5,8: Sxx = 5, Sxy = 9.5, slope = 1.9, intercept = 0. */
    var model = stats.simpleOLS([1, 2, 3, 4], [2, 4, 5, 8]);
    t.close(model.slope, 1.9, 1e-12);
    t.close(model.intercept, 0, 1e-12);
    t.close(model.r2, 1 - 0.7 / 18.75, 1e-12);
    t.close(model.slopeSE, Math.sqrt(0.07), 1e-12);
  });

  test("Regression: simple", "non-numeric pairs are ignored, not counted", function (t) {
    var model = stats.simpleOLS([1, 2, NaN, 3, 4], [3, 5, 9, 7, 9]);
    t.equal(model.n, 4, "only complete pairs are used");
    t.close(model.slope, 2, 1e-12);
  });

  test("Regression: simple", "too few points produces a refusal, not a number", function (t) {
    var model = stats.simpleOLS([1, 2], [3, 5]);
    t.notOk(model.ok);
    t.ok(model.reason.indexOf("3 paired values") >= 0);
  });

  test("Regression: simple", "a predictor with no variation produces a refusal", function (t) {
    var model = stats.simpleOLS([2, 2, 2, 2], [1, 2, 3, 4]);
    t.notOk(model.ok);
    t.ok(model.reason.indexOf("no variation") >= 0);
  });

  test("Regression: multiple", "an exact linear combination is recovered", function (t) {
    /* y = 3 + 2*x1 - 1*x2 */
    var x1 = [1, 2, 3, 4, 5, 6];
    var x2 = [2, 1, 4, 3, 6, 5];
    var y = x1.map(function (v, i) { return 3 + 2 * v - x2[i]; });
    var model = stats.multipleOLS(y, x1.map(function (v, i) { return [v, x2[i]]; }), ["x1", "x2"]);
    t.ok(model.ok);
    t.close(model.coefficients[0], 3, 1e-9, "intercept");
    t.close(model.coefficients[1], 2, 1e-9, "x1 slope");
    t.close(model.coefficients[2], -1, 1e-9, "x2 slope");
    t.close(model.r2, 1, 1e-9);
    t.equal(model.n, 6);
  });

  test("Regression: multiple", "it agrees with the closed-form simple regression", function (t) {
    var x = [1, 2, 3, 4, 5, 6, 7];
    var y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8];
    var simple = stats.simpleOLS(x, y);
    var multiple = stats.multipleOLS(y, x.map(function (v) { return [v]; }), ["x"]);
    t.close(multiple.coefficients[0], simple.intercept, 1e-9, "intercepts agree");
    t.close(multiple.coefficients[1], simple.slope, 1e-9, "slopes agree");
    t.close(multiple.r2, simple.r2, 1e-9, "R² agrees");
    t.close(multiple.standardErrors[1], simple.slopeSE, 1e-9, "standard errors agree");
  });

  test("Regression: multiple", "collinear predictors are refused, not fitted", function (t) {
    var x1 = [1, 2, 3, 4, 5, 6];
    var model = stats.multipleOLS(
      [1, 2, 3, 4, 5, 7],
      x1.map(function (v) { return [v, 2 * v]; }),
      ["x1", "twice x1"]);
    t.notOk(model.ok);
    t.ok(model.reason.indexOf("collinear") >= 0);
  });

  test("Regression: multiple", "too few rows for the parameters is refused", function (t) {
    var model = stats.multipleOLS([1, 2], [[1, 2], [2, 3]], ["a", "b"]);
    t.notOk(model.ok);
    t.ok(model.reason.indexOf("Not enough usable rows") >= 0);
  });

  /* ========================================== descriptive statistics helpers */

  test("Statistics", "mean, median and sample SD are correct", function (t) {
    t.close(stats.mean([1, 2, 3, 4]), 2.5, 1e-12);
    t.close(stats.median([1, 2, 3, 4]), 2.5, 1e-12);
    t.close(stats.median([5, 1, 3]), 3, 1e-12);
    t.close(stats.sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.13808993529939, 1e-12);
  });

  test("Statistics", "non-numeric text never becomes a number", function (t) {
    t.isNaN(stats.toNumber(""));
    t.isNaN(stats.toNumber("   "));
    t.isNaN(stats.toNumber("12a"));
    t.isNaN(stats.toNumber("Infinity"));
    t.isNaN(stats.toNumber(null));
    t.close(stats.toNumber(" 12.5 "), 12.5, 1e-12, "surrounding spaces are tolerated");
    t.close(stats.toNumber("1e2"), 100, 1e-12);
  });

  test("Statistics", "empty input gives NA rather than zero", function (t) {
    t.isNaN(stats.mean([]));
    t.isNaN(stats.sd([1]), "one value has no sample SD");
    t.equal(stats.fmt(NaN), "NA");
    t.equal(stats.fmt(1.23456, 2), "1.23");
  });

  /* ============================================== the analysis plan itself */

  test("Analysis plan", "an incomplete plan is rejected with reasons", function (t) {
    t.equal(analysis.validatePlan({ groupFields: [], outcome: "", predictors: [], logTransform: true }).length, 2,
      "a missing outcome and a missing predictor are both reported");
    t.equal(analysis.validatePlan({
      groupFields: [], outcome: "a", predictors: ["a"], logTransform: true
    }).length, 1, "the outcome cannot also be a predictor");
    t.equal(analysis.validatePlan({
      groupFields: [], outcome: "a", predictors: ["b"], logTransform: true
    }).length, 0, "a usable plan passes");
  });

  test("Analysis plan", "log transform is applied when every value is positive", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,F,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,A,front\n" +
      "RG4,130,25,9,0.5,0.3,F,A,front\n" +
      "RG5,140,32,9,0.5,0.3,F,A,front\n");
    var result = analysis.runAnalysis(loaded.records, {
      groupFields: [], outcome: "body_mass_g", predictors: ["total_length_mm"], logTransform: true
    });
    t.ok(result.ok);
    t.ok(result.transforms.every(function (tr) { return tr.log; }), "both variables logged");
    t.equal(result.outcomeLabel, "log(body_mass_g)");

    var expected = stats.simpleOLS(
      loaded.records.map(function (r) { return Math.log(r.numbers.length); }),
      loaded.records.map(function (r) { return Math.log(r.numbers.body_mass); }));
    t.close(result.model.coefficients[1], expected.slope, 1e-9,
      "the fitted slope is the slope of the logged data");
  });

  test("Analysis plan", "a variable with a zero is left untransformed and no row is dropped", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,F,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,A,front\n" +
      "RG4,130,0,9,0.5,0.3,F,A,front\n" +
      "RG5,140,32,9,0.5,0.3,F,A,front\n");
    var result = analysis.runAnalysis(loaded.records, {
      groupFields: [], outcome: "body_mass_g", predictors: ["total_length_mm"], logTransform: true
    });
    var outcomeTransform = result.transforms.filter(function (tr) {
      return tr.name === "body_mass_g";
    })[0];

    t.notOk(outcomeTransform.log, "the outcome stays on its original scale");
    t.ok(outcomeTransform.reason.indexOf("zero or negative") >= 0, "and the reason is stated");
    t.equal(result.rowsUsed, 5, "all five rows are still used");
    t.equal(result.rowsExcluded, 0, "nothing was dropped to make a logarithm possible");
  });

  test("Analysis plan", "unusable rows are counted and explained, never removed", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,F,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,A,front\n" +
      "RG4,130,,9,0.5,0.3,F,A,front\n" +
      "RG5,140,32,9,0.5,0.3,F,A,front\n");
    var result = analysis.runAnalysis(loaded.records, {
      groupFields: [], outcome: "body_mass_g", predictors: ["total_length_mm"], logTransform: false
    });
    t.equal(result.rowsTotal, 5);
    t.equal(result.rowsUsed, 4);
    t.equal(result.rowsExcluded, 1);
    t.equal(result.excludedByVariable.length, 1);
    t.equal(result.excludedByVariable[0].rows, 1);
    t.equal(loaded.records.length, 5, "the record set is untouched");
  });

  test("Analysis plan", "grouping splits the records as asked", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,M,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,B,established\n" +
      "RG4,130,25,9,0.5,0.3,F,B,established\n");

    var bySite = analysis.summarizeGroups(loaded.records, {
      groupFields: ["site"], outcome: "body_mass_g", predictors: ["total_length_mm"]
    });
    t.equal(bySite.summaries.length, 2, "two sites");
    t.equal(bySite.summaries[0].group, "A");
    t.equal(bySite.summaries[0].n, 2);
    t.close(bySite.summaries[0].stats.body_mass_g.mean, 12, 1e-12);

    var bySiteAndSex = analysis.summarizeGroups(loaded.records, {
      groupFields: ["site", "sex"], outcome: "body_mass_g", predictors: []
    });
    t.equal(bySiteAndSex.summaries.length, 3, "A|F, A|M and B|F");
  });

  test("Analysis plan", "a blank grouping value is labelled, not silently merged", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,,front\n" +
      "RG2,110,14,9,0.5,0.3,F,A,front\n");
    var grouped = analysis.summarizeGroups(loaded.records, {
      groupFields: ["site"], outcome: "body_mass_g", predictors: []
    });
    var labels = grouped.summaries.map(function (s) { return s.group; });
    t.ok(labels.indexOf("(missing)") >= 0, "the empty site is visible as (missing)");
  });

  test("Analysis plan", "grouped summaries report how many rows carry flags", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG1,110,14,9,0.5,0.3,F,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,B,front\n");
    var grouped = analysis.summarizeGroups(loaded.records, {
      groupFields: ["site"], outcome: "body_mass_g", predictors: []
    });
    var siteA = grouped.summaries.filter(function (s) { return s.group === "A"; })[0];
    t.equal(siteA.flaggedRows, 2, "both duplicated rows are counted in their group");
  });

  test("Analysis plan", "the derived indices can be modelled like any column", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,10,0.7,0.4,F,A,front\n" +
      "RG3,120,19,12,0.9,0.5,F,B,front\n" +
      "RG4,130,25,16,1.4,0.7,F,B,front\n" +
      "RG5,140,32,20,2.0,0.9,F,B,front\n");
    var profiles = analysis.profileColumns(loaded.parsed.headers, loaded.records);
    var names = analysis.modelVariables(profiles, loaded.records).map(function (v) { return v.name; });
    t.ok(names.indexOf("@gsi") >= 0, "GSI is offered as a variable");
    t.ok(names.indexOf("@hsi") >= 0, "HSI is offered as a variable");
    t.ok(names.indexOf("sex") < 0, "a text column is not offered as a numeric variable");

    var result = analysis.runAnalysis(loaded.records, {
      groupFields: [], outcome: "@gsi", predictors: ["total_length_mm"], logTransform: false
    });
    t.ok(result.ok);
    t.equal(result.rowsUsed, 5);
    t.equal(result.outcomeLabel, "GSI (% of somatic mass)");
  });

  test("Analysis plan", "column profiling separates numeric from categorical columns", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,M,B,front\n");
    var profiles = analysis.profileColumns(loaded.parsed.headers, loaded.records);
    function profile(name) {
      return profiles.filter(function (p) { return p.name === name; })[0];
    }
    t.ok(profile("body_mass_g").isNumeric);
    t.notOk(profile("sex").isNumeric);
    t.equal(profile("sex").distinctCount, 2);
    t.ok(profile("total_length_mm").allPositive);
  });

  test("Analysis plan", "the default plan reproduces the length/body-mass model", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,M,B,front\n");
    var profiles = analysis.profileColumns(loaded.parsed.headers, loaded.records);
    var plan = analysis.defaultPlan(loaded.mapping, profiles, loaded.records);
    t.equal(plan.outcome, "body_mass_g");
    t.deepEqual(plan.predictors, ["total_length_mm"]);
    t.ok(plan.logTransform);
    t.deepEqual(plan.groupFields, ["site", "sex", "invasion_stage"]);
  });

  /* ================================================= the no-deletion rule */

  test("Data integrity", "a file full of problems still yields one record per row", function (t) {
    var loaded = load(HEADER + "\n" +
      "RG1,-5,0,99,14,0.3,F,A,front\n" +
      ",abc,,,,,,,\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n");
    t.equal(loaded.records.length, 3, "every row survives validation");
    t.ok(loaded.records[0].flags.length >= 3, "the worst row collects several flags");
    t.equal(loaded.records[0].numbers.length, -5, "and keeps its original values");
  });

  /* ==================================================== privacy safeguards */

  test("Privacy", "network APIs are disabled and every attempt is recorded", function (t) {
    var before = PBA.privacy.blockedAttempts().length;
    t.ok(PBA.privacy.disabledApis.length > 0, "at least one network API was disabled");
    t.ok(PBA.privacy.disabledApis.indexOf("fetch") >= 0, "fetch is disabled");

    t.throws(function () { root.fetch("http://example.invalid/"); }, "fetch must refuse");
    t.equal(PBA.privacy.blockedAttempts().length, before + 1, "the refusal is recorded");
  });

  test("Privacy", "every API the build disabled actually refuses to run", function (t) {
    PBA.privacy.disabledApis.forEach(function (name) {
      if (name === "navigator.sendBeacon") {
        t.throws(function () { root.navigator.sendBeacon("http://example.invalid/", "x"); },
          "navigator.sendBeacon must refuse");
        return;
      }
      t.throws(function () { new root[name]("http://example.invalid/"); },
        name + " must refuse");
    });
  });

  test("Privacy", "the analysis modules never touch a network API", function (t) {
    var before = PBA.privacy.blockedAttempts().length;
    var loaded = load(HEADER + "\n" +
      "RG1,100,10,9,0.5,0.3,F,A,front\n" +
      "RG2,110,14,9,0.5,0.3,F,A,front\n" +
      "RG3,120,19,9,0.5,0.3,F,B,front\n" +
      "RG4,130,25,9,0.5,0.3,F,B,front\n");
    analysis.runAnalysis(loaded.records, {
      groupFields: ["site"], outcome: "body_mass_g", predictors: ["total_length_mm"], logTransform: true
    });
    t.equal(PBA.privacy.blockedAttempts().length, before,
      "a full analysis triggers no blocked network call");
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
