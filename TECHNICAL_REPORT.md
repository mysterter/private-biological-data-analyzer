# Technical report

Private Biological CSV Analyzer — architecture, validation, tests and privacy.

## 1. Architecture

### 1.1 The constraint that determined the design

The tool must run by double-clicking a file, with no server. That single
requirement rules out ES modules: a page opened from `file://` has an opaque
origin, and the browser refuses `<script type="module">` imports under the
module CORS rules. This was verified before any code was written, in both
browsers on this machine:

| Loading method | Chrome (`file://`) | Safari (`file://`) |
| --- | --- | --- |
| `<script src="…">` (classic) | works | works |
| `<script type="module">` | **fails** | **fails** |
| Classic script + strict CSP | works | works |

The project is therefore split into **classic scripts that share one global
namespace, `PBA`**, loaded in a fixed order. This gives readable, separately
testable modules while keeping the double-click launch intact. Each module is
an IIFE that attaches itself to `PBA` and also exports itself through
`module.exports` when one is present, so the same file runs unchanged in the
browser and under Node for testing.

### 1.2 Modules

| File | Responsibility |
| --- | --- |
| `js/privacy.js` | Disables every network API. Loaded first, before anything else can run. |
| `js/csv.js` | CSV parsing (a character-level state machine) and CSV writing. |
| `js/stats.js` | Numeric conversion, descriptive statistics, simple and multiple OLS. |
| `js/validate.js` | Field definitions, column-mapping guesses, record construction, quality flags, GSI/HSI. |
| `js/analysis.js` | Column profiling, the analysis plan, transforms, grouping, model execution. |
| `js/ui.js` | The only module that touches the DOM: screens, tables, canvas plot, downloads. |
| `css/app.css` | All styling. Kept in a file so the policy need not allow inline styles. |

Dependencies run one way, in load order: `csv` and `stats` are self-contained,
`validate` uses `stats`, `analysis` uses `stats` and the records `validate`
produced, and `ui` uses all of them. The first five modules are pure functions
over plain data and carry no DOM references, which is what makes them directly
testable in Node.

### 1.3 Flow

```
select file → parse → map columns → build + flag records → analysis plan → run → results
```

Each step is a separate card in the page, revealed as the previous one
completes. The plan is echoed above the results and embedded in the downloadable
summary, so a figure can always be traced to the choices that produced it.

### 1.4 Notes on robustness

- Tables are built with `createElement`/`textContent`, never `innerHTML`, so a
  value inside a CSV cannot be interpreted as markup.
- Identifier counts and group keys use `Map`, and parsed rows use
  `Object.create(null)`, so a specimen ID or column value of `__proto__` or
  `constructor` cannot corrupt a lookup.
- Non-numeric and blank values convert to `NaN`, never to `0`, and are
  displayed as `NA`. An empty mean is reported as `NA` rather than zero.

## 2. Validation logic

### 2.1 Structural problems (reported when the file loads)

The parser is a state machine rather than a `split(",")`, and handles quoted
fields containing commas, doubled quotes (`""` → `"`) and embedded newlines, as
well as CRLF endings and a leading byte-order mark. Line numbers are tracked
through embedded newlines, so a reported line number always matches the file.

Reported without changing the data: duplicate header names (the later column is
renamed, not dropped), blank header names, rows with too few values (missing
trailing values read as empty), rows with too many values, an unterminated
quote, and the count of blank lines skipped.

### 2.2 Row-level flags

| Check | Severity | Condition |
| --- | --- | --- |
| `missing_required` | error | Specimen ID, length or body mass is blank |
| `nonnumeric` | error / warning | A measurement cannot be read as a number |
| `nonpositive` | error / warning | A measurement is ≤ 0 |
| `duplicate_id` | warning | The specimen ID occurs on more than one row |
| `organ_above_body_mass` | warning | An organ mass exceeds the body mass |
| `organ_above_somatic_mass` | warning | An organ mass exceeds the somatic mass |

Severity is `error` for the three required fields and `warning` for optional
ones. "Error" means the value cannot enter a calculation; "warning" means it is
arithmetically usable but questionable. A zero gonad mass, for instance, is a
warning rather than an error, because whether it is an error is a biological
judgement this tool is not entitled to make.

**Nothing is ever deleted.** Flagged rows keep their original values, stay in
the record set, stay in the grouped summaries and appear in the flag report. A
row is left out of the regression only when a value it needs is missing,
non-numeric, or non-positive on a log scale — and the count and reason are
reported next to the results, along with a statement that those rows remain in
the dataset. This is enforced by tests, not just by convention.

### 2.3 Derived indices

`GSI = 100 × gonad mass / somatic mass` and `HSI = 100 × liver mass / somatic
mass`. Both are computed only when the somatic mass is present and strictly
positive; otherwise they are `NaN`, never zero and never guessed. The
denominator convention is stated in the interface, in the downloadable summary
and in the README, because it is a scientific choice the user must confirm.
Indices above 100% are computed and flagged, not clipped.

### 2.4 The analysis plan

The user chooses grouping fields, an outcome, one or more predictors, and
whether to log-transform. Behaviour worth stating explicitly:

- A variable containing a zero or negative value is **left on its original
  scale**, with the reason reported. The alternative — dropping those rows to
  make the logarithm defined — would silently delete data, so it is not done.
- With one predictor the closed-form simple regression is computed alongside
  the general multiple regression; a test asserts the two agree.
- Collinear predictors, a predictor with no variation, or too few rows for the
  number of parameters produce an explanatory refusal, not a number.
- Group summaries are always computed on the **original** scale.

## 3. Statistical reporting

Coefficients, standard errors, t-statistics, R², adjusted R² and the residual
SD are reported. **No p-values are produced.** Reporting them would imply that
the assumptions making them meaningful had been checked, and this tool checks
none of them: no residual diagnostics, no independence check, no
multiple-comparison control, no accounting for repeated measurements or
site-level replication.

The results screen states this in place, next to the coefficients, and the
downloadable summary carries the same note. The tool describes what is in the
file; it does not interpret it, and it makes no biological claim.

## 4. Tests

No external test framework is used — that would require a package manager and
break the unzip-and-double-click promise — so `tests/harness.js` is a ~100-line
runner. The same cases run in two places:

| Runner | How | Cases |
| --- | --- | --- |
| Browser | double-click `tests.html` | 59 |
| Node | `node tests/run-tests.js` | 75 |

The 16 extra cases in Node are the ones that must read files, which a
double-clicked page is not permitted to do.

### Coverage by area

| Area | What is checked |
| --- | --- |
| Quoted CSV fields | commas, doubled quotes and newlines inside quotes; quoted empties; CRLF; BOM; write/read round trip |
| File structure | duplicate and blank headers, short and long rows, blank lines, unterminated quote, empty file |
| Missing required values | absent ID, length and body mass; blank optional values; non-numeric values not becoming `0` |
| Duplicate IDs | every affected row flagged; unique rows not flagged; `__proto__`-style IDs; blank IDs not treated as duplicates |
| Nonpositive measurements | zero and negative required values as errors, optional as warnings; original values preserved |
| Organ mass above body mass | gonad and somatic above body mass; organ above somatic mass; a plausible row raising no flag |
| GSI and HSI | exact values; index above 100%; missing somatic mass; zero somatic mass (no division by zero); one index available without the other; coverage counts |
| Simple regression | exact recovery of a known line; a hand-computed example including the slope standard error; incomplete pairs ignored; refusals for too few points and for no variation |
| Multiple regression | exact recovery of a linear combination; agreement with the closed-form simple regression; refusal on collinearity and on too few rows |
| Analysis plan | plan validation; transform applied and skipped; no rows dropped for a logarithm; excluded rows counted and explained; grouping including `(missing)`; derived indices as variables; column profiling; the default plan |
| Data integrity | one record per input row, whatever the data contains |
| Privacy | network APIs refuse and record the attempt; a full analysis triggers none |
| Source scan (Node) | no external address, script, stylesheet or asset; network APIs mentioned only where expected; the CSP declares `connect-src 'none'`; no storage APIs; only the user-selected file is read; scripts load locally in a fixed order with `privacy.js` first and no ES modules |
| Synthetic file (Node) | automatic column recognition; 61 rows in, 61 records out; the planted duplicate ID and the planted impossible organ mass found; no unusable rows; index coverage; the default plan cross-checked against an independent calculation from the raw text |

### Result

Both runners pass in full. See section 6.

## 5. Privacy safeguards

Four independent layers, so that no single mistake removes the guarantee:

1. **No external references.** Every asset is a local file. No CDN, library,
   font, tracker or analytics. A test scans the source for `http(s)://`,
   remote `<script>`/`<link>`, `@import` and remote `url(...)`.
2. **Content Security Policy** in `index.html` and `tests.html`:
   `default-src 'none'; script-src 'self' file:; style-src 'self' file:;
   img-src 'self' file: data:; connect-src 'none'; form-action 'none';
   base-uri 'none'; object-src 'none'; frame-src 'none'; media-src 'none'`.
   `connect-src 'none'` stops the page opening any connection;
   `form-action 'none'` stops any form posting anywhere. The policy was
   verified not to break local script loading from `file://` in either browser.
3. **Runtime kill switch** (`js/privacy.js`), loaded before any other module.
   It replaces `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `RTCPeerConnection`, `webkitRTCPeerConnection` and `navigator.sendBeacon`
   with functions that throw and record the attempt. The properties are
   redefined as non-writable and non-configurable where the engine allows it.
   The page displays which APIs were disabled; the tests assert each one
   refuses, and that a full analysis triggers none.
4. **No persistence.** No `localStorage`, `sessionStorage`, `indexedDB` or
   cookies — asserted by a test. Data lives in memory until the tab is closed
   or refreshed.

**File reading.** The only read path is the `<input type="file">` the user
operates. There is no drag-and-drop handler, no `showDirectoryPicker`, no
`webkitdirectory`, and no dynamic import — asserted by a test. The tool cannot
open a file the user did not select, which is also why the browser test page
cannot run the synthetic-file checks.

**Downloads** are built in memory as a `Blob` and handed to the browser's own
save mechanism; no network is involved.

## 6. Verification performed

| Check | Result |
| --- | --- |
| `node tests/run-tests.js` | 75 passed, 0 failed |
| `tests.html` in Chrome from `file://` | 59 passed, 0 failed |
| `tests.html` in Safari from `file://` | 59 passed, 0 failed |
| `index.html` in Chrome from `file://` | loads, all six modules present, no console errors, no CSP violations |
| `index.html` in Safari from `file://` | loads and runs |
| End-to-end with `synthetic_example.csv` | 61 rows, 60 unique IDs, 3 flagged rows, model n = 61, R² = 0.964 |
| Network activity during a full session | zero requests; only local `file://` reads of the app's own files |
| Blocked network attempts during a full session | zero |

The end-to-end run was performed by driving the real interface: selecting the
file, mapping columns, opening the analysis plan, running it, changing the plan
(multiple predictors, log transform off, GSI as the outcome), triggering both
validation errors, and generating both downloads.

## 7. Known limitations

- Standard errors assume independent, identically distributed residuals. That
  assumption is not tested and is unlikely to hold for repeated measurements or
  clustered sampling.
- The regression uses normal equations with Gauss-Jordan elimination. This is
  accurate at the scale this tool is built for, but a badly scaled or
  near-collinear design would be handled better by a QR decomposition. Exactly
  collinear predictors are detected and refused.
- Column profiling calls a column numeric when at least 80% of its non-blank
  values parse as numbers; a mostly numeric column with text codes will still
  be offered as a variable, and its non-numeric rows will be counted as
  unusable.
- Dates are mapped but not parsed or used; date and year effects are listed in
  the README as work for a real statistical package.
- The tool has been verified on Chrome and Safari on macOS. It uses no
  browser-specific APIs, but has not been run on Firefox or on Windows.
