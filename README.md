# Figma Live Design QA MCP

Figma Live Design QA MCP compares the design tokens in a Figma frame with the values rendered by a live web page. It reports actionable deviations in colors, typography, font loading, and corner radii without relying on a pixel diff.

It is a local stdio MCP server designed for Claude Desktop and other MCP clients that can launch local processes.

## Why it exists

Figma frames usually contain placeholder content while live pages contain real content, so screenshots are rarely pixel-identical. This server measures the values that should remain consistent, groups repeated deviations, and writes a self-contained HTML report.

Its precision-first rules intentionally prefer a missed issue over a noisy false positive:

- inferred token sets are confidence-scored per dimension;
- near-miss values are treated as stronger evidence than distant values;
- inherited, invisible, SVG-internal, and browser-generated styles are filtered;
- uncertain dimensions are reported as `not_verified`, not guessed.

## Quick start

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
npm run build
```

Create a Figma personal access token with **File content: read** permission. Put it in the MCP client configuration as an environment variable; never commit it to this repository. See [Security](docs/security.md).

Example Claude Desktop configuration:

```json
{
  "mcpServers": {
    "figma-live-design-qa": {
      "command": "node",
      "args": ["/absolute/path/to/figma-live-design-qa-mcp/dist/index.js"],
      "env": { "FIGMA_TOKEN": "figd_your_token_here" }
    }
  }
}
```

Ask your MCP client:

> Run design QA on `https://www.figma.com/design/FILE_KEY/File?node-id=12-34` against `https://staging.example.com/checkout`.

The generated report is saved under `~/Documents/Design QA/` by default.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `run_design_qa` | Runs the complete capture, comparison, and report pipeline. |
| `capture_design` | Fetches a Figma frame and derives its token set. |
| `capture_build` | Measures a live page in the user’s authenticated browser session. |
| `check_tokens` | Compares the build against the design and returns grouped findings. |
| `build_report` | Writes a self-contained HTML report and JSON artifact. |
| `dismiss_finding` | Baselines a known exception for the Figma file. |

If an end-to-end run fails, it returns the saved `runId`; use the granular tools to resume from the failed stage.

## Browser sessions

For sites behind authentication, the server first attaches to Chrome over CDP and otherwise uses a temporary copy of the Chrome profile. It never asks for or stores a password. Start Chrome with remote debugging on macOS when needed:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Then sign in to the target site in that Chrome window and run the check again. See [Setup](docs/setup.md) and [Troubleshooting](docs/troubleshooting.md).

## Reports and storage

- Reports: `~/Documents/Design QA/`
- Run artifacts: `~/.figma-live-design-qa-mcp/runs/`
- Baselines: `~/.figma-live-design-qa-mcp/baselines/`

Override local storage with `DESIGN_QA_HOME` and `DESIGN_QA_REPORT_DIR`. Runs older than 14 days are cleaned up and the run store is capped at 2 GB.

## Documentation

- [Setup](docs/setup.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)

## Development

```bash
npm test          # typecheck, then run all tests
npm run typecheck
npm run build
```

The test suite covers token inference, color math, precision filters, shadow DOM and iframe traversal, MCP protocol behavior, end-to-end findings, baselines, and self-contained reports.

## Known limitations

- No copy or geometry matching between Figma nodes and DOM elements.
- Pseudo-element styles are not traversed.
- `line-height` is captured but intentionally not compared.
- Cross-origin iframe contents are skipped.
- A mode mismatch can mark color comparison as `not_verified`.
- The Variables REST endpoint is Enterprise-only; bound-value and frequency fallbacks are supported for other plans.

## License

This repository does not currently declare a license. Add one before distributing it as an open-source package.
