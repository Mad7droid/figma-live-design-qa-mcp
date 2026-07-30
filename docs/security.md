# Security and sensitive data

## Credential handling

- Store Figma credentials in `FIGMA_TOKEN` or `FIGMA_PERSONAL_ACCESS_TOKEN` in the MCP client environment.
- Never commit tokens, passwords, cookies, private keys, browser profiles, or bearer headers.
- Never include credentials in Figma URLs, build URLs, screenshots, reports, issue descriptions, or logs.
- Use unmistakable placeholders such as `figd_your_token_here` in documentation and tests.
- If a credential is ever committed or exposed, revoke and rotate it immediately; removing it from the latest file is not enough.

The server reads the token from memory and sends it only in the Figma API request. It does not write the token to run artifacts, reports, screenshots, or baselines.

## Local data

Reports can contain private product UI, text, URLs, and screenshots. Review them before sharing. Run artifacts and baselines are local state and are ignored by Git. Chrome profile copies are temporary and exclude saved-password and autofill databases.

## Repository hygiene

`.env`, `.env.*`, credentials, private keys, reports, coverage, runs, baselines, `dist`, and `node_modules` are ignored. Before publishing changes, scan staged files and history for key-shaped strings and review the staged diff.

The repository does not provide security guarantees for a compromised workstation or MCP client. Protect the machine and keep the MCP configuration private.
