/*
 * report.js — the Research Data Governance and Reproducibility Report.
 *
 * This module builds an aggregate account of what was analysed and how, so a
 * colleague or a reviewer can judge and repeat the work without ever seeing the
 * data. It is a pure function of its inputs: give it the same inputs and the
 * same timestamp and it produces byte-identical output, which is what makes
 * reproducibility checkable rather than merely claimed.
 *
 * Privacy is structural, not a filtering step. The builder is handed counts,
 * mappings, flag tallies and group statistics — never a row array. There is no
 * code path by which a specimen identifier, a raw value or a file name could
 * reach the report, because none of them is passed in.
 *
 * Column *names* are included, since the mappings are part of what makes an
 * analysis reproducible. Those describe the schema, not any specimen.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  PBA.meta = {
    name: "Private Biological CSV Analyzer",
    version: "1.1.0"
  };

  /* One definition of the project form, used both to build the form in the
     interface and to read it back into the report, so the two cannot drift. */
  var PROJECT_FIELDS = [
    { key: "title", label: "Project title", type: "text",
      hint: "How this study is referred to internally." },
    { key: "custodian", label: "Dataset owner / custodian", type: "text",
      hint: "Who is accountable for this data." },
    { key: "intended_use", label: "Intended scientific use", type: "textarea",
      hint: "What this dataset may be used for." },
    { key: "prohibited_uses", label: "Prohibited uses", type: "textarea",
      hint: "Uses that are explicitly not permitted." },
    { key: "permission_status", label: "Permission or consent status", type: "select",
      options: ["Not stated", "Obtained", "Pending", "Under review", "Not required", "Not applicable"],
      hint: "Permits, ethics approval or consent covering this data." },
    { key: "retention_plan", label: "Retention and deletion plan", type: "textarea",
      hint: "How long this data is kept and how it is destroyed." },
    { key: "sampling_limitations", label: "Known sampling limitations", type: "textarea",
      hint: "What the sampling design cannot support." },
    { key: "potential_bias", label: "Potential sources of bias", type: "textarea",
      hint: "Known or suspected bias in collection or measurement." }
  ];

  var NOT_STATED = "(not stated)";

  /* Fixed text. These are statements about what the tool does and does not do,
     never statements about the data. */
  var LIMITATIONS = [
    "This tool computes descriptive statistics and ordinary least squares estimates. It does not test the assumptions behind them.",
    "No p-values or confidence intervals are reported. Inference would require assumption checks this tool does not perform.",
    "Standard errors assume independent, identically distributed residuals, which is unlikely to hold for repeated measurements or clustered sampling.",
    "Rows flagged during validation are retained. A flag marks a value as worth checking; it is not a correction and not a deletion.",
    "Group summaries are descriptive. No test of any difference between groups has been carried out.",
    "Date and year effects, sex-specific models, non-linear terms, residual diagnostics and multiple-comparison control are not implemented.",
    "GSI and HSI are expressed as a percentage of somatic mass. Confirm that this denominator matches the study protocol before reporting them."
  ];

  var INTERPRETATION_WARNINGS = [
    "Nothing in this report establishes a biological effect, a difference between groups, or a causal relationship.",
    "These figures describe the supplied file only and do not generalise beyond it.",
    "Groups smaller than the suppression threshold are withheld, so reported group counts need not sum to the total row count.",
    "Rows excluded from the model remain in the dataset; exclusion applies only to the model fit and is reported with its reason.",
    "Confirm the column mappings and the measurement units before quoting any figure from this report."
  ];

  var VALIDATION_RULES = [
    { check: "Missing required value", severity: "error",
      rule: "Specimen ID, length or body mass is blank." },
    { check: "Non-numeric measurement", severity: "error / warning",
      rule: "A measurement cannot be read as a number. Error for required fields, warning for optional ones." },
    { check: "Zero or negative measurement", severity: "error / warning",
      rule: "A measurement is less than or equal to zero. Error for required fields, warning for optional ones." },
    { check: "Duplicate specimen identifier", severity: "warning",
      rule: "The same identifier appears on more than one row. Rows are kept, not merged or removed." },
    { check: "Organ mass above body mass", severity: "warning",
      rule: "A somatic, gonad or liver mass exceeds the recorded body mass." },
    { check: "Organ mass above somatic mass", severity: "warning",
      rule: "A gonad or liver mass exceeds the somatic mass, so the derived index exceeds 100%." }
  ];

  /** JSON has no NaN; a value that could not be computed is reported as null. */
  function jsonNumber(value) {
    return Number.isFinite(value) ? value : null;
  }

  function round(value, digits) {
    if (!Number.isFinite(value)) return null;
    var factor = Math.pow(10, digits === undefined ? 4 : digits);
    return Math.round(value * factor) / factor;
  }

  function emptyProject() {
    var project = {};
    PROJECT_FIELDS.forEach(function (field) {
      project[field.key] = field.type === "select" ? field.options[0] : "";
    });
    return project;
  }

  /**
   * Normalise the optional project form.
   * Blank answers are recorded as "(not stated)" rather than dropped, so the
   * report shows what was asked and left unanswered.
   */
  function describeProject(project) {
    var source = project || {};
    var fields = {};
    var answered = 0;

    PROJECT_FIELDS.forEach(function (field) {
      var raw = source[field.key];
      var value = raw === null || raw === undefined ? "" : String(raw).trim();
      var isDefaultSelect = field.type === "select" && value === field.options[0];
      if (value === "" || isDefaultSelect) {
        fields[field.key] = field.type === "select" ? value || NOT_STATED : NOT_STATED;
      } else {
        fields[field.key] = value;
        answered += 1;
      }
    });

    return {
      completed: answered > 0,
      fields_answered: answered,
      fields_total: PROJECT_FIELDS.length,
      note: answered > 0
        ? "Supplied by the user of this tool; not derived from the data."
        : "The optional project-information form was left empty.",
      fields: fields
    };
  }

  /**
   * Per-column missingness: how many rows hold no value for each column.
   * A value counts as missing when it is blank or only whitespace.
   */
  function missingness(records, headers) {
    var total = records.length;
    return headers.map(function (header) {
      var missing = 0;
      records.forEach(function (record) {
        var data = record.data || {};
        var raw = header in data ? data[header] : "";
        if (String(raw === null || raw === undefined ? "" : raw).trim() === "") missing += 1;
      });
      return {
        column: header,
        rows: total,
        present: total - missing,
        missing: missing,
        missing_percent: total ? round(100 * missing / total, 2) : null
      };
    });
  }

  function describeModel(result) {
    var model = result.model;

    if (!model.ok) {
      return {
        fitted: false,
        method: "Ordinary least squares",
        reason: model.reason,
        description: "No model was fitted. " + model.reason
      };
    }

    return {
      fitted: true,
      method: "Ordinary least squares (normal equations, Gauss-Jordan solve)",
      description:
        "Ordinary least squares regression of " + result.outcomeLabel + " on " +
        result.predictorLabels.join(" and ") + ", fitted to " + model.n +
        " rows. Descriptive only: no p-values are reported and the model " +
        "assumptions have not been tested.",
      outcome: result.outcomeLabel,
      terms: model.names,
      estimates: model.coefficients.map(jsonNumber),
      standard_errors: model.standardErrors.map(jsonNumber),
      t_statistics: model.tStatistics.map(jsonNumber),
      observations: model.n,
      parameters: model.parameters,
      residual_degrees_of_freedom: model.df,
      r_squared: jsonNumber(model.r2),
      adjusted_r_squared: jsonNumber(model.adjustedR2),
      residual_sd: jsonNumber(model.residualSD)
    };
  }

  /*
   * Only n, mean and standard deviation are exported.
   *
   * The minimum and maximum of a group are not summaries at all: each one is
   * exactly one specimen's recorded measurement, so publishing them would put
   * raw values into a report that promises not to contain any. The median has
   * the same problem whenever the group holds an odd number of records. The
   * interactive screen shows the same three figures for the same reason.
   */
  function describeStats(describe) {
    return {
      n: describe.n,
      mean: jsonNumber(round(describe.mean, 6)),
      sd: jsonNumber(round(describe.sd, 6))
    };
  }

  /**
   * Build the report.
   *
   * inputs:  { parsed, mapping, records, plan, result, project }
   * options: { now, minGroupSize }
   *
   * `now` is injected rather than read from the clock so that identical inputs
   * produce identical output. Nothing here reads the file name, the rows or any
   * specimen identifier, because none of them is passed in.
   */
  function buildGovernanceReport(inputs, options) {
    var settings = options || {};
    var now = settings.now || new Date();
    var threshold = settings.minGroupSize === undefined
      ? PBA.analysis.MIN_GROUP_SIZE
      : settings.minGroupSize;

    var parsed = inputs.parsed;
    var records = inputs.records;
    var result = inputs.result;
    var plan = result.plan;

    var mappedOnly = {};
    Object.keys(inputs.mapping).sort().forEach(function (key) {
      if (inputs.mapping[key]) mappedOnly[key] = inputs.mapping[key];
    });

    var flagSummary = PBA.validate.summarizeFlags(records);
    var coverage = PBA.validate.indexCoverage(records);
    var grouped = PBA.analysis.suppressSmallGroups(result.groups, threshold);

    return {
      report_type: "Research Data Governance and Reproducibility Report",
      application: {
        name: PBA.meta.name,
        version: PBA.meta.version,
        execution: "Entirely client-side, in the browser tab that produced it."
      },
      generated_at: now.toISOString(),

      disclosure_scope: {
        aggregate_only: true,
        raw_rows_included: false,
        specimen_identifiers_included: false,
        file_names_included: false,
        individual_values_included: false,
        note: "This report is built from counts, mappings and summary " +
              "statistics. Row-level data is never supplied to the report builder."
      },

      project_information: describeProject(inputs.project),

      dataset: {
        rows: records.length,
        columns: parsed.headers.length,
        column_names: parsed.headers.slice(),
        blank_lines_skipped: parsed.blankRowsSkipped,
        structural_warnings: parsed.warnings.map(function (warning) {
          return { code: warning.code, message: warning.message };
        }),
        missingness: missingness(records, parsed.headers)
      },

      column_mappings: mappedOnly,

      derived_indices: {
        definitions: "GSI = 100 x gonad mass / somatic mass; " +
                     "HSI = 100 x liver mass / somatic mass",
        gsi_rows_computed: coverage.gsi,
        hsi_rows_computed: coverage.hsi,
        rows_total: coverage.total
      },

      validation: {
        rules_applied: VALIDATION_RULES,
        aggregate_flag_counts: flagSummary.map(function (entry) {
          return {
            check: entry.label,
            code: entry.code,
            severity: entry.severity,
            rows_affected: entry.rows
          };
        }),
        rows_total: records.length,
        rows_with_any_flag: records.filter(function (r) { return r.flags.length > 0; }).length,
        rows_with_errors: PBA.validate.countRowsWithSeverity(records, "error"),
        rows_with_warnings: PBA.validate.countRowsWithSeverity(records, "warning"),
        policy: "Questionable values are flagged and kept. No row or value is " +
                "deleted, corrected or overwritten by this tool."
      },

      analysis_plan: {
        grouping_variables: plan.groupFields.slice(),
        outcome_variable: result.outcomeLabel,
        predictor_variables: result.predictorLabels.slice(),
        log_transform_requested: plan.logTransform
      },

      transformations: result.transforms.map(function (transform) {
        return {
          variable: PBA.analysis.variableLabel(transform.name),
          log_transformed: transform.log,
          reason: transform.reason
        };
      }),

      model_fit_population: {
        rows_total: result.rowsTotal,
        rows_used: result.rowsUsed,
        rows_excluded: result.rowsExcluded,
        excluded_by_variable: result.excludedByVariable.map(function (entry) {
          return { variable: entry.label, rows: entry.rows, reason: entry.reason };
        }),
        note: "Excluded rows remain in the dataset and in the validation counts."
      },

      statistical_model: describeModel(result),

      group_summary: {
        suppression_threshold: grouped.threshold,
        suppression_note: grouped.note,
        statistics_note: "Only the count, mean and standard deviation are " +
                         "reported per group. A minimum, maximum or median " +
                         "would repeat an individual specimen's measurement.",
        groups_withheld: grouped.suppressedGroupCount,
        records_withheld: grouped.suppressedRecordCount,
        variables: grouped.variables.map(function (name) {
          return PBA.analysis.variableLabel(name);
        }),
        groups: grouped.summaries.map(function (summary) {
          var reported = {};
          grouped.variables.forEach(function (name) {
            reported[PBA.analysis.variableLabel(name)] = describeStats(summary.stats[name]);
          });
          return {
            group: summary.group,
            n: summary.n,
            rows_with_flags: summary.flaggedRows,
            statistics: reported
          };
        })
      },

      limitations: LIMITATIONS.slice(),
      interpretation_warnings: INTERPRETATION_WARNINGS.slice(),

      privacy_safeguards: {
        local_only: true,
        network_apis_disabled: PBA.privacy.disabledApis.slice(),
        network_requests_made: 0,
        browser_storage_used: false,
        external_libraries_used: 0,
        small_group_suppression: {
          threshold: threshold,
          groups_withheld: grouped.suppressedGroupCount,
          records_withheld: grouped.suppressedRecordCount
        }
      }
    };
  }

  function reportToJSON(report) {
    return JSON.stringify(report, null, 2);
  }

  /* ------------------------------------------------- standalone HTML export */

  function escapeHTML(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function htmlTable(headers, rows) {
    if (!rows.length) return "<p class=\"empty\">Nothing to report.</p>";
    return "<table><thead><tr>" +
      headers.map(function (h) { return "<th>" + escapeHTML(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      rows.map(function (row) {
        return "<tr>" + row.map(function (cell) {
          return "<td>" + escapeHTML(cell === null || cell === undefined ? "—" : cell) + "</td>";
        }).join("") + "</tr>";
      }).join("") +
      "</tbody></table>";
  }

  function htmlList(items) {
    if (!items.length) return "<p class=\"empty\">None.</p>";
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHTML(item) + "</li>";
    }).join("") + "</ul>";
  }

  function htmlPairs(pairs) {
    return "<dl>" + pairs.map(function (pair) {
      return "<dt>" + escapeHTML(pair[0]) + "</dt><dd>" + escapeHTML(pair[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  function section(title, body) {
    return "<section><h2>" + escapeHTML(title) + "</h2>" + body + "</section>";
  }

  var EXPORT_CSS = [
    "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#15202b;",
    "background:#f4f7fa;margin:0;padding:32px;line-height:1.5}",
    "main{max-width:900px;margin:0 auto;background:#fff;border:1px solid #d9e1e8;",
    "border-radius:14px;padding:32px}",
    "h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 8px;",
    "padding-bottom:6px;border-bottom:1px solid #e4e9ee}",
    ".sub{color:#53616e;font-size:.9rem;margin:0 0 8px}",
    ".banner{border-left:4px solid #2b7a4b;background:#f6f9fb;padding:10px 14px;",
    "border-radius:8px;font-size:.9rem;margin:16px 0}",
    ".caution{border-left-color:#a45b00}",
    "table{width:100%;border-collapse:collapse;font-size:.86rem;margin:8px 0}",
    "th,td{padding:7px 8px;border-bottom:1px solid #e4e9ee;text-align:left;",
    "vertical-align:top}th{background:#f6f9fb}",
    "dl{margin:8px 0;font-size:.9rem}dt{font-weight:700;margin-top:10px}",
    "dd{margin:2px 0 0;color:#33414e;white-space:pre-wrap}",
    "ul{font-size:.9rem;padding-left:20px}li{margin:4px 0}",
    ".empty{color:#7c8894;font-size:.88rem;font-style:italic}",
    "footer{margin-top:28px;padding-top:12px;border-top:1px solid #e4e9ee;",
    "color:#7c8894;font-size:.8rem}"
  ].join("");

  /**
   * Render the report as one self-contained HTML file.
   * No scripts, no external references, and a policy that forbids both, so the
   * exported file behaves the same offline as it does anywhere else.
   */
  function reportToHTML(report) {
    var parts = [];

    parts.push(section("Provenance", htmlPairs([
      ["Report type", report.report_type],
      ["Application", report.application.name],
      ["Application version", report.application.version],
      ["Analysis timestamp", report.generated_at],
      ["Execution", report.application.execution]
    ])));

    parts.push(section("Disclosure scope",
      "<div class=\"banner\">" + escapeHTML(report.disclosure_scope.note) + "</div>" +
      htmlTable(["Property", "Value"], [
        ["Aggregate only", report.disclosure_scope.aggregate_only],
        ["Raw rows included", report.disclosure_scope.raw_rows_included],
        ["Specimen identifiers included", report.disclosure_scope.specimen_identifiers_included],
        ["File names included", report.disclosure_scope.file_names_included],
        ["Individual values included", report.disclosure_scope.individual_values_included]
      ])));

    var project = report.project_information;
    parts.push(section("Project information",
      "<p class=\"sub\">" + escapeHTML(project.note) + " " +
      escapeHTML(project.fields_answered + " of " + project.fields_total + " fields answered.") +
      "</p>" +
      htmlPairs(PROJECT_FIELDS.map(function (field) {
        return [field.label, project.fields[field.key]];
      }))));

    parts.push(section("Dataset",
      htmlPairs([
        ["Rows", String(report.dataset.rows)],
        ["Columns", String(report.dataset.columns)],
        ["Blank lines skipped", String(report.dataset.blank_lines_skipped)],
        ["Column names", report.dataset.column_names.join(", ")]
      ]) +
      "<h3>Missingness</h3>" +
      htmlTable(["Column", "Rows", "Present", "Missing", "Missing %"],
        report.dataset.missingness.map(function (entry) {
          return [entry.column, entry.rows, entry.present, entry.missing,
                  entry.missing_percent === null ? "—" : entry.missing_percent + "%"];
        })) +
      (report.dataset.structural_warnings.length
        ? "<h3>Structural warnings</h3>" +
          htmlList(report.dataset.structural_warnings.map(function (w) { return w.message; }))
        : "")));

    parts.push(section("Column mappings",
      htmlTable(["Analysis field", "Column in file"],
        Object.keys(report.column_mappings).map(function (key) {
          return [key, report.column_mappings[key]];
        }))));

    parts.push(section("Derived indices",
      htmlPairs([
        ["Definitions", report.derived_indices.definitions],
        ["GSI computed for", report.derived_indices.gsi_rows_computed + " of " +
          report.derived_indices.rows_total + " rows"],
        ["HSI computed for", report.derived_indices.hsi_rows_computed + " of " +
          report.derived_indices.rows_total + " rows"]
      ])));

    parts.push(section("Validation",
      "<div class=\"banner\">" + escapeHTML(report.validation.policy) + "</div>" +
      "<h3>Rules applied</h3>" +
      htmlTable(["Check", "Severity", "Rule"],
        report.validation.rules_applied.map(function (rule) {
          return [rule.check, rule.severity, rule.rule];
        })) +
      "<h3>Aggregate flag counts</h3>" +
      htmlTable(["Check", "Severity", "Rows affected"],
        report.validation.aggregate_flag_counts.map(function (entry) {
          return [entry.check, entry.severity, entry.rows_affected];
        })) +
      htmlPairs([
        ["Rows total", String(report.validation.rows_total)],
        ["Rows with any flag", String(report.validation.rows_with_any_flag)],
        ["Rows with an error-level flag", String(report.validation.rows_with_errors)],
        ["Rows with a warning-level flag", String(report.validation.rows_with_warnings)]
      ])));

    parts.push(section("Analysis plan",
      htmlPairs([
        ["Grouping variables", report.analysis_plan.grouping_variables.length
          ? report.analysis_plan.grouping_variables.join(", ")
          : "None (all records together)"],
        ["Outcome variable", report.analysis_plan.outcome_variable],
        ["Predictor variables", report.analysis_plan.predictor_variables.join(", ")],
        ["Log transform requested", String(report.analysis_plan.log_transform_requested)]
      ]) +
      "<h3>Transformations</h3>" +
      htmlTable(["Variable", "Log transformed", "Reason"],
        report.transformations.map(function (entry) {
          return [entry.variable, String(entry.log_transformed), entry.reason];
        }))));

    parts.push(section("Rows used by the model",
      htmlPairs([
        ["Rows total", String(report.model_fit_population.rows_total)],
        ["Rows used", String(report.model_fit_population.rows_used)],
        ["Rows excluded", String(report.model_fit_population.rows_excluded)]
      ]) +
      (report.model_fit_population.excluded_by_variable.length
        ? htmlTable(["Variable", "Rows", "Reason"],
            report.model_fit_population.excluded_by_variable.map(function (entry) {
              return [entry.variable, entry.rows, entry.reason];
            }))
        : "") +
      "<div class=\"banner\">" + escapeHTML(report.model_fit_population.note) + "</div>"));

    var model = report.statistical_model;
    parts.push(section("Statistical model",
      "<p class=\"sub\">" + escapeHTML(model.description) + "</p>" +
      (model.fitted
        ? htmlTable(["Term", "Estimate", "Standard error", "t"],
            model.terms.map(function (term, index) {
              return [term, model.estimates[index], model.standard_errors[index],
                      model.t_statistics[index]];
            })) +
          htmlPairs([
            ["Method", model.method],
            ["Observations", String(model.observations)],
            ["R squared", String(model.r_squared)],
            ["Adjusted R squared", String(model.adjusted_r_squared)],
            ["Residual SD", String(model.residual_sd)]
          ])
        : "")));

    var groups = report.group_summary;
    var groupHeaders = ["Group", "n", "Rows with flags"];
    groups.variables.forEach(function (name) {
      groupHeaders.push(name + " mean");
      groupHeaders.push(name + " SD");
      groupHeaders.push(name + " n");
    });
    parts.push(section("Group summary",
      "<div class=\"banner caution\">" + escapeHTML(groups.suppression_note) + " " +
      escapeHTML(groups.groups_withheld + " group(s) covering " + groups.records_withheld +
                 " record(s) were withheld.") + "</div>" +
      "<p class=\"sub\">" + escapeHTML(groups.statistics_note) + "</p>" +
      htmlTable(groupHeaders, groups.groups.map(function (group) {
        var row = [group.group, group.n, group.rows_with_flags];
        groups.variables.forEach(function (name) {
          var stat = group.statistics[name];
          row.push(stat.mean);
          row.push(stat.sd);
          row.push(stat.n);
        });
        return row;
      }))));

    parts.push(section("Limitations", htmlList(report.limitations)));
    parts.push(section("Interpretation warnings",
      "<div class=\"banner caution\">These apply to every figure above.</div>" +
      htmlList(report.interpretation_warnings)));

    var safeguards = report.privacy_safeguards;
    parts.push(section("Privacy safeguards", htmlTable(["Safeguard", "Value"], [
      ["Runs entirely on this machine", safeguards.local_only],
      ["Network requests made", safeguards.network_requests_made],
      ["Network APIs disabled", safeguards.network_apis_disabled.join(", ")],
      ["Browser storage used", safeguards.browser_storage_used],
      ["External libraries used", safeguards.external_libraries_used],
      ["Small-group suppression threshold", safeguards.small_group_suppression.threshold],
      ["Groups withheld", safeguards.small_group_suppression.groups_withheld],
      ["Records withheld", safeguards.small_group_suppression.records_withheld]
    ])));

    return [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "<meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; " +
        "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
      "<title>" + escapeHTML(report.report_type) + "</title>",
      "<style>" + EXPORT_CSS + "</style>",
      "</head>",
      "<body>",
      "<main>",
      "<h1>" + escapeHTML(report.report_type) + "</h1>",
      "<p class=\"sub\">" + escapeHTML(report.application.name + " " +
        report.application.version + " — generated " + report.generated_at) + "</p>",
      "<div class=\"banner\">" + escapeHTML(report.disclosure_scope.note) + "</div>",
      parts.join(""),
      "<footer>" + escapeHTML(
        "Generated locally by " + report.application.name + " " +
        report.application.version + ". This file contains aggregate information " +
        "only and makes no scientific claim.") + "</footer>",
      "</main>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  PBA.report = {
    PROJECT_FIELDS: PROJECT_FIELDS,
    LIMITATIONS: LIMITATIONS,
    INTERPRETATION_WARNINGS: INTERPRETATION_WARNINGS,
    VALIDATION_RULES: VALIDATION_RULES,
    NOT_STATED: NOT_STATED,
    emptyProject: emptyProject,
    describeProject: describeProject,
    disclosureSafeStats: describeStats,
    missingness: missingness,
    buildGovernanceReport: buildGovernanceReport,
    reportToJSON: reportToJSON,
    reportToHTML: reportToHTML
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.report;
})(typeof globalThis !== "undefined" ? globalThis : this);
