/*
 * ui.js — everything that touches the DOM.
 *
 * The other modules are pure functions over data and are exercised directly by
 * the test suite; this file is the only one that knows about elements, events
 * and drawing. Tables are assembled with createElement/textContent rather than
 * innerHTML, so a value inside a CSV can never be interpreted as markup.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});
  var doc = root.document;
  if (!doc) return; /* Loaded in a non-browser environment (the Node tests). */

  var csv = PBA.csv;
  var stats = PBA.stats;
  var validate = PBA.validate;
  var analysis = PBA.analysis;
  var report = PBA.report;

  var state = {
    /* Held only to show the user what they opened. It is deliberately never
       passed to the report builder, so it cannot reach an exported file. */
    fileName: "",
    parsed: null,
    records: [],
    profiles: [],
    mapping: {},
    plan: null,
    result: null,
    report: null
  };

  /* ---------------------------------------------------------------- helpers */

  function $(id) { return doc.getElementById(id); }

  function el(tag, options, children) {
    var node = doc.createElement(tag);
    var opts = options || {};
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.className) node.className = opts.className;
    if (opts.id) node.id = opts.id;
    if (opts.type) node.type = opts.type;
    if (opts.value !== undefined) node.value = opts.value;
    if (opts.checked) node.checked = true;
    if (opts.htmlFor) node.htmlFor = opts.htmlFor;
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  /** Build a table from a header list and rows of cell descriptors. */
  function buildTable(target, headers, rows, emptyMessage) {
    clear(target);
    var thead = el("thead");
    var headRow = el("tr");
    headers.forEach(function (h) {
      var name = typeof h === "string" ? h : h.text;
      var numeric = typeof h === "object" && h.numeric;
      headRow.appendChild(el("th", { text: name, className: numeric ? "numeric" : "" }));
    });
    thead.appendChild(headRow);
    target.appendChild(thead);

    var tbody = el("tbody");
    if (!rows.length) {
      var emptyRow = el("tr");
      var cell = el("td", { text: emptyMessage || "Nothing to report." });
      cell.colSpan = headers.length;
      emptyRow.appendChild(cell);
      tbody.appendChild(emptyRow);
    } else {
      rows.forEach(function (row) {
        var tr = el("tr");
        row.forEach(function (value, index) {
          var numeric = typeof headers[index] === "object" && headers[index].numeric;
          tr.appendChild(el("td", {
            text: value === null || value === undefined ? "" : String(value),
            className: numeric ? "numeric" : ""
          }));
        });
        tbody.appendChild(tr);
      });
    }
    target.appendChild(tbody);
  }

  function setStatus(id, message, kind) {
    var node = $(id);
    node.textContent = message;
    node.className = "status small" + (kind ? " " + kind : "");
  }

  function readFileText(file) {
    if (typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new root.FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error || new Error("The file could not be read.")); };
      reader.readAsText(file);
    });
  }

  /* --------------------------------------------------------- privacy notice */

  function renderPrivacyStatus() {
    var disabled = PBA.privacy.disabledApis;
    $("privacyStatus").textContent = disabled.length
      ? "Network APIs disabled in this tab: " + disabled.join(", ") + "."
      : "No network APIs were available to disable in this browser.";
  }

  /* ------------------------------------------------------- step 1: the file */

  function onFileSelected(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;

    readFileText(file).then(function (text) {
      var parsed = csv.parseCSV(text);
      state.fileName = file.name;
      state.parsed = parsed;
      state.mapping = validate.guessMapping(parsed.headers);
      state.plan = null;
      state.result = null;

      setStatus("fileStatus",
        "Loaded " + file.name + ": " + parsed.rows.length + " data rows and " +
        parsed.headers.length + " columns. Nothing was uploaded.", "good");

      renderParseWarnings(parsed);
      renderMapping();
      show("stepMapping");
      hide("stepPlan");
      hide("stepResults");
    }).catch(function (err) {
      setStatus("fileStatus", "Could not read the CSV: " + err.message, "bad");
      hide("stepMapping");
      hide("stepPlan");
      hide("stepResults");
    });
  }

  function renderParseWarnings(parsed) {
    var target = clear($("parseWarnings"));
    if (parsed.blankRowsSkipped) {
      target.appendChild(el("div", {
        className: "note",
        text: parsed.blankRowsSkipped + " completely empty line(s) were skipped."
      }));
    }
    if (!parsed.warnings.length) return;

    var box = el("div", { className: "note caution" });
    box.appendChild(el("strong", { text: "File structure warnings (" + parsed.warnings.length + ")" }));
    var list = el("ul", { className: "plain" });
    parsed.warnings.slice(0, 25).forEach(function (warning) {
      list.appendChild(el("li", { text: warning.message }));
    });
    if (parsed.warnings.length > 25) {
      list.appendChild(el("li", { text: "… and " + (parsed.warnings.length - 25) + " more." }));
    }
    box.appendChild(list);
    target.appendChild(box);
  }

  /* --------------------------------------------------- step 2: the mapping */

  function renderMapping() {
    var grid = clear($("mappingGrid"));

    validate.FIELDS.forEach(function (field) {
      var wrap = el("label", { text: field.label + (field.required ? " *" : "") });
      var select = el("select", { id: "map_" + field.key });
      select.appendChild(el("option", { value: "", text: "— Not mapped —" }));
      state.parsed.headers.forEach(function (header) {
        select.appendChild(el("option", { value: header, text: header }));
      });
      select.value = state.mapping[field.key] || "";
      wrap.appendChild(select);
      grid.appendChild(wrap);
    });
  }

  function readMapping() {
    var mapping = {};
    validate.FIELDS.forEach(function (field) {
      mapping[field.key] = $("map_" + field.key).value;
    });
    return mapping;
  }

  function onContinueToPlan() {
    var mapping = readMapping();
    var missing = validate.REQUIRED.filter(function (key) { return !mapping[key]; });
    if (missing.length) {
      setStatus("mappingStatus",
        "Map the required fields before continuing: " +
        missing.map(function (k) { return validate.fieldByKey(k).label; }).join(", ") + ".", "bad");
      return;
    }

    var duplicates = new Map();
    Object.keys(mapping).forEach(function (key) {
      if (!mapping[key]) return;
      duplicates.set(mapping[key], (duplicates.get(mapping[key]) || 0) + 1);
    });
    var reused = Array.from(duplicates.entries())
      .filter(function (entry) { return entry[1] > 1; })
      .map(function (entry) { return entry[0]; });

    state.mapping = mapping;
    state.records = validate.flagRecords(
      validate.buildRecords(state.parsed.rows, mapping), mapping);
    state.profiles = analysis.profileColumns(state.parsed.headers, state.records);
    state.plan = analysis.defaultPlan(mapping, state.profiles, state.records);

    setStatus("mappingStatus", reused.length
      ? "Note: column(s) " + reused.join(", ") + " are mapped to more than one field."
      : "", reused.length ? "warn" : "");

    renderPlan();
    show("stepPlan");
    hide("stepResults");
    $("stepPlan").scrollIntoView({ behavior: "smooth" });
  }

  /* --------------------------------------------- step 3: the analysis plan */

  function renderPlan() {
    var variables = analysis.modelVariables(state.profiles, state.records);

    /* Grouping fields: any column, with a hint about how many levels it has. */
    var groupBox = clear($("planGroups"));
    /* Ids are built from the position, not the column name: a header such as
       "site note" would otherwise produce an id containing a space. */
    state.profiles.forEach(function (profile, index) {
      var id = "group_" + index;
      var label = el("label", { className: "inline-check", htmlFor: id });
      var box = el("input", { type: "checkbox", id: id, value: profile.name });
      box.checked = state.plan.groupFields.indexOf(profile.name) >= 0;
      label.appendChild(box);
      label.appendChild(doc.createTextNode(profile.name + " "));
      label.appendChild(el("span", {
        className: "muted",
        text: "(" + profile.distinctCount + (profile.distinctCount > 50 ? "+" : "") + " distinct)"
      }));
      groupBox.appendChild(label);
    });
    if (!state.profiles.length) {
      groupBox.appendChild(el("div", { className: "small", text: "No columns available." }));
    }

    /* Outcome: one numeric variable. */
    var outcome = clear($("planOutcome"));
    variables.forEach(function (variable) {
      outcome.appendChild(el("option", { value: variable.name, text: variable.label }));
    });
    if (!variables.length) {
      outcome.appendChild(el("option", { value: "", text: "No numeric variables found" }));
    }
    outcome.value = state.plan.outcome || (variables[0] ? variables[0].name : "");

    /* Predictors: any number of numeric variables. */
    var predictorBox = clear($("planPredictors"));
    variables.forEach(function (variable, index) {
      var id = "pred_" + index;
      var label = el("label", { className: "inline-check", htmlFor: id });
      var box = el("input", { type: "checkbox", id: id, value: variable.name });
      box.checked = state.plan.predictors.indexOf(variable.name) >= 0;
      label.appendChild(box);
      label.appendChild(doc.createTextNode(variable.label + " "));
      if (!variable.allPositive) {
        label.appendChild(el("span", { className: "muted", text: "(has non-positive values)" }));
      }
      predictorBox.appendChild(label);
    });
    if (!variables.length) {
      predictorBox.appendChild(el("div", {
        className: "small",
        text: "No numeric variables were detected in this file."
      }));
    }

    $("planLog").checked = state.plan.logTransform;
    setStatus("planStatus", "", "");
  }

  function readPlan() {
    function checkedValues(containerId) {
      var boxes = $(containerId).querySelectorAll("input[type=checkbox]");
      return Array.prototype.slice.call(boxes)
        .filter(function (box) { return box.checked; })
        .map(function (box) { return box.value; });
    }
    return {
      groupFields: checkedValues("planGroups"),
      outcome: $("planOutcome").value,
      predictors: checkedValues("planPredictors"),
      logTransform: $("planLog").checked
    };
  }

  function onRun() {
    var plan = readPlan();
    var problems = analysis.validatePlan(plan);
    if (problems.length) {
      setStatus("planStatus", problems.join(" "), "bad");
      return;
    }
    state.plan = plan;
    state.result = analysis.runAnalysis(state.records, plan);
    setStatus("planStatus", "", "");
    renderResults();
    show("stepResults");
    /* Any previous report described a different plan, so it is discarded
       rather than left downloadable next to fresh results. */
    invalidateReport();
    show("stepProject");
    show("stepReport");
    $("stepResults").scrollIntoView({ behavior: "smooth" });
  }

  /* ------------------------------------------------------ step 4: results */

  function renderResults() {
    var result = state.result;
    var records = state.records;
    var coverage = validate.indexCoverage(records);

    var metrics = clear($("metrics"));
    [
      ["Rows loaded", records.length],
      ["Unique specimen IDs", uniqueIdCount(records)],
      ["Rows with flags", records.filter(function (r) { return r.flags.length; }).length],
      ["Rows used by the model", result.rowsUsed],
      ["Rows the model could not use", result.rowsExcluded]
    ].forEach(function (entry) {
      var box = el("div", { className: "metric", text: entry[0] });
      box.appendChild(el("b", { text: String(entry[1]) }));
      metrics.appendChild(box);
    });

    renderPlanEcho(result, coverage);
    renderValidation(records);
    renderFlaggedRows(records);
    renderModel(result);
    renderGroups(result);
    drawPlot(result);
  }

  function uniqueIdCount(records) {
    var ids = new Set();
    records.forEach(function (record) {
      var id = String(record.values.specimen_id).trim();
      if (id !== "") ids.add(id);
    });
    return ids.size;
  }

  function renderPlanEcho(result, coverage) {
    var target = clear($("planEcho"));
    var plan = result.plan;

    var box = el("div", { className: "note" });
    box.appendChild(el("strong", { text: "Plan used for these results" }));
    var list = el("ul", { className: "plain" });
    list.appendChild(el("li", {
      text: "Grouping fields: " + (plan.groupFields.length ? plan.groupFields.join(", ") : "none (all records together)")
    }));
    list.appendChild(el("li", { text: "Outcome: " + result.outcomeLabel }));
    list.appendChild(el("li", { text: "Predictors: " + result.predictorLabels.join(", ") }));
    list.appendChild(el("li", {
      text: "Log transform requested: " + (plan.logTransform ? "yes" : "no")
    }));
    list.appendChild(el("li", {
      text: "GSI computed for " + coverage.gsi + " of " + coverage.total + " rows, " +
            "HSI for " + coverage.hsi + " of " + coverage.total +
            " (both as a percentage of somatic mass)."
    }));
    box.appendChild(list);
    target.appendChild(box);

    var notable = result.transforms.filter(function (t) { return !t.log; });
    if (plan.logTransform && notable.length) {
      var caution = el("div", { className: "note caution" });
      caution.appendChild(el("strong", { text: "Variables left on their original scale" }));
      var reasons = el("ul", { className: "plain" });
      notable.forEach(function (t) {
        reasons.appendChild(el("li", {
          text: analysis.variableLabel(t.name) + ": " + t.reason
        }));
      });
      caution.appendChild(reasons);
      target.appendChild(caution);
    }

    if (result.excludedByVariable.length) {
      var excluded = el("div", { className: "note caution" });
      excluded.appendChild(el("strong", {
        text: "Rows the model could not use (" + result.rowsExcluded + " of " + result.rowsTotal + ")"
      }));
      var why = el("ul", { className: "plain" });
      result.excludedByVariable.forEach(function (entry) {
        why.appendChild(el("li", {
          text: entry.label + ": " + entry.rows + " row(s). " + entry.reason
        }));
      });
      why.appendChild(el("li", {
        text: "These rows remain in the dataset, the flag report and the grouped summaries."
      }));
      excluded.appendChild(why);
      target.appendChild(excluded);
    }
  }

  function renderValidation(records) {
    var summary = validate.summarizeFlags(records);
    buildTable($("validationTable"),
      ["Check", "Severity", { text: "Rows affected", numeric: true }],
      summary.map(function (entry) { return [entry.label, entry.severity, entry.rows]; }),
      "No validation flags were raised.");
  }

  function renderFlaggedRows(records) {
    var flagged = records.filter(function (record) { return record.flags.length; });
    buildTable($("flaggedTable"),
      [{ text: "Source line", numeric: true }, "Specimen ID", "Flags"],
      flagged.slice(0, 500).map(function (record) {
        return [
          record.sourceRow,
          record.values.specimen_id,
          record.flags.map(function (f) { return f.message; }).join(" ")
        ];
      }),
      "No row was flagged.");
  }

  function renderModel(result) {
    var target = clear($("modelText"));
    var model = result.model;

    if (!model.ok) {
      target.appendChild(el("div", { className: "note caution", text: "No model was fitted: " + model.reason }));
      buildTable($("modelTable"), ["Term"], [], "No coefficients to show.");
      return;
    }

    var equation = el("p");
    equation.appendChild(el("strong", { text: "Fitted by ordinary least squares: " }));
    equation.appendChild(doc.createTextNode(
      result.outcomeLabel + " ~ " + result.predictorLabels.join(" + ") +
      " (n = " + model.n + ", R² = " + stats.fmt(model.r2) +
      ", adjusted R² = " + stats.fmt(model.adjustedR2) +
      ", residual SD = " + stats.fmt(model.residualSD) + ")"));
    target.appendChild(equation);

    var caveat = el("div", { className: "note caution" });
    caveat.appendChild(el("strong", { text: "How to read this" }));
    caveat.appendChild(el("p", {
      className: "small",
      text: "These are descriptive least-squares estimates for the plan you " +
            "specified. No p-values are reported, because this tool does not " +
            "check the assumptions that would make them meaningful. Nothing " +
            "here establishes a biological effect: repeated measurements, " +
            "site-level replication, sex, stage, date, non-linearity and " +
            "residual diagnostics are not accounted for."
    }));
    target.appendChild(caveat);

    buildTable($("modelTable"),
      ["Term",
       { text: "Estimate", numeric: true },
       { text: "Standard error", numeric: true },
       { text: "t", numeric: true }],
      model.names.map(function (name, index) {
        return [
          name,
          stats.fmt(model.coefficients[index], 4),
          stats.fmt(model.standardErrors[index], 4),
          stats.fmt(model.tStatistics[index], 2)
        ];
      }),
      "No coefficients to show.");
  }

  function renderGroups(result) {
    /* Suppression is applied to the screen as well as to the exports: a
       screenshot of a small group discloses just as much as a file. */
    var groups = analysis.suppressSmallGroups(result.groups);
    var headers = ["Group", { text: "n", numeric: true }, { text: "Flagged rows", numeric: true }];
    groups.variables.forEach(function (name) {
      headers.push({ text: analysis.variableLabel(name) + " mean", numeric: true });
      headers.push({ text: analysis.variableLabel(name) + " SD", numeric: true });
      headers.push({ text: analysis.variableLabel(name) + " n", numeric: true });
    });

    var rows = groups.summaries.map(function (summary) {
      var row = [summary.group, summary.n, summary.flaggedRows];
      groups.variables.forEach(function (name) {
        var describe = summary.stats[name];
        row.push(stats.fmt(describe.mean));
        row.push(stats.fmt(describe.sd));
        row.push(describe.n);
      });
      return row;
    });

    buildTable($("groupTable"), headers, rows,
      groups.suppressedGroupCount
        ? "Every group was withheld: none reached " + groups.threshold + " records."
        : "No groups to summarise.");

    var notice = clear($("groupNotice"));
    if (groups.suppressedGroupCount) {
      notice.appendChild(el("div", {
        className: "note caution",
        text: groups.suppressedGroupCount + " group(s) covering " +
              groups.suppressedRecordCount + " record(s) are not shown. " + groups.note
      }));
    }
  }

  /* ------------------------------------------- step 5: project information */

  /* The form is generated from report.PROJECT_FIELDS so that the questions
     asked and the questions recorded can never drift apart. */
  function renderProjectForm() {
    var target = clear($("projectForm"));

    report.PROJECT_FIELDS.forEach(function (field) {
      var wrap = el("label", { htmlFor: "project_" + field.key });
      wrap.appendChild(doc.createTextNode(field.label + " "));
      wrap.appendChild(el("span", { className: "field-hint", text: field.hint }));

      var input;
      if (field.type === "select") {
        input = el("select", { id: "project_" + field.key });
        field.options.forEach(function (option) {
          input.appendChild(el("option", { value: option, text: option }));
        });
      } else if (field.type === "textarea") {
        input = el("textarea", { id: "project_" + field.key });
      } else {
        input = el("input", { type: "text", id: "project_" + field.key });
      }
      wrap.appendChild(input);
      target.appendChild(wrap);
    });
  }

  function readProjectInfo() {
    var project = {};
    report.PROJECT_FIELDS.forEach(function (field) {
      var node = $("project_" + field.key);
      project[field.key] = node ? node.value : "";
    });
    return project;
  }

  function clearProjectForm() {
    var blank = report.emptyProject();
    report.PROJECT_FIELDS.forEach(function (field) {
      var node = $("project_" + field.key);
      if (node) node.value = blank[field.key];
    });
  }

  /* ------------------------------- step 6: governance and reproducibility */

  function setReportDownloadsEnabled(enabled) {
    $("downloadReportJson").disabled = !enabled;
    $("downloadReportHtml").disabled = !enabled;
  }

  function onGenerateReport() {
    if (!state.result || !state.result.ok) {
      setStatus("reportStatus", "Run an analysis first.", "bad");
      return;
    }

    /* Note what is handed over: parsed structure, mappings, flagged records for
       counting, the plan and the result. The file name is not among them. */
    state.report = report.buildGovernanceReport({
      parsed: state.parsed,
      mapping: state.mapping,
      records: state.records,
      plan: state.plan,
      result: state.result,
      project: readProjectInfo()
    });

    setReportDownloadsEnabled(true);
    setStatus("reportStatus",
      "Report generated at " + state.report.generated_at +
      ". Nothing was uploaded; both downloads are produced in this tab.", "good");

    var preview = clear($("reportPreview"));
    preview.appendChild(el("div", {
      className: "small",
      text: "Preview of the JSON export:"
    }));
    preview.appendChild(el("div", {
      className: "report-preview",
      text: report.reportToJSON(state.report)
    }));
  }

  function invalidateReport() {
    state.report = null;
    setReportDownloadsEnabled(false);
    clear($("reportPreview"));
    setStatus("reportStatus", "", "");
  }

  /* ------------------------------------------------------------- the plot */

  function drawPlot(result) {
    var canvas = $("plot");
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    /* Left/bottom margin large enough for right-aligned tick labels plus the
       rotated axis title beside them. */
    var pad = 76;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#4b5a67";
    ctx.font = "15px system-ui, sans-serif";

    var single = result.plan.predictors.length === 1;
    var model = result.model;

    if (!model.ok) {
      ctx.fillText("No model was fitted, so there is nothing to plot.", pad, 60);
      $("plotCaption").textContent = "";
      return;
    }

    /* One predictor: observed against that predictor, with the fitted line.
       Several predictors: observed against fitted, with the 1:1 line. */
    var points;
    var xLabel;
    var yLabel;
    if (single) {
      points = result.points.map(function (p) { return [p.x, p.y]; });
      xLabel = result.predictorLabels[0];
      yLabel = result.outcomeLabel;
    } else {
      points = model.fitted.map(function (f, index) { return [f, result.points[index].y]; });
      xLabel = "fitted " + result.outcomeLabel;
      yLabel = "observed " + result.outcomeLabel;
    }
    points = points.filter(function (p) {
      return Number.isFinite(p[0]) && Number.isFinite(p[1]);
    });

    if (!points.length) {
      ctx.fillText("No plottable points.", pad, 60);
      $("plotCaption").textContent = "";
      return;
    }

    var xs = points.map(function (p) { return p[0]; });
    var ys = points.map(function (p) { return p[1]; });
    var xmin = Math.min.apply(null, xs);
    var xmax = Math.max.apply(null, xs);
    var ymin = Math.min.apply(null, ys);
    var ymax = Math.max.apply(null, ys);
    var xspan = xmax - xmin || 1;
    var yspan = ymax - ymin || 1;
    xmin -= xspan * 0.05; xmax += xspan * 0.05;
    ymin -= yspan * 0.05; ymax += yspan * 0.05;

    var plotWidth = width - 2 * pad;
    var plotHeight = height - 2 * pad;
    function sx(x) { return pad + (x - xmin) / (xmax - xmin) * plotWidth; }
    function sy(y) { return height - pad - (y - ymin) / (ymax - ymin) * plotHeight; }

    /* Axes with a few labelled ticks. */
    ctx.strokeStyle = "#9aa8b3";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, height - pad);
    ctx.lineTo(width - pad, height - pad);
    ctx.stroke();

    ctx.fillStyle = "#7c8894";
    ctx.font = "12px system-ui, sans-serif";
    for (var t = 0; t <= 4; t++) {
      var xv = xmin + (xmax - xmin) * t / 4;
      var yv = ymin + (ymax - ymin) * t / 4;
      var xText = xv.toFixed(2);
      var yText = yv.toFixed(2);
      ctx.fillText(xText, sx(xv) - ctx.measureText(xText).width / 2, height - pad + 18);
      /* Right-align the y tick labels against the axis so the rotated axis
         title beside them stays legible. */
      ctx.fillText(yText, pad - 8 - ctx.measureText(yText).width, sy(yv) + 4);
      ctx.strokeStyle = "#eef3f7";
      ctx.beginPath();
      ctx.moveTo(pad, sy(yv));
      ctx.lineTo(width - pad, sy(yv));
      ctx.stroke();
    }

    ctx.fillStyle = "#1769aa";
    points.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(sx(p[0]), sy(p[1]), 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.strokeStyle = "#a22828";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (single && result.simple && result.simple.ok) {
      var line = result.simple;
      ctx.moveTo(sx(xmin), sy(line.intercept + line.slope * xmin));
      ctx.lineTo(sx(xmax), sy(line.intercept + line.slope * xmax));
    } else {
      var lo = Math.max(xmin, ymin);
      var hi = Math.min(xmax, ymax);
      ctx.moveTo(sx(lo), sy(lo));
      ctx.lineTo(sx(hi), sy(hi));
    }
    ctx.stroke();

    ctx.fillStyle = "#4b5a67";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(xLabel, width / 2 - ctx.measureText(xLabel).width / 2, height - 18);
    ctx.save();
    ctx.translate(18, height / 2 + ctx.measureText(yLabel).width / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    $("plotCaption").textContent = single
      ? "Each point is one usable row; the line is the fitted least-squares relationship."
      : "With more than one predictor the plot shows observed against fitted values; the line is 1:1.";
  }

  /* ---------------------------------------------------------- the downloads */

  function saveFile(name, text, type) {
    var blob = new root.Blob([text], { type: type || "text/plain" });
    var url = root.URL.createObjectURL(blob);
    var anchor = el("a");
    anchor.href = url;
    anchor.download = name;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    root.URL.revokeObjectURL(url);
  }

  /** The row-level flag report: what a person needs to check each value. */
  function buildFlagReport() {
    var rows = [["source_line", "specimen_id", "severity", "check", "field", "detail"]];
    state.records.forEach(function (record) {
      record.flags.forEach(function (flag) {
        rows.push([
          record.sourceRow,
          record.values.specimen_id,
          flag.severity,
          flag.code,
          flag.field,
          flag.message
        ]);
      });
    });
    return csv.toCSV(rows);
  }

  /** The aggregate summary: counts and group statistics, no row-level data. */
  function buildAggregateSummary() {
    var result = state.result;
    var coverage = validate.indexCoverage(state.records);
    var suppressed = analysis.suppressSmallGroups(result.groups);

    return JSON.stringify({
      tool: PBA.meta.name,
      application_version: PBA.meta.version,
      generated: new Date().toISOString(),
      note: "Aggregate output only. Descriptive statistics and least-squares " +
            "estimates for the stated plan; no inferential claim is made. " +
            "The source file name is deliberately omitted.",
      rows_loaded: state.records.length,
      rows_with_flags: state.records.filter(function (r) { return r.flags.length; }).length,
      rows_with_errors: validate.countRowsWithSeverity(state.records, "error"),
      rows_with_warnings: validate.countRowsWithSeverity(state.records, "warning"),
      column_mapping: state.mapping,
      index_definition: "GSI = 100 x gonad mass / somatic mass; HSI = 100 x liver mass / somatic mass",
      index_coverage: coverage,
      parse_warnings: state.parsed.warnings.map(function (w) { return w.message; }),
      validation_summary: validate.summarizeFlags(state.records).map(function (entry) {
        return { check: entry.label, severity: entry.severity, rows: entry.rows };
      }),
      analysis_plan: result.plan,
      transforms: result.transforms,
      rows_used_by_model: result.rowsUsed,
      rows_excluded_from_model: result.rowsExcluded,
      excluded_by_variable: result.excludedByVariable,
      model: result.model.ok ? {
        outcome: result.outcomeLabel,
        terms: result.model.names,
        estimates: result.model.coefficients,
        standard_errors: result.model.standardErrors,
        t_statistics: result.model.tStatistics,
        n: result.model.n,
        r_squared: result.model.r2,
        adjusted_r_squared: result.model.adjustedR2,
        residual_sd: result.model.residualSD
      } : { fitted: false, reason: result.model.reason },
      /* Projected through the same disclosure-safe filter as the governance
         report: a group minimum or maximum is one specimen's raw measurement. */
      group_summary: suppressed.summaries.map(function (summary) {
        var safe = {};
        suppressed.variables.forEach(function (name) {
          safe[analysis.variableLabel(name)] = report.disclosureSafeStats(summary.stats[name]);
        });
        return {
          group: summary.group,
          n: summary.n,
          rows_with_flags: summary.flaggedRows,
          statistics: safe
        };
      }),
      group_suppression: {
        threshold: suppressed.threshold,
        groups_withheld: suppressed.suppressedGroupCount,
        records_withheld: suppressed.suppressedRecordCount,
        note: suppressed.note
      }
    }, null, 2);
  }

  /* -------------------------------------------------------------- start-up */

  function init() {
    renderPrivacyStatus();
    renderProjectForm();

    $("fileInput").addEventListener("change", onFileSelected);
    $("toPlanBtn").addEventListener("click", onContinueToPlan);
    $("runBtn").addEventListener("click", onRun);
    $("clearBtn").addEventListener("click", function () { root.location.reload(); });
    $("backToMappingBtn").addEventListener("click", function () {
      $("stepMapping").scrollIntoView({ behavior: "smooth" });
    });
    $("backToPlanBtn").addEventListener("click", function () {
      $("stepPlan").scrollIntoView({ behavior: "smooth" });
    });

    $("downloadValidation").addEventListener("click", function () {
      if (!state.records.length) return;
      saveFile("flagged_rows_local_review.csv", buildFlagReport(), "text/csv");
    });
    $("downloadSummary").addEventListener("click", function () {
      if (!state.result) return;
      saveFile("aggregate_analysis_summary.json", buildAggregateSummary(), "application/json");
    });

    $("clearProjectBtn").addEventListener("click", clearProjectForm);
    $("generateReportBtn").addEventListener("click", onGenerateReport);

    $("downloadReportJson").addEventListener("click", function () {
      if (!state.report) return;
      saveFile("governance_reproducibility_report.json",
        report.reportToJSON(state.report), "application/json");
    });
    $("downloadReportHtml").addEventListener("click", function () {
      if (!state.report) return;
      saveFile("governance_reproducibility_report.html",
        report.reportToHTML(state.report), "text/html");
    });
  }

  /* Exposed so the browser test page can drive the same code path the user does. */
  PBA.ui = {
    state: state,
    buildFlagReport: buildFlagReport,
    buildAggregateSummary: buildAggregateSummary,
    readProjectInfo: readProjectInfo,
    generateReport: onGenerateReport
  };

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
