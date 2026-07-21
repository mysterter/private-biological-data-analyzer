/*
 * stats.js — numeric helpers and ordinary least squares.
 *
 * Everything here is descriptive. No p-values are produced: reporting them
 * would imply that the model assumptions have been checked, and this tool
 * cannot check them. Coefficients, standard errors and t-statistics are
 * reported so the user can carry them into a proper statistical package.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  /** Strict numeric conversion: blank, non-numeric and infinite values -> NaN. */
  function toNumber(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    var text = String(value).trim();
    if (text === "") return NaN;
    var n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  }

  function finiteOnly(values) {
    return values.filter(function (v) { return Number.isFinite(v); });
  }

  function sum(values) {
    return values.reduce(function (acc, v) { return acc + v; }, 0);
  }

  function mean(values) {
    var xs = finiteOnly(values);
    return xs.length ? sum(xs) / xs.length : NaN;
  }

  function median(values) {
    var xs = finiteOnly(values).slice().sort(function (a, b) { return a - b; });
    if (!xs.length) return NaN;
    var mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  }

  /** Sample standard deviation (n - 1 denominator). */
  function sd(values) {
    var xs = finiteOnly(values);
    if (xs.length < 2) return NaN;
    var m = mean(xs);
    var ss = xs.reduce(function (acc, v) { return acc + (v - m) * (v - m); }, 0);
    return Math.sqrt(ss / (xs.length - 1));
  }

  function min(values) {
    var xs = finiteOnly(values);
    return xs.length ? Math.min.apply(null, xs) : NaN;
  }

  function max(values) {
    var xs = finiteOnly(values);
    return xs.length ? Math.max.apply(null, xs) : NaN;
  }

  /** Format for display; non-finite values are shown as NA, never as 0. */
  function fmt(value, digits) {
    var d = digits === undefined ? 3 : digits;
    return Number.isFinite(value) ? value.toFixed(d) : "NA";
  }

  /**
   * Solve A x = b and return the inverse of A as well (needed for standard
   * errors). Gauss-Jordan elimination with partial pivoting.
   * Returns null when A is singular or near-singular.
   */
  function solveWithInverse(A, b) {
    var k = A.length;
    var m = A.map(function (row, i) {
      var identity = [];
      for (var j = 0; j < k; j++) identity.push(i === j ? 1 : 0);
      return row.slice().concat(identity, [b[i]]);
    });

    for (var col = 0; col < k; col++) {
      var pivotRow = col;
      for (var r = col + 1; r < k; r++) {
        if (Math.abs(m[r][col]) > Math.abs(m[pivotRow][col])) pivotRow = r;
      }
      var pivot = m[pivotRow][col];
      if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) return null;

      var tmp = m[col]; m[col] = m[pivotRow]; m[pivotRow] = tmp;

      var scale = m[col][col];
      for (var c = 0; c < m[col].length; c++) m[col][c] /= scale;

      for (var r2 = 0; r2 < k; r2++) {
        if (r2 === col) continue;
        var factor = m[r2][col];
        if (factor === 0) continue;
        for (var c2 = 0; c2 < m[r2].length; c2++) {
          m[r2][c2] -= factor * m[col][c2];
        }
      }
    }

    return {
      solution: m.map(function (row) { return row[2 * k]; }),
      inverse: m.map(function (row) { return row.slice(k, 2 * k); })
    };
  }

  /**
   * Ordinary least squares of y on the columns of X, with an intercept.
   * X is an array of rows, each row an array of predictor values.
   * Rows containing a non-finite value are not usable and must be removed by
   * the caller (analysis.js does this and reports how many it removed).
   */
  function multipleOLS(y, X, predictorNames) {
    var n = y.length;
    var p = n ? X[0].length : 0;
    var k = p + 1; /* + intercept */

    if (n <= k) {
      return {
        ok: false,
        reason: "Not enough usable rows: " + n + " row(s) for " + k +
                " estimated parameter(s). At least " + (k + 1) + " are needed."
      };
    }

    /* Design matrix with a leading column of ones. */
    var design = X.map(function (row) { return [1].concat(row); });

    var XtX = [];
    var Xty = [];
    for (var i = 0; i < k; i++) {
      var rowAcc = [];
      for (var j = 0; j < k; j++) {
        var acc = 0;
        for (var r = 0; r < n; r++) acc += design[r][i] * design[r][j];
        rowAcc.push(acc);
      }
      XtX.push(rowAcc);
      var acc2 = 0;
      for (var r2 = 0; r2 < n; r2++) acc2 += design[r2][i] * y[r2];
      Xty.push(acc2);
    }

    var solved = solveWithInverse(XtX, Xty);
    if (!solved) {
      return {
        ok: false,
        reason: "The predictors are collinear (or one has no variation), so " +
                "the coefficients cannot be estimated uniquely."
      };
    }

    var coefficients = solved.solution;
    var fitted = design.map(function (row) {
      return row.reduce(function (acc, v, idx) { return acc + v * coefficients[idx]; }, 0);
    });
    var residuals = y.map(function (v, idx) { return v - fitted[idx]; });

    var my = mean(y);
    var sse = residuals.reduce(function (acc, e) { return acc + e * e; }, 0);
    var sst = y.reduce(function (acc, v) { return acc + (v - my) * (v - my); }, 0);
    var r2 = sst === 0 ? NaN : 1 - sse / sst;
    var df = n - k;
    var sigma2 = df > 0 ? sse / df : NaN;

    var se = solved.inverse.map(function (row, idx) {
      var v = sigma2 * row[idx];
      return Number.isFinite(v) && v >= 0 ? Math.sqrt(v) : NaN;
    });

    var names = ["(intercept)"].concat(
      predictorNames || X[0].map(function (_, idx) { return "x" + (idx + 1); })
    );

    return {
      ok: true,
      n: n,
      parameters: k,
      df: df,
      names: names,
      coefficients: coefficients,
      standardErrors: se,
      tStatistics: coefficients.map(function (c, idx) {
        return Number.isFinite(se[idx]) && se[idx] !== 0 ? c / se[idx] : NaN;
      }),
      r2: r2,
      adjustedR2: sst === 0 || df <= 0 ? NaN : 1 - (sse / df) / (sst / (n - 1)),
      residualSD: Number.isFinite(sigma2) ? Math.sqrt(sigma2) : NaN,
      fitted: fitted,
      residuals: residuals
    };
  }

  /**
   * Simple linear regression of y on a single x, computed in closed form.
   * Kept separate from multipleOLS so the basic case has an independent
   * implementation the tests can cross-check.
   */
  function simpleOLS(xs, ys) {
    var pairs = [];
    for (var i = 0; i < xs.length && i < ys.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
    }
    if (pairs.length < 3) {
      return { ok: false, reason: "At least 3 paired values are needed; got " + pairs.length + "." };
    }

    var x = pairs.map(function (p) { return p[0]; });
    var y = pairs.map(function (p) { return p[1]; });
    var n = pairs.length;
    var mx = mean(x);
    var my = mean(y);

    var sxx = x.reduce(function (acc, v) { return acc + (v - mx) * (v - mx); }, 0);
    if (sxx === 0) {
      return { ok: false, reason: "The predictor has no variation, so a slope cannot be estimated." };
    }
    var sxy = pairs.reduce(function (acc, p) { return acc + (p[0] - mx) * (p[1] - my); }, 0);

    var slope = sxy / sxx;
    var intercept = my - slope * mx;
    var fitted = x.map(function (v) { return intercept + slope * v; });
    var sse = y.reduce(function (acc, v, idx) {
      var e = v - fitted[idx];
      return acc + e * e;
    }, 0);
    var sst = y.reduce(function (acc, v) { return acc + (v - my) * (v - my); }, 0);
    var df = n - 2;
    var sigma2 = df > 0 ? sse / df : NaN;

    return {
      ok: true,
      n: n,
      slope: slope,
      intercept: intercept,
      r2: sst === 0 ? NaN : 1 - sse / sst,
      slopeSE: Number.isFinite(sigma2) ? Math.sqrt(sigma2 / sxx) : NaN,
      interceptSE: Number.isFinite(sigma2)
        ? Math.sqrt(sigma2 * (1 / n + (mx * mx) / sxx))
        : NaN,
      residualSD: Number.isFinite(sigma2) ? Math.sqrt(sigma2) : NaN,
      pairs: pairs,
      fitted: fitted
    };
  }

  PBA.stats = {
    toNumber: toNumber,
    sum: sum,
    mean: mean,
    median: median,
    sd: sd,
    min: min,
    max: max,
    fmt: fmt,
    solveWithInverse: solveWithInverse,
    simpleOLS: simpleOLS,
    multipleOLS: multipleOLS
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.stats;
})(typeof globalThis !== "undefined" ? globalThis : this);
