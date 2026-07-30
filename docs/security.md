# Security and sensitive data

This tool can look at real product pages, so it is worth keeping the privacy basics simple and clear.

## Keep tokens private

- Put the Figma token in `FIGMA_TOKEN` or `FIGMA_PERSONAL_ACCESS_TOKEN` in the MCP configuration.
- Never commit tokens, passwords, cookies, private keys, browser profiles, or bearer headers.
- Never put credentials in Figma links, build links, screenshots, reports, prompts, issue descriptions, or logs.
- Use obvious placeholders such as `figd_your_token_here` in examples.
- If a credential is exposed, revoke and rotate it straight away. Deleting the file later is not enough.

The server reads the token in memory and uses it for Figma API requests. It does not write the token into reports, screenshots, run files, or baselines.

## Treat reports like product work

Reports can include private UI, copy, URLs, and screenshots. Give them the same care you would give a design file before sharing them outside your team.

The server’s temporary Chrome profile copy leaves out saved-password and autofill databases. Local run data and baselines are ignored by Git.

## Repository hygiene

`.env`, `.env.*`, credentials, private keys, reports, coverage, runs, baselines, `dist`, and `node_modules` are ignored. Before publishing changes, scan the staged files and review the staged diff.

The tool cannot protect a compromised computer or MCP client, so keep the machine and Claude configuration private.
