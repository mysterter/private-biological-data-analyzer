# Prompt for Claude Fable 5 / Claude Code

Open this project folder, but do not access any folder containing real laboratory data.

Use only `synthetic_example.csv` while developing and testing.

Your task:

1. Inspect `index.html`, `README.md`, and `synthetic_example.csv`.
2. Run the local app and test every feature using the synthetic file.
3. Preserve the core privacy rule:
   - no network requests;
   - no external libraries or CDNs;
   - no telemetry;
   - no cloud upload;
   - no automatic reading of files other than the one selected by the user.
4. Improve code quality by splitting the project into readable JavaScript modules only if the app still works by double-clicking a local launcher without a server.
5. Add automated tests for:
   - quoted CSV fields;
   - missing required values;
   - duplicate IDs;
   - nonpositive measurements;
   - organ mass above body mass;
   - GSI and HSI calculations;
   - simple regression calculations.
6. Add an analysis-plan screen where the user can select:
   - grouping fields;
   - outcome variable;
   - predictor variables;
   - whether to log-transform positive numeric variables.
7. Never invent scientific findings.
8. Flag questionable values rather than deleting them.
9. Produce a short technical report describing architecture, validation logic, tests, and privacy safeguards.
10. Do not ask for or open the confidential Mandrak dataset.

Before making changes, summarize your plan. After changes, run the tests and report exactly what passed or failed.
