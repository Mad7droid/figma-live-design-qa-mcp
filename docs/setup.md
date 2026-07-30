# Setup

## Requirements

- Node.js 20 or newer
- A Figma personal access token with **File content: read** permission
- Chromium installed through Playwright
- Claude Desktop or another MCP client that supports local stdio servers

Install and build:

```bash
npm install
npx playwright install chromium
npm run build
```

## Configure the MCP client

Use an absolute path to `dist/index.js`:

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

`FIGMA_PERSONAL_ACCESS_TOKEN` is also accepted for compatibility. The token is read from the process environment only.

## Authenticated staging sites

Start Chrome with CDP enabled, sign in normally, and leave that window running:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Set `DESIGN_QA_CDP_PORT` or `DESIGN_QA_CDP_URL` only when Chrome is using a different endpoint.

## Local validation

```bash
npm test
npm run typecheck
npm run build
```
