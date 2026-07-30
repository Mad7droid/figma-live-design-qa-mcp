# Usage

## End-to-end check

Give the MCP client a Figma frame link containing `node-id` and the live page URL:

> Run design QA on `https://www.figma.com/design/FILE_KEY/File?node-id=12-34` against `https://staging.example.com/checkout`.

The server captures the selected frame, measures the page at the frame width, compares token values, and writes an HTML report.

## Granular workflow

Use the tools individually when you need to retry one stage:

1. `capture_design` with a frame link or file key plus `nodeId`.
2. `capture_build` with the returned `runId` and build URL.
3. `check_tokens` with the `runId`.
4. `build_report` with the `runId`.

`capture_build` defaults to the Figma frame width. Pass `viewportWidth` when a different viewport is intentional.

## Findings

Findings are grouped by canonical value rather than emitted once per DOM element. Each finding includes severity, nearest design value, occurrence count, and a human-readable location. The model receives a compact summary; detailed machine paths remain in the run artifacts and report.

Dimensions with insufficient evidence are listed under `notVerified`. This is expected for files without enough bound or repeated values.

## Dismissing an exception

Pass a finding hash from `check_tokens` or the report to `dismiss_finding`, optionally with a reason. The exception is stored per Figma file and suppressed on future runs.

## Artifacts

Each run stores JSON artifacts under `DESIGN_QA_HOME/runs/<runId>/`. The shareable HTML report is also copied to `DESIGN_QA_REPORT_DIR`, which defaults to `~/Documents/Design QA/`.
