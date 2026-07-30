# How it works

You can think of the server as a small design-review assistant with four jobs:

1. **Read the Figma frame** and work out which colors, type styles, fonts, and radii look like part of the system.
2. **Read the live page** in the browser, including useful content inside shadow roots and same-origin iframes.
3. **Compare the two** while filtering out browser noise, hidden elements, inherited styles, and other things that should not become design feedback.
4. **Make a report** with grouped findings and useful screenshots.

The usual `run_design_qa` tool does all four. The smaller tools let you retry one part when needed.

## Why it does not guess

Some Figma files have rich variables and styles. Others are still being cleaned up. The server keeps a confidence level for each dimension and says `not_verified` when the frame does not provide enough evidence.

That is a feature: a short list of trustworthy feedback is more useful than a wall of false alarms.

Near matches are especially interesting. A color that is one channel away from the design color often means someone typed a value by hand. A completely different color may be a widget, an image, or an intentional state.

## Where the work happens

The browser session and run files stay local. By default they live under `~/.figma-live-design-qa-mcp/`. Old run data is cleaned up after 14 days and the run store is capped at 2 GB.

The server keeps the captured page open briefly so the report can take screenshots from the exact same render. It only closes browsers that it started itself.
