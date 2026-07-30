# Troubleshooting

## Missing Figma token

Set `FIGMA_TOKEN` in the MCP client’s `env` block and restart the client. Use a token with **File content: read** permission. Do not put the token in a URL, source file, or shell history.

## No frame selected

Copy the link to a specific frame or pass `nodeId` separately. A file URL without a frame selection cannot define the viewport or token set.

## Login wall or wrong page measured

Start Chrome with CDP, sign in to the target site in that window, and rerun `capture_build`. A login-wall warning means the captured page should not be trusted as the target build.

## Chrome connection failure

Confirm Chrome is running with `--remote-debugging-port=9222`. For a custom endpoint, set `DESIGN_QA_CDP_PORT` or `DESIGN_QA_CDP_URL` in the MCP environment.

## Color dimension is not verified

The Figma frame and live page may be rendering different light/dark modes, or the frame may not contain enough reliable color evidence. Fix the mode or inspect the `notVerified` reason before treating the result as a failure.

## Report has no screenshots

The captured browser session may have expired before `build_report`. Rerun the build capture and report stages. The JSON findings remain usable even without crops.

## Tests fail after a clean install

Run `npx playwright install chromium`, then rerun `npm test`. The DOM and end-to-end suites use Chromium.
