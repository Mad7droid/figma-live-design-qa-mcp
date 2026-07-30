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

## Setup

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
npm run build
```

Create a Figma personal access token with **File content: read** permission. Put it in the MCP client configuration as an environment variable; never commit it to this repository. See [Security](docs/security.md).

### Add it to Claude Desktop

1. Build the server using the commands above.
2. Open Claude Desktop settings and choose **Developer → Edit Config**.
3. Add the server to the `mcpServers` object. Replace the example path with the absolute path to this checkout:

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

4. Save the configuration and restart Claude Desktop.
5. Confirm the MCP server is available in Claude before running a check.

For a staging site that requires authentication, start Chrome with remote debugging, sign in, and leave that window open:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

See [Setup](docs/setup.md) for alternate CDP endpoints and [Security](docs/security.md) for credential handling.

## How to use it in Claude

1. Copy a link to a specific Figma frame using **Copy link to selection**. The link should include a `node-id`.
2. Open the corresponding route in your local, preview, staging, or production-like build.
3. Tell Claude to compare the two links. Include the viewport, theme, locale, and any intentional exceptions when they matter.
4. Review the findings and the generated report in `~/Documents/Design QA/`.
5. Use `dismiss_finding` only for known, intentional exceptions; include a reason so the baseline remains understandable.

Sample prompt:

```text
Run design QA for this checkout page.

Figma frame: https://www.figma.com/design/FILE_KEY/Checkout?node-id=12-34
Live page: https://staging.example.com/checkout
Viewport: use the Figma frame width
Theme: light
Locale: en-US

Compare colors, font family, font size, font weight, and border radius. Treat near-token
deviations as high priority, explain which values are intentional versus likely hardcoded,
and generate the self-contained HTML report. If a dimension cannot be verified confidently,
call that out instead of guessing.
```

You can also start with the shorter form:

> Run design QA on `https://www.figma.com/design/FILE_KEY/File?node-id=12-34` against `https://staging.example.com/checkout`.

## Tune the check to your design system

The server can only judge what the selected frame proves. Results will be more useful when the frame is representative of the system and its values are bound to Figma variables or published styles. Depending on your design system, adjust the information you give Claude and the frame you select:

- use a frame that includes the relevant color, type, and radius vocabulary;
- specify the intended theme, breakpoint, locale, and font-loading state;
- mention product-specific exceptions such as third-party widgets, marketing illustrations, or intentionally bespoke display text;
- treat `not_verified` as a signal to improve the design evidence, not as a failed check;
- do not expect pixel-perfect matching when the design and build intentionally use different content or responsive states.

The comparison currently covers colors, font family loading, font sizes, font weights, and border radii. It does not validate copy, geometry, line-height, or pseudo-element styles.

## Export and share the result

The server creates a self-contained HTML report that can be opened offline. If you use Claude Cowork for the broader review workflow, ask it to read the report, summarize the highest-priority issues, and export the result as an HTML, DOC/DOCX, or PDF file for your team. For example:

> Review the generated design QA report. Preserve the finding values and occurrence counts, group issues by severity and design-system dimension, add a short executive summary, and export the final review as both an HTML file and a PDF. Do not include or repeat any API tokens, credentials, cookies, or private configuration values.

Review reports before sharing: they may contain private product copy, URLs, and screenshots from the build.

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
