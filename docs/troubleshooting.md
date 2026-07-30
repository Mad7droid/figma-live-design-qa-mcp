# Troubleshooting

## “No Figma access token found”

Add `FIGMA_TOKEN` to the MCP server’s `env` block, then restart Claude Desktop. The token needs **File content: read** permission.

Do not put the token in a prompt, URL, source file, or shell history.

## “No frame selected”

In Figma, select the actual frame and use **Copy link to selection**. A link to the whole file does not tell the server which screen to use.

## Claude measured a login page

Start Chrome with remote debugging, sign in to the site in that Chrome window, and run the check again. A login-wall warning means the result is not a trustworthy read of the intended page.

## Claude cannot connect to Chrome

Check that Chrome was started with:

```bash
--remote-debugging-port=9222
```

If you use another port or machine, set `DESIGN_QA_CDP_PORT` or `DESIGN_QA_CDP_URL` in the MCP environment.

## Colors say `not_verified`

The Figma frame and page may be using different themes, or the frame may not show enough reliable color values. Check light/dark mode first, then try a more representative frame.

## The report has no screenshots

The browser session may have expired before `build_report` ran. Capture the build again and rebuild the report. The findings JSON is still useful.

## Tests fail after setup

Install the browser dependency and try again:

```bash
npx playwright install chromium
npm test
```
