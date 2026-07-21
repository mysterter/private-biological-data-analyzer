/*
 * csv.js — CSV reading and writing.
 *
 * The parser is a small state machine rather than a split(",") because real
 * lab exports contain quoted fields with commas, embedded newlines, and
 * doubled quotes. Structural oddities (ragged rows, duplicate headers, an
 * unterminated quote) are reported as warnings and the data is kept: nothing
 * is dropped silently.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  /**
   * Split raw CSV text into records of raw string fields.
   * Returns [{ fields: string[], line: number }], where line is the 1-based
   * physical line in the file on which the record started.
   */
  function splitRecords(text, warnings) {
    var records = [];
    var fields = [];
    var field = "";
    var inQuotes = false;
    var line = 1;
    var recordLine = 1;
    var i = 0;

    function endRecord() {
      fields.push(field);
      field = "";
      records.push({ fields: fields, line: recordLine });
      fields = [];
      recordLine = line;
    }

    while (i < text.length) {
      var ch = text.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        /* Newlines inside quotes belong to the value; normalise CRLF to LF. */
        if (ch === "\r") {
          field += "\n"; line += 1;
          i += text.charAt(i + 1) === "\n" ? 2 : 1;
          continue;
        }
        if (ch === "\n") { field += "\n"; line += 1; i += 1; continue; }
        field += ch; i += 1; continue;
      }

      if (ch === '"') {
        if (field === "") { inQuotes = true; i += 1; continue; }
        /* A quote in the middle of a bare field is kept verbatim. */
        warnings.push({
          code: "stray_quote",
          line: line,
          message: "Line " + line + ": a quote character appears inside an " +
                   "unquoted field and was kept as a literal character."
        });
        field += ch; i += 1; continue;
      }

      if (ch === ",") { fields.push(field); field = ""; i += 1; continue; }

      if (ch === "\r") {
        line += 1;
        i += text.charAt(i + 1) === "\n" ? 2 : 1;
        endRecord();
        continue;
      }

      if (ch === "\n") { line += 1; i += 1; endRecord(); continue; }

      field += ch; i += 1;
    }

    if (inQuotes) {
      warnings.push({
        code: "unterminated_quote",
        line: recordLine,
        message: "The file ends inside a quoted field that was opened on line " +
                 recordLine + ". The remaining text was kept as one value."
      });
    }
    if (field !== "" || fields.length) endRecord();

    return records;
  }

  function isBlankRecord(record) {
    return record.fields.every(function (v) { return String(v).trim() === ""; });
  }

  /** Make header names usable and unique without discarding any column. */
  function normaliseHeaders(rawHeaders, warnings) {
    var seen = new Map();
    return rawHeaders.map(function (raw, index) {
      var name = String(raw).trim();
      if (name === "") {
        name = "column_" + (index + 1);
        warnings.push({
          code: "blank_header",
          message: "Column " + (index + 1) + " has no header name; it was " +
                   "named \"" + name + "\"."
        });
      }
      if (seen.has(name)) {
        var count = seen.get(name) + 1;
        seen.set(name, count);
        var unique = name + "__" + count;
        while (seen.has(unique)) { count += 1; unique = name + "__" + count; }
        warnings.push({
          code: "duplicate_header",
          message: "The header \"" + name + "\" appears more than once; " +
                   "column " + (index + 1) + " was renamed \"" + unique + "\" " +
                   "so no column is lost."
        });
        seen.set(unique, 1);
        return unique;
      }
      seen.set(name, 1);
      return name;
    });
  }

  /**
   * Parse CSV text.
   * Returns { headers, rows, warnings, blankRowsSkipped } where each row is
   * { data: {header: value}, sourceRow: number, fieldCount: number }.
   */
  function parseCSV(text) {
    if (typeof text !== "string") throw new TypeError("parseCSV expects text.");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); /* strip BOM */

    var warnings = [];
    var records = splitRecords(text, warnings);
    if (!records.length) throw new Error("The CSV appears to be empty.");

    var headers = normaliseHeaders(records[0].fields, warnings);
    var rows = [];
    var blankRowsSkipped = 0;

    records.slice(1).forEach(function (record) {
      if (isBlankRecord(record)) { blankRowsSkipped += 1; return; }

      if (record.fields.length < headers.length) {
        warnings.push({
          code: "short_row",
          line: record.line,
          message: "Line " + record.line + " has " + record.fields.length +
                   " values but there are " + headers.length + " columns; the " +
                   "missing trailing values were read as empty."
        });
      } else if (record.fields.length > headers.length) {
        warnings.push({
          code: "long_row",
          line: record.line,
          message: "Line " + record.line + " has " + record.fields.length +
                   " values but there are only " + headers.length + " columns; " +
                   "the " + (record.fields.length - headers.length) +
                   " extra value(s) could not be assigned to a column."
        });
      }

      var data = Object.create(null);
      headers.forEach(function (header, index) {
        var value = record.fields[index];
        data[header] = value === undefined ? "" : value;
      });

      rows.push({
        data: data,
        sourceRow: record.line,
        fieldCount: record.fields.length
      });
    });

    if (!headers.length) throw new Error("The CSV has no columns.");

    return {
      headers: headers,
      rows: rows,
      warnings: warnings,
      blankRowsSkipped: blankRowsSkipped
    };
  }

  /** Quote a single value for CSV output. */
  function csvCell(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Turn an array of arrays into CSV text. */
  function toCSV(rows) {
    return rows.map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");
  }

  PBA.csv = { parseCSV: parseCSV, csvCell: csvCell, toCSV: toCSV };

  if (typeof module === "object" && module.exports) module.exports = PBA.csv;
})(typeof globalThis !== "undefined" ? globalThis : this);
