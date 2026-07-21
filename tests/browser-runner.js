/*
 * browser-runner.js — renders the shared test suite inside tests.html.
 *
 * The result is also written into the page title ("TESTS PASS 60/60"), so the
 * outcome can be read at a glance from a browser tab without opening the page.
 */
(function (root) {
  "use strict";

  var PBA = root.PBA;
  var doc = root.document;

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    var summary = PBA.testing.run();
    var target = doc.getElementById("results");

    doc.title = (summary.failed ? "TESTS FAIL " : "TESTS PASS ") +
                summary.passed + "/" + summary.total;

    var banner = el("div", "note" + (summary.failed ? " caution" : ""));
    banner.appendChild(el("strong", null,
      summary.failed
        ? summary.failed + " of " + summary.total + " tests failed."
        : "All " + summary.total + " tests passed."));
    banner.appendChild(el("div", "small",
      "Run from " + root.location.protocol + " with no server and no network access."));
    target.appendChild(banner);

    var currentGroup = "";
    var table = null;
    var tbody = null;

    summary.results.forEach(function (result) {
      if (result.group !== currentGroup) {
        currentGroup = result.group;
        target.appendChild(el("h3", null, currentGroup));
        var wrap = el("div", "tablewrap");
        table = el("table");
        var thead = el("thead");
        var headRow = el("tr");
        ["Result", "Test", "Detail"].forEach(function (heading) {
          headRow.appendChild(el("th", null, heading));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        tbody = el("tbody");
        table.appendChild(tbody);
        wrap.appendChild(table);
        target.appendChild(wrap);
      }

      var row = el("tr");
      row.appendChild(el("td", result.ok ? "good" : "bad", result.ok ? "PASS" : "FAIL"));
      row.appendChild(el("td", null, result.name));
      row.appendChild(el("td", "small", result.error));
      tbody.appendChild(row);
    });
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
