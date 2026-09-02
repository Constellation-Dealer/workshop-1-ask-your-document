# Ask Your Document — Gateway Chat with Agentic Loop

A hands-on exercise where you upload a PDF, wait for it to be indexed, and then ask questions about it through the TargetMCP Gateway's streaming Chat API. The Gateway's LLM agent calls the right tools automatically — you watch the agentic loop happen in real time via SSE events.

## Getting Started

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your credentials (from the Champion Portal → Workshop Details)
3. Make sure Node.js LTS is installed
4. Run `npx --yes http-server . -a localhost -p 3001 -c-1`
5. Open `http://localhost:3001`

> **If the page does not load, or sign-in fails with `Failed to fetch`:** something else on your
> machine already owns the port. Try `3000` instead — it works too. (Vite's defaults `5173`/`5174`
> are the usual culprits, which is why this workshop is not on them.) Check who has it with
> `lsof -nP -iTCP:3001 -sTCP:LISTEN` (macOS/Linux) or `netstat -ano | findstr :3001` (Windows).
>
> **Open the `localhost` address, not the `127.0.0.1` one** that some servers also print. Only
> the `localhost` spelling is allowed, so the `127.0.0.1` link fails in exactly the same way as
> a wrong port.


6. Click **Run the loop** to see Step 1 execute (and a prompt to implement the rest)

> **Do NOT open `index.html` directly as a file** (`file://...`). The APIs will reject requests that don't come from `http://localhost:3001`.

## File Structure

```
ask-your-document/
├── .env.example    ← Copy to .env and fill in credentials
├── index.html      ← Page structure (no need to modify)
├── styles.css      ← UI styling (no need to modify)
├── helpers.js      ← Auth, API helpers, UI wiring (no need to modify)
└── loop.js         ← YOUR CODE GOES HERE (the agentic loop)
```

**You only need to edit `loop.js`.**

## What You Write

Open `loop.js` and look for the `TODO: YOUR CODE HERE` comments. Step 1 (Upload) is done for you as an example. You fill in Steps 2-4 (~20 lines total):

1. **Polling loop** — check ingestion status, wait, repeat until embeddings are ready
2. **Ask the Gateway** — send your question to `chatWithGateway()` with SSE callbacks that render each tool call the LLM agent makes
3. **Show the answer** — display the Gateway's composed response

The key difference from a traditional RAG loop: you do NOT call `vector_search_media` or `get_document_chunks` yourself. The Gateway's LLM agent decides which tools to call and calls them for you. You just watch the SSE events stream in.

## Configuration

All configuration is in `.env`. See `.env.example` for the full list of values including API endpoints, credentials, and dealer context.

## Local Serving

This app should be served from `http://localhost:3001`.

That matches the DEV CORS allowlist and gives the browser a real HTTP origin for loading `.env`, JavaScript, and CSS. Opening `index.html` directly via `file://` is not the intended setup.

Use this command:

```bash
npx --yes http-server . -a localhost -p 3001 -c-1
```

## Node.js Setup

If Node.js is not already installed, install the current LTS release from [nodejs.org](https://nodejs.org/en/download).

If you are using a coding agent, the easiest path is to ask it to do the setup for you. Example prompt:

```text
Install Node.js LTS if it is not already installed, then start this app on http://localhost:3001 using:
npx --yes http-server . -a localhost -p 3001 -c-1
After that, verify the page loads successfully.
```
