# Private Biological CSV Analyzer

A local tool for checking a biological specimen CSV and computing descriptive
summaries and a regression you specify yourself. It runs in a browser tab on
your own machine. Nothing is uploaded, and no internet connection is used.

## Easiest use

1. Unzip this folder.
2. Double-click `index.html`.
3. Select your CSV.
4. Map the requested columns.
5. Choose an analysis plan.
6. Click **Run local analysis**.

No Python, terminal, package installation, account, or internet connection is
required.

Keep the whole folder together. `index.html` loads its code from the `js/` and
`css/` folders next to it, so moving `index.html` on its own will not work.

## Privacy

The analyzer never sends anything anywhere. Three separate measures enforce it:

- **No external references.** Every script, style and font is a local file.
  There are no CDNs, libraries, trackers or analytics of any kind.
- **A content security policy** in `index.html` declares `connect-src 'none'`
  and `default-src 'none'`, so the browser itself refuses to open a network
  connection or load a remote resource from this page.
- **A runtime kill switch** (`js/privacy.js`, loaded before everything else)
  disables `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
  `RTCPeerConnection` and `navigator.sendBeacon`, and records any attempt to
  use them. The count is shown at the top of the page.

The only file the tool reads is the one you pick in the file dialog. There is
no drag-and-drop folder scan, no directory picker and no "recent files" list.
Nothing is written to `localStorage`, `sessionStorage`, cookies or IndexedDB, so
closing or refreshing the tab clears the loaded data from memory.

Downloads (the flag report and the aggregate summary) are generated in memory
and saved by your own browser to your own disk.

**Do not place the private CSV in a GitHub repository.** Keep the analyzer and
the data in separate folders.

## What it checks

Questionable values are **flagged and kept**. The tool never deletes, corrects
or silently drops a row — that decision belongs to the person who collected the
data.

| Check | Severity |
| --- | --- |
| Missing required value (specimen ID, length, body mass) | error |
| Non-numeric measurement | error / warning |
| Zero or negative measurement | error / warning |
| Duplicate specimen identifier | warning |
| Organ mass greater than body mass | warning |
| Organ mass greater than somatic mass (index above 100%) | warning |

"Error" means the value cannot be used in a calculation; "warning" means it is
arithmetically usable but deserves a look. Structural problems in the file
itself — ragged rows, duplicate or blank header names, an unterminated quote —
are reported separately when the file loads.

## What it computes

- **GSI** = 100 × gonad mass / somatic mass
- **HSI** = 100 × liver mass / somatic mass

Both use somatic mass as the denominator. That is a convention, not the only
one in use; confirm it matches your protocol before reporting these numbers.
The interface states how many rows each index could be computed for.

- **Group summaries** (n, mean, SD, median, min, max) for every combination of
  the grouping fields you tick, plus a count of flagged rows per group.
- **A least-squares regression** of the outcome on the predictors you choose,
  optionally on a log scale, reported with standard errors, t-statistics, R²
  and adjusted R².

## The analysis plan

Step 3 is where you say what should be computed:

- **Grouping fields** — any columns; summaries are reported per combination.
- **Outcome variable** — any numeric column, or the derived GSI or HSI.
- **Predictor variables** — one or more numeric variables (more than one gives
  a multiple regression).
- **Log transform** — when ticked, variables whose values are all positive are
  log-transformed. A variable containing a zero or a negative value is left on
  its original scale and the reason is reported. Rows are never dropped to make
  a logarithm possible.

The plan is echoed above the results, and included in the downloadable summary,
so any number can be traced back to the choices that produced it.

## Tests

Two runners execute the same test cases:

- **In a browser:** double-click `tests.html`. No server, no installation.
- **On the command line:** `node tests/run-tests.js`.

The command-line runner adds two groups that a double-clicked page is not
allowed to run, because they need to read files: an end-to-end pass over
`synthetic_example.csv`, and a scan of the source files for anything that could
reach the network.

`synthetic_example.csv` is invented data for testing. It deliberately contains
one duplicated specimen ID and one gonad mass larger than the body mass, so the
flagging can be seen working.

## Scientific limitations

The regression is an exploratory, descriptive starting point. **No p-values are
reported**, because this tool cannot check the assumptions that would make them
meaningful, and nothing it prints establishes a biological effect.

A final research analysis may require:

- mixed-effects models;
- site-level replication checks;
- date or year effects;
- sex-specific models;
- nonlinear terms;
- residual diagnostics;
- sensitivity analyses;
- multiple-comparison control.

Those should be added only after the biological design and variable definitions
are confirmed.

See `TECHNICAL_REPORT.md` for the architecture, the validation rules and the
test inventory.
