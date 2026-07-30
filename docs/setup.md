# Setup

This page is for the first-time setup. Once this is done, most people can work entirely from Claude.

## What you need

- Node.js 20 or newer
- A Figma personal access token with **File content: read** permission
- Chromium installed through Playwright
- Claude Desktop, or another MCP client that can run a local server

## Install it

From the project folder:

```bash
npm install
npx playwright install chromium
npm run build
```

## Add it to Claude Desktop

Open **Settings → Developer → Edit Config** and add:

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

Replace the path and token placeholder, save the file, and restart Claude Desktop.

`FIGMA_PERSONAL_ACCESS_TOKEN` also works if that is the name your team already uses. The token is read from the environment only.

## Pages behind a login

Start Chrome with CDP enabled, sign in as usual, and leave that window open:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Use `DESIGN_QA_CDP_PORT` or `DESIGN_QA_CDP_URL` if Chrome is running somewhere else.

## Check the setup

```bash
npm test
npm run typecheck
npm run build
```
