# Architecture

The server is a local stdio MCP process with four measurement stages:

1. **Design capture** fetches the selected Figma frame, flattens relevant nodes, and derives token sets from the Variables API, variable/style bindings, or repeated frame values.
2. **Build capture** opens the live page in an authenticated Playwright session, traverses the DOM, shadow roots, and same-origin iframes, and records computed values.
3. **Token analysis** canonicalizes colors, sizes, weights, radii, and font families; filters browser noise; groups findings; and applies confidence-aware severity.
4. **Report generation** captures useful build and Figma crops, writes JSON artifacts, and creates a self-contained HTML report.

The orchestrator runs all four stages and preserves the `runId` if a stage fails. Granular tools can resume from saved artifacts.

## Precision model

Token confidence is tracked per dimension using `variables-api`, `bound`, `bound-partial`, `frequency`, or `not_verified`. A low-confidence dimension does not produce speculative findings.

Near-miss values are more actionable than distant values: a one-pixel or one-channel deviation often indicates hardcoded drift, while a distant value may belong to a widget, image, or state absent from the frame.

## Storage and lifecycle

The default storage root is `~/.figma-live-design-qa-mcp/`. Run data is cleaned after 14 days and capped at 2 GB. Browser sessions are held briefly so report generation can crop the exact captured page; only browsers launched by the server are closed during shutdown.
