# Usage

## The quick version

In Figma, choose **Copy link to selection** for a frame. Then ask Claude:

> Compare `https://www.figma.com/design/FILE_KEY/File?node-id=12-34` with `https://staging.example.com/checkout` and create a design QA report.

Claude runs the check, and the HTML report appears in `~/Documents/Design QA/`.

## A better prompt

Include the details that affect how the page should look:

```text
Run design QA for this page.

Figma: [frame link]
Live page: [build link]
Viewport: [frame width or mobile/desktop]
Theme: [light/dark]
Locale: [locale]
Intentional differences: [anything Claude should ignore]

Compare colors, type, font loading, and radii. Prioritize likely hardcoded drift,
and tell me when the Figma frame does not provide enough evidence to check something.
Create the HTML report when finished.
```

## If you need to retry one part

The one-click workflow is:

1. `capture_design` reads the Figma frame.
2. `capture_build` reads the live page.
3. `check_tokens` compares the values.
4. `build_report` creates the report.

If a step fails, use the returned `runId` to rerun that step. You do not need to start from scratch.

## Reading the findings

Findings are grouped by value, so one hardcoded color used in 30 places appears as one useful issue rather than 30 separate alerts. You will see the severity, the closest design value, how often it appears, and where to look.

`notVerified` means “we did not have enough evidence to make a fair call.” It is a useful prompt to choose a better reference frame or check the theme — it is not automatically a failure.

## Dismissing a known exception

If something is intentionally different, use `dismiss_finding` with the finding hash and a short reason. The exception is remembered for future checks against that Figma file.

## Reports and files

The HTML report is designed to be opened and shared on its own. Detailed run JSON lives under `DESIGN_QA_HOME/runs/<runId>/`; the default is `~/.figma-live-design-qa-mcp/runs/`.
