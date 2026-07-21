/*
 * harness.js — a minimal test harness.
 *
 * Deliberately hand-written: the privacy rule forbids external libraries, and
 * a test runner that had to be installed from a package registry would break
 * the "unzip and double-click" promise. The same registered cases are executed
 * by tests/run-tests.js (Node) and by tests.html (browser).
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});
  var cases = [];

  function test(group, name, fn) {
    cases.push({ group: group, name: name, fn: fn });
  }

  function fail(message) {
    throw new Error(message);
  }

  function describeValue(value) {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return JSON.stringify(value);
    try { return JSON.stringify(value); } catch (err) { return String(value); }
  }

  var assert = {
    ok: function (value, message) {
      if (!value) fail((message || "Expected a truthy value") + " (got " + describeValue(value) + ")");
    },

    notOk: function (value, message) {
      if (value) fail((message || "Expected a falsy value") + " (got " + describeValue(value) + ")");
    },

    equal: function (actual, expected, message) {
      if (actual !== expected) {
        fail((message || "Values differ") + ": expected " + describeValue(expected) +
             " but got " + describeValue(actual));
      }
    },

    /** Floating-point comparison; the default tolerance suits our magnitudes. */
    close: function (actual, expected, tolerance, message) {
      var tol = tolerance === undefined ? 1e-9 : tolerance;
      if (!Number.isFinite(actual)) {
        fail((message || "Value is not finite") + ": got " + describeValue(actual));
      }
      if (Math.abs(actual - expected) > tol) {
        fail((message || "Values differ") + ": expected " + expected +
             " (±" + tol + ") but got " + actual);
      }
    },

    isNaN: function (actual, message) {
      if (!(typeof actual === "number" && Number.isNaN(actual))) {
        fail((message || "Expected NaN") + ": got " + describeValue(actual));
      }
    },

    deepEqual: function (actual, expected, message) {
      var a = JSON.stringify(actual);
      var b = JSON.stringify(expected);
      if (a !== b) fail((message || "Structures differ") + ": expected " + b + " but got " + a);
    },

    throws: function (fn, message) {
      var threw = false;
      try { fn(); } catch (err) { threw = true; }
      if (!threw) fail(message || "Expected the call to throw");
    }
  };

  function run() {
    var results = cases.map(function (item) {
      try {
        item.fn(assert);
        return { group: item.group, name: item.name, ok: true, error: "" };
      } catch (err) {
        return {
          group: item.group,
          name: item.name,
          ok: false,
          error: err && err.message ? err.message : String(err)
        };
      }
    });

    return {
      total: results.length,
      passed: results.filter(function (r) { return r.ok; }).length,
      failed: results.filter(function (r) { return !r.ok; }).length,
      results: results
    };
  }

  PBA.testing = {
    test: test,
    assert: assert,
    run: run,
    cases: cases,
    reset: function () { cases.length = 0; }
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.testing;
})(typeof globalThis !== "undefined" ? globalThis : this);
