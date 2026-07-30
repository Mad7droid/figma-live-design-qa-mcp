# Figma Live Design QA MCP

Figma Live Design QA MCP helps you answer a simple question:

**Does the page we built still look and feel like the design?**

Give it a Figma frame and a live page. It checks the design details that should match — colors, type, fonts, and corner radii — then gives you a shareable HTML report.

It is made for designers, design engineers, and frontend teams who want a quick way to catch “almost right” details before handoff or release. You do not need to be a developer to use the actual QA workflow. A little setup is needed the first time.

## What it checks

- Colors and near-match colors
- Font family loading
- Font sizes and weights
- Border radii, including pills
- Repeated issues, with useful locations in the page
- A report with design and build screenshots where available

It does not do a pixel-perfect screenshot diff. That is intentional: Figma often uses placeholder content while the real page uses live data, so pixel diffs can create a lot of noise.

## Setup

You only need to do this once.

### 1. Install the project

You need Node.js 20 or newer. From this folder, run:

```bash
npm install
npx playwright install chromium
npm run build
```

### 2. Create a Figma token

Create a Figma personal access token with **File content: read** permission. You will add it to Claude’s configuration in the next step.

Keep it private: do not paste it into a Figma URL, a prompt, a screenshot, or a GitHub file. See [Security](docs/security.md).

### 3. Add the server to Claude Desktop

1. Open Claude Desktop.
2. Go to **Settings → Developer → Edit Config**.
3. Add this inside the `mcpServers` object. Replace the example path with the real path to this project:

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

4. Save the file and restart Claude Desktop.
5. Check that Claude can see the Figma Live Design QA tools.

### 4. If your site needs a login

Start Chrome with remote debugging, sign in to your staging site in that window, and leave it open:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

The server reuses that signed-in session. It does not ask for or store your password. More setup details are in [Setup](docs/setup.md).

## How to use it in Claude

1. In Figma, select the frame you want to check and choose **Copy link to selection**.
2. Open the matching page in your local, preview, or staging build.
3. Paste both links into Claude and ask for a design QA check.
4. Tell Claude about anything important: viewport, theme, locale, or intentional exceptions.
5. Open the HTML report from `~/Documents/Design QA/`.

### Sample prompt

```text
Run design QA for this checkout page.

Figma frame: https://www.figma.com/design/FILE_KEY/Checkout?node-id=12-34
Live page: https://staging.example.com/checkout
Viewport: use the Figma frame width
Theme: light
Locale: en-US

Compare the colors, font family, font size, font weight, and border radius. Highlight
near-token differences as likely hardcoded drift, explain what looks intentional, and
generate the self-contained HTML report. If a dimension cannot be checked confidently,
say that clearly instead of guessing.
```

Short version:

> Run design QA on `https://www.figma.com/design/FILE_KEY/File?node-id=12-34` against `https://staging.example.com/checkout`.

If one stage has a problem, Claude gets a `runId` so it can retry that stage instead of starting over.

## Make it fit your design system

The quality of the result depends on the frame you choose. Think of the Figma frame as the reference board for the check.

- Pick a frame that shows the colors, type styles, and radii you care about.
- Make sure important values are connected to Figma variables or published styles when possible.
- Tell Claude which theme, breakpoint, locale, and font-loading state to use.
- Call out things that are intentionally different, like third-party widgets or bespoke marketing artwork.
- If a dimension says `not_verified`, it means there was not enough design evidence to make a fair call — not that the page failed.

The check currently covers colors, font loading, font sizes, font weights, and border radii. It does not check copy, layout geometry, line-height, or pseudo-element styles.

## Share the result

The report is a self-contained HTML file you can open without the app running. If you use Claude Cowork for review and handoff, ask it to read the report, summarize the biggest issues, and export the review as HTML, DOC/DOCX, or PDF.

For example:

> Review the design QA report. Group the findings by severity and design-system dimension, keep the original values and occurrence counts, add a short summary for designers and product, and export the review as an HTML file and a PDF. Do not include API tokens, cookies, credentials, or private configuration values.

Please review reports before sharing. They can contain private product copy, URLs, and screenshots from the build.

## The tools, in plain English

| Tool | What it does |
| --- | --- |
| `run_design_qa` | Does the whole check in one go. This is the usual starting point. |
| `capture_design` | Reads the selected Figma frame. |
| `capture_build` | Reads the live page in your browser session. |
| `check_tokens` | Compares the page values with the design values. |
| `build_report` | Creates the HTML report and JSON details. |
| `dismiss_finding` | Remembers a known, intentional exception for that Figma file. |

## Where files go

- Reports: `~/Documents/Design QA/`
- Run details: `~/.figma-live-design-qa-mcp/runs/`
- Dismissed findings: `~/.figma-live-design-qa-mcp/baselines/`

You can change these locations with `DESIGN_QA_HOME` and `DESIGN_QA_REPORT_DIR`.

## For the technical folks

```bash
npm test
npm run typecheck
npm run build
```

The project is a local stdio MCP server. It uses Playwright to read the live page, stores detailed run data locally, and keeps the model response compact so large DOM trees do not flood the conversation.

More detail:

- [Setup](docs/setup.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)

## A few things to know

- Figma and the live page can use different content and still pass the useful parts of the check.
- Cross-origin iframe contents are skipped.
- A light/dark mode mismatch can make color comparison `not_verified`.
- The Variables REST endpoint is Enterprise-only; the server also works from bound values and repeated values in other plans.

## License

MIT License

Copyright (c) 2026 Madhav M Nair

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. 

IN NO EVENT SHALL THE AUTHOR OR COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
