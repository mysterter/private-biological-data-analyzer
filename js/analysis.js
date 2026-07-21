/*
 * analysis.js — column profiling, the analysis plan, and its execution.
 *
 * An "analysis plan" is the user's explicit statement of what to compute:
 * which columns to group by, which variable is the outcome, which variables
 * are predictors, and whether to work on a log scale. Nothing is chosen
 * silently, and the plan is echoed back with the results so that any figure
 * can be traced to the choices that produced it.
 *
 * Rows are never deleted. A row that cannot enter the regression (a missing or
 * non-numeric value) is counted and explained, and it stays in the dataset,
 * the flag report and the group summaries.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  /* Derived variables are addressed with a "@" prefix so that they can never
     collide with a real column called "gsi" or "hsi". */
  var DERIVED = {
    "@gsi": { label: "GSI (% of somatic mass)", get: function (r) { return r.derived.gsi; } },
    "@hsi": { label: "HSI (% of somatic mass)", get: function (r) { return r.derived.hsi; } }
  };

  function isDerived(name) {
    return Object.prototype.hasOwnProperty.call(DERIVED, name);
  }

  function variableLabel(name) {
    return isDerived(name) ? DERIVED[name].label : name;
  }

  /** Numeric value of a plan variable for one record. */
  function variableValue(record, name) {
    if (isDerived(name)) return DERIVED[name].get(record);
    var raw = record.data && name in record.data ? record.data[name] : "";
    return PBA.stats.toNumber(raw);
  }

  function columnValues(records, name) {
    return records.map(function (record) { return variableValue(record, name); });
  }

  /**
   * Describe every column so the plan screen can offer sensible choices:
   * which columns look numeric, and how many distinct values they take.
   */
  function profileColumns(headers, records) {
    return headers.map(function (header) {
      var numeric = 0;
      var blank = 0;
      var nonpositive = 0;
      var distinct = new Set();

      records.forEach(function (record) {
        var raw = record.data && header in record.data ? String(record.data[header]).trim() : "";
        if (raw === "") { blank += 1; return; }
        if (distinct.size <= 50) distinct.add(raw);
        var value = PBA.stats.toNumber(raw);
        if (Number.isFinite(value)) {
          numeric += 1;
          if (value <= 0) nonpositive += 1;
        }
      });

      var filled = records.length - blank;
      return {
        name: header,
        filled: filled,
        blank: blank,
        numericCount: numeric,
        nonpositiveCount: nonpositive,
        distinctCount: distinct.size,
        /* "Numeric" needs a clear majority of readable numbers, so an ID
           column with a few numeric-looking codes is not offered as an outcome. */
        isNumeric: filled > 0 && numeric / filled >= 0.8,
        allPositive: filled > 0 && numeric > 0 && nonpositive === 0
      };
    });
  }

  /** Variables that can be used as an outcome or a predictor. */
  function modelVariables(profiles, records) {
    var list = profiles.filter(function (p) { return p.isNumeric; })
                       .map(function (p) {
      return { name: p.name, label: p.name, allPositive: p.allPositive, derived: false };
    });

    Object.keys(DERIVED).forEach(function (key) {
      var values = columnValues(records, key).filter(Number.isFinite);
      if (!values.length) return;
      list.push({
        name: key,
        label: DERIVED[key].label,
        allPositive: values.every(function (v) { return v > 0; }),
        derived: true
      });
    });

    return list;
  }

  /**
   * The plan the tool starts from: the log-log length/body-mass relationship
   * that the previous version of this tool computed, grouped by whatever
   * categorical fields were mapped. The user can change all of it.
   */
  function defaultPlan(mapping, profiles, records) {
    var available = modelVariables(profiles, records).map(function (v) { return v.name; });
    var groupFields = ["site", "sex", "invasion_stage"]
      .map(function (key) { return mapping[key]; })
      .filter(function (name) { return name && profiles.some(function (p) { return p.name === name; }); });

    var outcome = available.indexOf(mapping.body_mass) >= 0 ? mapping.body_mass : (available[0] || "");
    var predictors = available.indexOf(mapping.length) >= 0 && mapping.length !== outcome
      ? [mapping.length]
      : [];

    return {
      groupFields: groupFields,
      outcome: outcome,
      predictors: predictors,
      logTransform: true
    };
  }

  function validatePlan(plan) {
    var problems = [];
    if (!plan.outcome) problems.push("Choose an outcome variable.");
    if (!plan.predictors.length) problems.push("Choose at least one predictor variable.");
    if (plan.predictors.indexOf(plan.outcome) >= 0) {
      problems.push("The outcome cannot also be a predictor.");
    }
    var seen = new Set();
    plan.predictors.forEach(function (name) {
      if (seen.has(name)) problems.push("Predictor \"" + variableLabel(name) + "\" is listed twice.");
      seen.add(name);
    });
    return problems;
  }

  /**
   * Decide, per variable, whether a log transform can be applied.
   * A variable with any zero or negative value is left on its original scale
   * and the reason is reported, rather than dropping those rows.
   */
  function planTransforms(records, variables, useLog) {
    return variables.map(function (name) {
      var values = columnValues(records, name).filter(Number.isFinite);
      var nonpositive = values.filter(function (v) { return v <= 0; }).length;

      if (!useLog) {
        return { name: name, log: false, reason: "Log transform was not requested." };
      }
      if (!values.length) {
        return { name: name, log: false, reason: "No numeric values are available." };
      }
      if (nonpositive > 0) {
        return {
          name: name,
          log: false,
          reason: nonpositive + " value(s) are zero or negative, so the logarithm " +
                  "is undefined. This variable was kept on its original scale and " +
                  "no rows were dropped."
        };
      }
      return { name: name, log: true, reason: "All values are positive." };
    });
  }

  function applyTransform(value, transform) {
    if (!transform.log) return value;
    return Number.isFinite(value) && value > 0 ? Math.log(value) : NaN;
  }

  function groupKeyFor(record, groupFields) {
    if (!groupFields.length) return "All records";
    return groupFields.map(function (field) {
      var raw = record.data && field in record.data ? String(record.data[field]).trim() : "";
      return raw === "" ? "(missing)" : raw;
    }).join(" | ");
  }

  function describe(values) {
    var stats = PBA.stats;
    var finite = values.filter(Number.isFinite);
    return {
      n: finite.length,
      mean: stats.mean(finite),
      sd: stats.sd(finite),
      median: stats.median(finite),
      min: stats.min(finite),
      max: stats.max(finite)
    };
  }

  /** Summaries per group, always on the original (untransformed) scale. */
  function summarizeGroups(records, plan) {
    var variables = [plan.outcome].concat(plan.predictors).filter(Boolean);
    ["@gsi", "@hsi"].forEach(function (key) {
      if (variables.indexOf(key) < 0 &&
          columnValues(records, key).some(Number.isFinite)) {
        variables.push(key);
      }
    });

    var groups = new Map();
    records.forEach(function (record) {
      var key = groupKeyFor(record, plan.groupFields);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });

    var summaries = Array.from(groups.entries()).map(function (entry) {
      var label = entry[0];
      var members = entry[1];
      var stats = {};
      variables.forEach(function (name) {
        stats[name] = describe(members.map(function (r) { return variableValue(r, name); }));
      });
      return {
        group: label,
        n: members.length,
        flaggedRows: members.filter(function (r) { return r.flags.length > 0; }).length,
        stats: stats
      };
    });

    summaries.sort(function (a, b) { return a.group.localeCompare(b.group); });
    return { variables: variables, summaries: summaries };
  }

  /**
   * Run a plan against the records.
   * Returns the fitted model, the group summaries, the transform decisions and
   * a full account of which rows could not be used and why.
   */
  function runAnalysis(records, plan) {
    var problems = validatePlan(plan);
    if (problems.length) return { ok: false, problems: problems };

    var modelVars = [plan.outcome].concat(plan.predictors);
    var transforms = planTransforms(records, modelVars, plan.logTransform);
    var transformByName = new Map();
    transforms.forEach(function (t) { transformByName.set(t.name, t); });

    var unusableByVariable = new Map();
    modelVars.forEach(function (name) { unusableByVariable.set(name, 0); });

    var usable = [];
    records.forEach(function (record) {
      var rowValues = {};
      var ok = true;
      modelVars.forEach(function (name) {
        var value = applyTransform(variableValue(record, name), transformByName.get(name));
        rowValues[name] = value;
        if (!Number.isFinite(value)) {
          unusableByVariable.set(name, unusableByVariable.get(name) + 1);
          ok = false;
        }
      });
      if (ok) usable.push({ record: record, values: rowValues });
    });

    var y = usable.map(function (u) { return u.values[plan.outcome]; });
    var X = usable.map(function (u) {
      return plan.predictors.map(function (name) { return u.values[name]; });
    });

    var predictorLabels = plan.predictors.map(function (name) {
      var t = transformByName.get(name);
      return (t && t.log ? "log(" + variableLabel(name) + ")" : variableLabel(name));
    });
    var outcomeTransform = transformByName.get(plan.outcome);
    var outcomeLabel = outcomeTransform && outcomeTransform.log
      ? "log(" + variableLabel(plan.outcome) + ")"
      : variableLabel(plan.outcome);

    var model = PBA.stats.multipleOLS(y, X, predictorLabels);

    /* With a single predictor the closed-form simple regression is also
       computed: it drives the fitted line on the scatter plot, and the tests
       check that the two implementations agree. */
    var simple = null;
    if (plan.predictors.length === 1) {
      simple = PBA.stats.simpleOLS(X.map(function (row) { return row[0]; }), y);
    }

    var excluded = [];
    unusableByVariable.forEach(function (count, name) {
      if (count > 0) {
        excluded.push({
          variable: name,
          label: variableLabel(name),
          rows: count,
          reason: "Value missing, non-numeric" +
                  (transformByName.get(name).log ? ", or not positive on the log scale" : "") + "."
        });
      }
    });

    return {
      ok: true,
      plan: plan,
      transforms: transforms,
      outcomeLabel: outcomeLabel,
      predictorLabels: predictorLabels,
      rowsTotal: records.length,
      rowsUsed: usable.length,
      rowsExcluded: records.length - usable.length,
      excludedByVariable: excluded,
      model: model,
      simple: simple,
      points: usable.map(function (u) {
        return {
          x: plan.predictors.length === 1 ? u.values[plan.predictors[0]] : NaN,
          y: u.values[plan.outcome]
        };
      }),
      groups: summarizeGroups(records, plan)
    };
  }

  PBA.analysis = {
    DERIVED: DERIVED,
    isDerived: isDerived,
    variableLabel: variableLabel,
    variableValue: variableValue,
    columnValues: columnValues,
    profileColumns: profileColumns,
    modelVariables: modelVariables,
    defaultPlan: defaultPlan,
    validatePlan: validatePlan,
    planTransforms: planTransforms,
    groupKeyFor: groupKeyFor,
    describe: describe,
    summarizeGroups: summarizeGroups,
    runAnalysis: runAnalysis
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.analysis;
})(typeof globalThis !== "undefined" ? globalThis : this);
