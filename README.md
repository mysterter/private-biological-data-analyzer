# Private Biological Data Analyzer

A privacy-focused browser application for validating and exploring biological CSV datasets entirely on the user's device.

## Overview

Research datasets can contain confidential specimen records, unpublished measurements, and project-specific identifiers. This application performs CSV parsing, validation, visualization, and exploratory analysis inside the browser without sending records to a server.

The public repository contains only synthetic demonstration data. The application has also been used locally with a confidential biological research dataset, but no private records, identifiers, or unpublished findings are included here.

## Key Features

- Runs locally in a modern browser
- No server, account, cloud upload, or external analytics
- Configurable mapping between CSV columns and analysis fields
- Duplicate specimen-identifier detection
- Missing, nonnumeric, and nonpositive-value checks
- Biological consistency checks, including organ mass versus total body mass
- Gonadosomatic and hepatosomatic index calculations when required fields are present
- Grouped descriptive summaries
- Exploratory log body-mass versus log length regression
- Browser-generated visualization
- Downloadable validation and aggregate-summary reports
- Synthetic CSV included for safe demonstration

## Privacy Design

The selected CSV is processed in browser memory. The application does not intentionally transmit data to a remote service.

Recommended practice:

1. Keep confidential datasets outside the repository folder.
2. Use the included synthetic dataset for public demonstrations.
3. Do not commit generated row-level reports.
4. Close or refresh the browser tab after private analysis.
5. Verify repository contents before every public commit.

## Try the Demonstration

1. Download or clone the repository.
2. Open `index.html` in a browser.
3. Select `synthetic_example.csv`.
4. Confirm or change the column mappings.
5. Select **Run local analysis**.
6. Review the validation summary, visualization, and grouped statistics.

No package installation is required for the standalone version.

## Example Workflow

```text
Select CSV
    ↓
Map columns
    ↓
Validate records
    ↓
Create derived measures
    ↓
Generate summaries and visualization
    ↓
Download local reports
```

## Validation Rules

The application can flag:

- duplicate specimen identifiers;
- missing required values;
- nonnumeric measurements;
- zero or negative measurements;
- organ or somatic mass exceeding total body mass.

Flagged observations are not automatically deleted. They remain available for local review so that scientific decisions are documented rather than silently automated.

## Technical Details

- JavaScript
- HTML
- CSS
- Client-side CSV parsing
- Configurable data mapping
- Descriptive statistics
- Ordinary least-squares regression
- Canvas-based visualization
- Local report generation

## Repository Contents

```text
.
├── index.html
├── synthetic_example.csv
├── README.md
├── LICENSE
└── screenshots/
    └── analyzer-demo.png
```

The exact structure may include separate JavaScript, CSS, test, or source files if the application has been modularized.

## Scientific Limitations

The built-in model is an exploratory starting point, not an automatic final scientific analysis. A complete analysis may require:

- mixed-effects modelling;
- site- or year-level sampling structure;
- model diagnostics;
- sex-specific models;
- nonlinear terms;
- sensitivity analyses;
- multiple-comparison correction;
- biological review of every exclusion rule.

Observational associations should not be interpreted automatically as causal effects.

## Data Availability

The repository includes synthetic data only. Confidential research data and unpublished results are not publicly available.

## License

MIT License
