/*
 * privacy.js — local-only guarantee, enforced at runtime.
 *
 * This file is loaded before every other module. It disables the browser APIs
 * that could send data off this machine, so that an accidental future edit
 * (or a pasted snippet) cannot silently introduce an upload, a CDN fetch, or a
 * telemetry beacon. The Content-Security-Policy in index.html is the first
 * line of defence; this is the second, and it is observable from the tests.
 *
 * Reading the CSV the user selects does not go through any of these APIs:
 * File.text() and FileReader operate on a file handle the user chose in the
 * system file picker, so they stay available.
 */
(function (root) {
  "use strict";

  var PBA = (root.PBA = root.PBA || {});

  /* Every refusal is recorded so the UI and the tests can prove nothing left. */
  var attempts = [];

  var DISABLED_APIS = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "navigator.sendBeacon"
  ];

  function refusal(api) {
    return function blockedNetworkCall() {
      attempts.push({ api: api, when: new Date().toISOString() });
      throw new Error(
        "Blocked: " + api + " is disabled. This analyzer is local-only and " +
        "never sends data over a network."
      );
    };
  }

  function hardenProperty(target, name, value) {
    try {
      Object.defineProperty(target, name, {
        value: value,
        writable: false,
        configurable: false,
        enumerable: false
      });
      return true;
    } catch (err) {
      /* Some engines refuse to redefine a built-in; fall back to assignment. */
      try {
        target[name] = value;
        return true;
      } catch (err2) {
        return false;
      }
    }
  }

  function disable() {
    var disabled = [];

    ["fetch", "XMLHttpRequest", "WebSocket", "EventSource",
     "RTCPeerConnection", "webkitRTCPeerConnection"].forEach(function (name) {
      if (typeof root[name] === "undefined") return;
      if (hardenProperty(root, name, refusal(name))) disabled.push(name);
    });

    if (typeof root.navigator === "object" && root.navigator &&
        typeof root.navigator.sendBeacon === "function") {
      if (hardenProperty(root.navigator, "sendBeacon", refusal("navigator.sendBeacon"))) {
        disabled.push("navigator.sendBeacon");
      }
    }

    return disabled;
  }

  var disabledApis = disable();

  PBA.privacy = {
    /* API names this build actually managed to disable in this environment. */
    disabledApis: disabledApis,
    /* Names we attempt to disable, whether or not the engine provides them. */
    targetedApis: DISABLED_APIS,
    /* Recorded refusals. Empty in normal use — a non-empty list is a bug. */
    blockedAttempts: function () { return attempts.slice(); },
    /* True when nothing in this session has tried to reach the network. */
    isClean: function () { return attempts.length === 0; }
  };

  if (typeof module === "object" && module.exports) module.exports = PBA.privacy;
})(typeof globalThis !== "undefined" ? globalThis : this);
