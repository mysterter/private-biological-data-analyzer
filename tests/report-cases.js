/*
 * report-cases.js — tests for the governance and reproducibility report.
 *
 * As with the rest of the suite, every fixture here is invented for the test.
 * Nothing in this file reads from disk, so these cases run both in Node and in
 * a double-clicked tests.html.
 */
(function (root) {
  "use strict";

  var PBA = root.PBA;
  var test = PBA.testing.test;
  var csv = PBA.csv;
  var validate = PBA.validate;
  var analysis = PBA.analysis;
  var report = PBA.report;

  var HEADER = "specimen_id,total_length_mm,body_mass_g,somatic_mass_g," +
               "gonad_mass_g,liver_mass_g,sex,site,invasion_stage";

  /* Six records at site A, three at site B: enough to see a group kept and a
     group withheld at the threshold of five. */
  var FIXTURE = HEADER + "\n" +
    "RG001,100,10,9,0.5,0.30,F,A,front\n" +
    "RG002,105,12,11,0.6,0.35,M,A,front\n" +
    "RG003,110,14,13,0.7,0.40,F,A,front\n" +
    "RG004,115,16,15,0.8,0.45,M,A,front\n" +
    "RG005,120,18,17,0.9,0.50,F,A,front\n" +
    "RG006,125,20,19,1.0,0.55,M,A,front\n" +
    "RG007,130,22,21,1.1,0.60,F,B,established\n" +
    "RG008,135,24,23,1.2,0.65,M,B,established\n" +
    "RG009,140,26,25,1.3,0.70,F,B,established\n";

  var IDENTIFIERS = ["RG001", "RG002", "RG003", "RG004", "RG005",
                     "RG006", "RG007", "RG008", "RG009"];

  var FIXED_TIME = new Date("2026-07-21T12:00:00.000Z");

  function analyse(text, planOverrides) {
    var parsed = csv.parseCSV(text);
    var mapping = validate.guessMapping(parsed.headers);
    var records = validate.flagRecords(validate.buildRecords(parsed.rows, mapping), mapping);
    var plan = {
      groupFields: ["site"],
      outcome: "body_mass_g",
      predictors: ["total_length_mm"],
      logTransform: true
    };
    Object.keys(planOverrides || {}).forEach(function (key) {
      plan[key] = planOverrides[key];
    });
    var result = analysis.runAnalysis(records, plan);
    return { parsed: parsed, mapping: mapping, records: records, plan: plan, result: result };
  }

  function build(text, planOverrides, project, options) {
    var context = analyse(text, planOverrides);
    var settings = { now: FIXED_TIME };
    Object.keys(options || {}).forEach(function (key) { settings[key] = options[key]; });
    return report.buildGovernanceReport({
      parsed: context.parsed,
      mapping: context.mapping,
      records: context.records,
      plan: context.plan,
      result: context.result,
      project: project || report.emptyProject()
    }, settings);
  }

  /* ============================ exports contain no specimen identifiers */

  test("Report: no identifiers", "no specimen identifier reaches the JSON export", function (t) {
    var json = report.reportToJSON(build(FIXTURE));
    IDENTIFIERS.forEach(function (id) {
      t.ok(json.indexOf(id) < 0, "the JSON export must not contain " + id);
    });
  });

  test("Report: no identifiers", "no specimen identifier reaches the HTML export", function (t) {
    var html = report.reportToHTML(build(FIXTURE));
    IDENTIFIERS.forEach(function (id) {
      t.ok(html.indexOf(id) < 0, "the HTML export must not contain " + id);
    });
  });

  test("Report: no identifiers", "grouping by specimen ID still leaks nothing", function (t) {
    /* Every group holds one record, so every group falls under the threshold
       and is withheld along with its label. */
    var built = build(FIXTURE, { groupFields: ["specimen_id"] });
    var json = report.reportToJSON(built);
    var html = report.reportToHTML(built);

    t.equal(built.group_summary.groups.length, 0, "no group survives the threshold");
    t.equal(built.group_summary.groups_withheld, 9, "all nine groups are withheld");
    IDENTIFIERS.forEach(function (id) {
      t.ok(json.indexOf(id) < 0, "JSON must not contain " + id);
      t.ok(html.indexOf(id) < 0, "HTML must not contain " + id);
    });
  });

  test("Report: no identifiers", "no raw measurement value reaches the export", function (t) {
    /* A value that appears in exactly one row and nowhere in any aggregate. */
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,A,front\n" +
      "RG002,105,12,11,0.6,0.35,M,A,front\n" +
      "RG003,110,14,13,0.7,0.40,F,A,front\n" +
      "RG004,115,16,15,0.8,0.45,M,A,front\n" +
      "RG005,120,18,17,0.9,0.50,F,A,front\n" +
      "RG006,123.456789,20,19,1.0,0.55,M,A,front\n";
    var json = report.reportToJSON(build(text));
    t.ok(json.indexOf("123.456789") < 0, "an individual measurement must not appear");
  });

  test("Report: no identifiers", "group statistics exclude the extremes and the median", function (t) {
    /* A minimum or maximum is not an aggregate: it is one specimen's recorded
       measurement, and a median is too whenever the group size is odd. */
    var built = build(FIXTURE);
    var stats = built.group_summary.groups[0].statistics["body_mass_g"];

    t.deepEqual(Object.keys(stats).sort(), ["mean", "n", "sd"],
      "only the count, mean and standard deviation are exported");
    t.notOk("min" in stats, "no minimum");
    t.notOk("max" in stats, "no maximum");
    t.notOk("median" in stats, "no median");
    t.ok(built.group_summary.statistics_note.length > 0, "and the omission is explained");
  });

  test("Report: no identifiers", "the report builder is never given the file name", function (t) {
    var built = build(FIXTURE);
    var json = report.reportToJSON(built);
    t.notOk(/file_?name/i.test(json.replace(/file_names_included/g, "")),
      "no file-name field is present");
    t.equal(built.disclosure_scope.file_names_included, false);
    t.equal(built.disclosure_scope.raw_rows_included, false);
    t.equal(built.disclosure_scope.specimen_identifiers_included, false);
  });

  /* ==================================== small groups are suppressed */

  test("Report: suppression", "a group below the threshold is withheld entirely", function (t) {
    var built = build(FIXTURE);
    var labels = built.group_summary.groups.map(function (g) { return g.group; });

    t.deepEqual(labels, ["A"], "only the six-record group is reported");
    t.ok(labels.indexOf("B") < 0, "the three-record group is not named at all");
    t.equal(built.group_summary.groups_withheld, 1);
    t.equal(built.group_summary.records_withheld, 3);
    t.equal(built.group_summary.suppression_threshold, 5);
  });

  test("Report: suppression", "the withheld group's label never appears in either export", function (t) {
    /* A label distinctive enough that a substring match is meaningful. */
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,Alpha,front\n" +
      "RG002,105,12,11,0.6,0.35,M,Alpha,front\n" +
      "RG003,110,14,13,0.7,0.40,F,Alpha,front\n" +
      "RG004,115,16,15,0.8,0.45,M,Alpha,front\n" +
      "RG005,120,18,17,0.9,0.50,F,Alpha,front\n" +
      "RG006,125,20,19,1.0,0.55,M,Zeta_rare_site,established\n";
    var built = build(text);
    t.ok(report.reportToJSON(built).indexOf("Zeta_rare_site") < 0, "JSON withholds the label");
    t.ok(report.reportToHTML(built).indexOf("Zeta_rare_site") < 0, "HTML withholds the label");
    t.equal(built.group_summary.records_withheld, 1);
  });

  test("Report: suppression", "a group exactly at the threshold is reported", function (t) {
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,A,front\n" +
      "RG002,105,12,11,0.6,0.35,M,A,front\n" +
      "RG003,110,14,13,0.7,0.40,F,A,front\n" +
      "RG004,115,16,15,0.8,0.45,M,A,front\n" +
      "RG005,120,18,17,0.9,0.50,F,A,front\n";
    var built = build(text);
    t.equal(built.group_summary.groups.length, 1, "five records is enough");
    t.equal(built.group_summary.groups[0].n, 5);
    t.equal(built.group_summary.groups_withheld, 0);
  });

  test("Report: suppression", "the threshold is applied by the shared analysis helper", function (t) {
    var context = analyse(FIXTURE);
    var raw = context.result.groups;
    t.equal(raw.summaries.length, 2, "the raw computation still sees both groups");

    var suppressed = analysis.suppressSmallGroups(raw);
    t.equal(suppressed.summaries.length, 1);
    t.equal(suppressed.threshold, analysis.MIN_GROUP_SIZE);
    t.equal(analysis.MIN_GROUP_SIZE, 5, "the documented threshold is five");

    var strict = analysis.suppressSmallGroups(raw, 7);
    t.equal(strict.summaries.length, 0, "a higher threshold withholds more");
    t.equal(strict.suppressedRecordCount, 9);
  });

  test("Report: suppression", "suppression does not change the model", function (t) {
    var context = analyse(FIXTURE);
    t.equal(context.result.rowsUsed, 9,
      "all nine rows fit the model even though one group is withheld from the table");
    t.equal(build(FIXTURE).statistical_model.observations, 9);
  });

  /* ========================================= missingness calculations */

  test("Report: missingness", "percentages match a hand-counted fixture", function (t) {
    var parsed = csv.parseCSV("id,a,b\n1,x,\n2,,\n3,x,y\n4,x,\n");
    var result = report.missingness(parsed.rows, parsed.headers);
    function column(name) {
      return result.filter(function (entry) { return entry.column === name; })[0];
    }

    t.equal(column("id").missing, 0);
    t.equal(column("id").missing_percent, 0);
    t.equal(column("a").missing, 1, "row 2 is blank");
    t.equal(column("a").present, 3);
    t.equal(column("a").missing_percent, 25);
    t.equal(column("b").missing, 3, "rows 1, 2 and 4 are blank");
    t.equal(column("b").missing_percent, 75);
    t.equal(column("b").rows, 4);
  });

  test("Report: missingness", "whitespace counts as missing", function (t) {
    var parsed = csv.parseCSV("id,a\n1,   \n2,x\n");
    var result = report.missingness(parsed.rows, parsed.headers);
    t.equal(result[1].missing, 1, "a whitespace-only value is not a value");
    t.equal(result[1].missing_percent, 50);
  });

  test("Report: missingness", "every column is reported, including complete ones", function (t) {
    var built = build(FIXTURE);
    t.equal(built.dataset.missingness.length, built.dataset.columns,
      "one entry per column");
    built.dataset.missingness.forEach(function (entry) {
      t.equal(entry.missing, 0, entry.column + " is complete in this fixture");
      t.equal(entry.missing_percent, 0);
      t.equal(entry.present, 9);
    });
  });

  test("Report: missingness", "a third of a column reports as 33.33 per cent", function (t) {
    var parsed = csv.parseCSV("id,a\n1,\n2,x\n3,y\n");
    var result = report.missingness(parsed.rows, parsed.headers);
    t.equal(result[1].missing_percent, 33.33, "rounded to two decimals");
  });

  test("Report: missingness", "an empty dataset does not divide by zero", function (t) {
    var result = report.missingness([], ["a", "b"]);
    t.equal(result[0].rows, 0);
    t.equal(result[0].missing_percent, null, "no percentage rather than NaN");
  });

  /* ================================== generated without network access */

  test("Report: no network", "building and exporting triggers no network call", function (t) {
    var before = PBA.privacy.blockedAttempts().length;
    var built = build(FIXTURE);
    report.reportToJSON(built);
    report.reportToHTML(built);
    t.equal(PBA.privacy.blockedAttempts().length, before,
      "no disabled network API was reached during report generation");
  });

  test("Report: no network", "the HTML export references nothing outside itself", function (t) {
    var html = report.reportToHTML(build(FIXTURE));
    t.notOk(/https?:\/\//.test(html), "no absolute URL");
    t.notOk(/<script/i.test(html), "no script of any kind");
    t.notOk(/<link/i.test(html), "no external stylesheet");
    t.notOk(/@import/i.test(html), "no imported stylesheet");
    t.notOk(/url\(/i.test(html), "no referenced asset");
    t.ok(html.indexOf("default-src 'none'") >= 0, "it declares its own policy");
  });

  test("Report: no network", "the export records that no request was made", function (t) {
    var built = build(FIXTURE);
    t.equal(built.privacy_safeguards.network_requests_made, 0);
    t.equal(built.privacy_safeguards.local_only, true);
    t.equal(built.privacy_safeguards.browser_storage_used, false);
    t.equal(built.privacy_safeguards.external_libraries_used, 0);
    t.ok(built.privacy_safeguards.network_apis_disabled.length > 0,
      "the disabled APIs are listed");
  });

  /* ============================ consistent output for identical input */

  test("Report: reproducibility", "identical inputs produce identical JSON", function (t) {
    var first = report.reportToJSON(build(FIXTURE));
    var second = report.reportToJSON(build(FIXTURE));
    t.equal(first, second, "the JSON export is byte-identical");
  });

  test("Report: reproducibility", "identical inputs produce identical HTML", function (t) {
    var first = report.reportToHTML(build(FIXTURE));
    var second = report.reportToHTML(build(FIXTURE));
    t.equal(first, second, "the HTML export is byte-identical");
  });

  test("Report: reproducibility", "only the timestamp differs between two runs", function (t) {
    var early = build(FIXTURE, null, null, { now: new Date("2026-01-01T00:00:00.000Z") });
    var late = build(FIXTURE, null, null, { now: new Date("2026-12-31T23:59:59.000Z") });

    t.ok(early.generated_at !== late.generated_at, "the timestamps do differ");
    early.generated_at = late.generated_at = "";
    t.equal(JSON.stringify(early), JSON.stringify(late),
      "everything else is unchanged by the clock");
  });

  test("Report: reproducibility", "a different plan produces a different report", function (t) {
    var logged = report.reportToJSON(build(FIXTURE));
    var untransformed = report.reportToJSON(build(FIXTURE, { logTransform: false }));
    t.ok(logged !== untransformed, "the report reflects the plan it describes");
  });

  test("Report: reproducibility", "the timestamp is the injected one, in ISO form", function (t) {
    var built = build(FIXTURE);
    t.equal(built.generated_at, "2026-07-21T12:00:00.000Z");
  });

  /* ================================================= report contents */

  test("Report: contents", "every required section is present", function (t) {
    var built = build(FIXTURE);

    t.equal(built.application.version, PBA.meta.version, "application version");
    t.ok(built.generated_at.length > 0, "analysis timestamp");
    t.equal(built.dataset.rows, 9, "row count");
    t.equal(built.dataset.columns, 9, "column count");
    t.equal(built.column_mappings.body_mass, "body_mass_g", "column mappings");
    t.ok(built.dataset.missingness.length > 0, "missingness percentages");
    t.equal(built.validation.rules_applied.length, 6, "validation rules applied");
    t.ok(Array.isArray(built.validation.aggregate_flag_counts), "aggregate flag counts");
    t.ok(built.transformations.length > 0, "transformations");
    t.deepEqual(built.analysis_plan.grouping_variables, ["site"], "grouping variables");
    t.equal(built.analysis_plan.outcome_variable, "log(body_mass_g)", "outcome variable");
    t.deepEqual(built.analysis_plan.predictor_variables, ["log(total_length_mm)"], "predictors");
    t.ok(built.statistical_model.description.length > 0, "model description");
    t.ok(built.limitations.length > 0, "limitations");
    t.ok(built.interpretation_warnings.length > 0, "interpretation warnings");
  });

  test("Report: contents", "only mapped columns appear in the mappings", function (t) {
    var built = build(FIXTURE);
    Object.keys(built.column_mappings).forEach(function (key) {
      t.ok(built.column_mappings[key] !== "", key + " is mapped to a real column");
    });
    t.notOk("collection_date" in built.column_mappings,
      "an unmapped field is omitted rather than reported as blank");
  });

  test("Report: contents", "aggregate flag counts match the validation summary", function (t) {
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,A,front\n" +
      "RG001,105,12,11,0.6,0.35,M,A,front\n" +
      "RG003,110,14,13,0.7,0.40,F,A,front\n" +
      "RG004,115,16,15,0.8,0.45,M,A,front\n" +
      "RG005,120,18,17,0.9,0.50,F,A,front\n";
    var built = build(text);
    var duplicate = built.validation.aggregate_flag_counts.filter(function (entry) {
      return entry.code === "duplicate_id";
    })[0];

    t.ok(duplicate, "the duplicate check is reported");
    t.equal(duplicate.rows_affected, 2, "two rows share an identifier");
    t.equal(built.validation.rows_with_any_flag, 2);
    t.equal(built.validation.rows_total, 5);
    t.ok(built.validation.policy.indexOf("flagged and kept") >= 0,
      "the no-deletion policy is stated in the report");
  });

  test("Report: contents", "a refused model is described rather than omitted", function (t) {
    /* Two rows cannot support an intercept and a slope. */
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,A,front\n" +
      "RG002,105,12,11,0.6,0.35,M,A,front\n";
    var built = build(text);
    t.equal(built.statistical_model.fitted, false);
    t.ok(built.statistical_model.reason.length > 0, "the reason is carried into the report");
    t.ok(built.statistical_model.description.indexOf("No model was fitted") >= 0);
  });

  test("Report: contents", "values that cannot be computed are null, never zero", function (t) {
    var text = HEADER + "\n" +
      "RG001,100,10,9,0.5,0.30,F,A,front\n" +
      "RG002,105,12,11,0.6,0.35,M,A,front\n";
    var json = report.reportToJSON(build(text));
    t.ok(json.indexOf("NaN") < 0, "no NaN leaks into the JSON");
  });

  /* ========================================== the project-information form */

  test("Report: project form", "an empty form is recorded as unanswered", function (t) {
    var built = build(FIXTURE, null, report.emptyProject());
    t.equal(built.project_information.completed, false);
    t.equal(built.project_information.fields_answered, 0);
    t.equal(built.project_information.fields.title, report.NOT_STATED);
    t.equal(built.project_information.fields.intended_use, report.NOT_STATED);
  });

  test("Report: project form", "answers are carried through verbatim", function (t) {
    var project = report.emptyProject();
    project.title = "Round goby condition survey";
    project.custodian = "Freshwater ecology group";
    project.prohibited_uses = "No redistribution outside the group.";
    project.permission_status = "Obtained";

    var built = build(FIXTURE, null, project);
    t.equal(built.project_information.completed, true);
    t.equal(built.project_information.fields_answered, 4);
    t.equal(built.project_information.fields.title, "Round goby condition survey");
    t.equal(built.project_information.fields.permission_status, "Obtained");
    t.equal(built.project_information.fields.retention_plan, report.NOT_STATED,
      "an unanswered field is still listed");
  });

  test("Report: project form", "all eight governance questions are asked", function (t) {
    var keys = report.PROJECT_FIELDS.map(function (field) { return field.key; });
    t.deepEqual(keys, [
      "title", "custodian", "intended_use", "prohibited_uses",
      "permission_status", "retention_plan", "sampling_limitations", "potential_bias"
    ]);
  });

  test("Report: project form", "typed text cannot inject markup into the HTML export", function (t) {
    var project = report.emptyProject();
    project.title = "<script>alert(1)</script>";
    var html = report.reportToHTML(build(FIXTURE, null, project));

    t.ok(html.indexOf("&lt;script&gt;") >= 0, "the text is escaped");
    t.notOk(/<script/i.test(html), "and no executable tag is produced");
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
