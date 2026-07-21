/*
 * validate.js — record construction, quality flags, and the GSI / HSI indices.
 *
 * Design rule: this module never removes, corrects or overwrites a value. It
 * only attaches flags describing what looks questionable, so the person who
 * collected the data can decide what to do. Severity "error" means the value
 * cannot be used in a calculation (it is missing, non-numeric, or would make a
 * logarithm undefined); "warning" means the value is usable arithmetically but
 * deserves a look.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  /* The canonical fields the tool understands, and the header names it will
     try to match automatically when a file is loaded. */
  var FIELDS = [
    { key: "specimen_id", label: "Specimen ID", required: true, kind: "identifier",
      guesses: ["specimen_id", "fish_id", "id", "sample_id"] },
    { key: "length", label: "Length", required: true, kind: "measurement",
      guesses: ["total_length_mm", "length", "total_length", "standard_length"] },
    { key: "body_mass", label: "Body mass", required: true, kind: "measurement",
      guesses: ["body_mass_g", "body_mass", "weight_g", "mass"] },
    { key: "somatic_mass", label: "Somatic mass", required: false, kind: "measurement",
      guesses: ["somatic_mass_g", "somatic_mass"] },
    { key: "gonad_mass", label: "Gonad mass", required: false, kind: "measurement",
      guesses: ["gonad_mass_g", "gonad_mass"] },
    { key: "liver_mass", label: "Liver mass", required: false, kind: "measurement",
      guesses: ["liver_mass_g", "liver_mass"] },
    { key: "sex", label: "Sex", required: false, kind: "category",
      guesses: ["sex", "gender"] },
    { key: "site", label: "Site", required: false, kind: "category",
      guesses: ["site", "location", "sampling_site"] },
    { key: "invasion_stage", label: "Invasion stage", required: false, kind: "category",
      guesses: ["invasion_stage", "stage", "population_stage"] },
    { key: "collection_date", label: "Collection date", required: false, kind: "date",
      guesses: ["collection_date", "date", "sampling_date"] }
  ];

  var MEASUREMENTS = ["length", "body_mass", "somatic_mass", "gonad_mass", "liver_mass"];
  var ORGANS = ["somatic_mass", "gonad_mass", "liver_mass"];
  var REQUIRED = FIELDS.filter(function (f) { return f.required; })
                       .map(function (f) { return f.key; });

  function fieldByKey(key) {
    return FIELDS.filter(function (f) { return f.key === key; })[0] || null;
  }

  function labelFor(key) {
    var field = fieldByKey(key);
    return field ? field.label.toLowerCase() : key;
  }

  /** Suggest a mapping from canonical field -> CSV header, by header name. */
  function guessMapping(headers) {
    var lower = headers.map(function (h) { return String(h).trim().toLowerCase(); });
    var mapping = {};
    FIELDS.forEach(function (field) {
      mapping[field.key] = "";
      for (var i = 0; i < field.guesses.length; i++) {
        var index = lower.indexOf(field.guesses[i]);
        if (index >= 0) { mapping[field.key] = headers[index]; return; }
      }
    });
    return mapping;
  }

  /**
   * Build one record per data row.
   * `rows` are the objects returned by csv.parseCSV; `mapping` maps a
   * canonical field key to a CSV header name ("" when not mapped).
   */
  function buildRecords(rows, mapping) {
    var toNumber = PBA.stats.toNumber;

    return rows.map(function (row) {
      var values = {};
      var numbers = {};

      FIELDS.forEach(function (field) {
        var header = mapping[field.key];
        var raw = header && header in row.data ? row.data[header] : "";
        values[field.key] = raw === undefined || raw === null ? "" : String(raw);
      });

      MEASUREMENTS.forEach(function (key) {
        numbers[key] = toNumber(values[key]);
      });

      /* GSI and HSI are expressed as a percentage of somatic mass. That
         denominator is a convention: it is stated here, in the interface and
         in the report so it is never ambiguous which one was used. */
      var somatic = numbers.somatic_mass;
      var derived = { gsi: NaN, hsi: NaN };
      if (Number.isFinite(somatic) && somatic > 0) {
        if (Number.isFinite(numbers.gonad_mass)) derived.gsi = 100 * numbers.gonad_mass / somatic;
        if (Number.isFinite(numbers.liver_mass)) derived.hsi = 100 * numbers.liver_mass / somatic;
      }

      return {
        sourceRow: row.sourceRow,
        data: row.data,
        values: values,
        numbers: numbers,
        derived: derived,
        flags: []
      };
    });
  }

  function addFlag(record, code, field, severity, message) {
    record.flags.push({ code: code, field: field, severity: severity, message: message });
  }

  /** Attach quality flags to every record. Returns the same array. */
  function flagRecords(records, mapping) {
    var map = mapping || {};

    /* A Map is used rather than a plain object so that an identifier such as
       "__proto__" or "constructor" cannot corrupt the count. */
    var idCounts = new Map();
    records.forEach(function (record) {
      var id = String(record.values.specimen_id).trim();
      if (id !== "") idCounts.set(id, (idCounts.get(id) || 0) + 1);
    });

    records.forEach(function (record) {
      var id = String(record.values.specimen_id).trim();

      REQUIRED.forEach(function (key) {
        if (String(record.values[key]).trim() === "") {
          addFlag(record, "missing_required", key, "error",
            "Required value " + labelFor(key) + " is missing.");
        }
      });

      if (id !== "" && idCounts.get(id) > 1) {
        addFlag(record, "duplicate_id", "specimen_id", "warning",
          "Specimen ID \"" + id + "\" appears on " + idCounts.get(id) +
          " rows. Kept for review; not removed.");
      }

      MEASUREMENTS.forEach(function (key) {
        if (!map[key]) return;                                  /* not mapped */
        var raw = String(record.values[key]).trim();
        var value = record.numbers[key];
        var required = REQUIRED.indexOf(key) >= 0;

        if (raw === "") return;   /* missing is reported above for required fields */

        if (!Number.isFinite(value)) {
          addFlag(record, "nonnumeric", key, required ? "error" : "warning",
            "The " + labelFor(key) + " value \"" + raw + "\" is not a number.");
          return;
        }
        if (value <= 0) {
          addFlag(record, "nonpositive", key, required ? "error" : "warning",
            "The " + labelFor(key) + " is " + value + ", which is not a positive " +
            "measurement. Kept for review; not removed.");
        }
      });

      var bodyMass = record.numbers.body_mass;
      ORGANS.forEach(function (key) {
        if (!map[key]) return;
        var value = record.numbers[key];
        if (!Number.isFinite(value)) return;

        if (Number.isFinite(bodyMass) && value > bodyMass) {
          addFlag(record, "organ_above_body_mass", key, "warning",
            "The " + labelFor(key) + " (" + value + ") is greater than the body mass (" +
            bodyMass + ").");
        }
      });

      var somatic = record.numbers.somatic_mass;
      if (map.somatic_mass && Number.isFinite(somatic) && somatic > 0) {
        ["gonad_mass", "liver_mass"].forEach(function (key) {
          if (!map[key]) return;
          var value = record.numbers[key];
          if (!Number.isFinite(value) || value <= somatic) return;
          addFlag(record, "organ_above_somatic_mass", key, "warning",
            "The " + labelFor(key) + " (" + value + ") is greater than the somatic mass (" +
            somatic + "), so the resulting index exceeds 100%.");
        });
      }
    });

    return records;
  }

  /** Count flags by check, for the validation summary table. */
  function summarizeFlags(records) {
    var counts = new Map();
    records.forEach(function (record) {
      record.flags.forEach(function (flag) {
        var key = flag.code + "|" + flag.field;
        if (!counts.has(key)) {
          counts.set(key, {
            code: flag.code,
            field: flag.field,
            severity: flag.severity,
            label: describeCheck(flag.code, flag.field),
            rows: 0
          });
        }
        counts.get(key).rows += 1;
      });
    });

    return Array.from(counts.values()).sort(function (a, b) {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      return b.rows - a.rows;
    });
  }

  function describeCheck(code, field) {
    var name = labelFor(field);
    switch (code) {
      case "missing_required": return "Missing required value: " + name;
      case "nonnumeric": return "Non-numeric value: " + name;
      case "nonpositive": return "Zero or negative value: " + name;
      case "duplicate_id": return "Duplicate specimen ID";
      case "organ_above_body_mass": return "Organ mass above body mass: " + name;
      case "organ_above_somatic_mass": return "Organ mass above somatic mass: " + name;
      default: return code + " (" + name + ")";
    }
  }

  /** How many rows carry at least one flag of the given severity. */
  function countRowsWithSeverity(records, severity) {
    return records.filter(function (record) {
      return record.flags.some(function (flag) { return flag.severity === severity; });
    }).length;
  }

  /** Coverage of the two indices, so the interface can state it plainly. */
  function indexCoverage(records) {
    return {
      gsi: records.filter(function (r) { return Number.isFinite(r.derived.gsi); }).length,
      hsi: records.filter(function (r) { return Number.isFinite(r.derived.hsi); }).length,
      total: records.length
    };
  }

  PBA.validate = {
    FIELDS: FIELDS,
    MEASUREMENTS: MEASUREMENTS,
    ORGANS: ORGANS,
    REQUIRED: REQUIRED,
    fieldByKey: fieldByKey,
    guessMapping: guessMapping,
    buildRecords: buildRecords,
    flagRecords: flagRecords,
    summarizeFlags: summarizeFlags,
    describeCheck: describeCheck,
    countRowsWithSeverity: countRowsWithSeverity,
    indexCoverage: indexCoverage
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.validate;
})(typeof globalThis !== "undefined" ? globalThis : this);
