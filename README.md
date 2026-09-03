# Ask Your Document — Gateway Chat with Agentic Loop

A hands-on exercise where you upload a PDF, wait for it to be indexed, and then ask questions about it through the TargetMCP Gateway's streaming Chat API. The Gateway's LLM agent calls the right tools automatically — you watch the agentic loop happen in real time via SSE events.

## Getting Started

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your credentials (from the Champion Portal → Workshop Details)
3. Make sure Node.js LTS is installed
4. Run `npx --yes http-server . -a localhost -p 3000 -c-1`
5. Open `http://localhost:3000`

> **If the page does not load, or a call fails with `Failed to fetch`:** something else on your
> machine is already using port 3000.
>
> 1. **Most likely it is the previous workshop.** All three exercises serve on 3000, and they run
>    one after another — so the server you started an hour ago still has it. Go back to that
>    terminal and press **Ctrl+C**, then start this one again.
> 2. **Otherwise, find out what has it:** `lsof -nP -iTCP:3000 -sTCP:LISTEN` (macOS/Linux) or
>    `netstat -ano | findstr :3000` (Windows).
> 3. **If it is something you need to keep running,** use 5173 instead — it is allowlisted too:
>
>    ```
>    npx --yes http-server . -a localhost -p 5173 -c-1
>    ```
>
>    then open <http://localhost:5173>. Be aware 5173 is Vite's default port, so it may well be
>    taken as well; 3000 with the previous server stopped is the more reliable route.
>
> **Open the `localhost` address, not the `127.0.0.1` one** that some servers also print.
> `127.0.0.1` is a *different* origin as far as the browser is concerned, and it is not
> allowlisted — so that link fails in exactly the same way as a wrong port.



6. Click **Run the loop** to see Step 1 execute (and a prompt to implement the rest)

> **Do NOT open `index.html` directly as a file** (`file://...`). A `file://` page has no HTTP
> origin at all, so every API call is refused — this is about serving over HTTP, not about which
> port you pick. Both `http://localhost:3000` and `http://localhost:5173` are allowlisted.

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

1. **Polling loop** — check ingestion status, wait, repeat until embeddings are ready.
   Wait only while `isIngestionInFlight(...)` is true; every other status is terminal.
   Bring a PDF whose text you can select in a reader — TargetUMH answers `Skipped` for a
   scan with no text layer, and there is then nothing for the agent to retrieve.
2. **Ask the Gateway** — send your question to `chatWithGateway()` with SSE callbacks that render each tool call the LLM agent makes
3. **Show the answer** — display the Gateway's composed response

The key difference from a traditional RAG loop: you do NOT call `vector_search_media` or `get_document_chunks` yourself. The Gateway's LLM agent decides which tools to call and calls them for you. You just watch the SSE events stream in.

## Configuration

All configuration is in `.env`. See `.env.example` for the full list of values including API endpoints, credentials, and dealer context.

## Local Serving

This app should be served from `http://localhost:3000`.

That port is on the DEV CORS allowlist for **all three** services this page calls — IDMS for the
token, the Gateway for the chat, and TargetUMH for the upload and the ingestion poll. The third one
is easy to forget: a port allowlisted on IDMS and the Gateway but not on UMH lets you sign in and
then fails at upload. `http://localhost:5173` is the only other origin all three accept.


That matches the DEV CORS allowlist and gives the browser a real HTTP origin for loading `.env`, JavaScript, and CSS. Opening `index.html` directly via `file://` is not the intended setup.

Use this command:

```bash
npx --yes http-server . -a localhost -p 3000 -c-1
```

## Node.js Setup

If Node.js is not already installed, install the current LTS release from [nodejs.org](https://nodejs.org/en/download).

If you are using a coding agent, the easiest path is to ask it to do the setup for you. Example prompt:

```text
Install Node.js LTS if it is not already installed, then start this app on http://localhost:3000 using:
npx --yes http-server . -a localhost -p 3000 -c-1
After that, verify the page loads successfully.
```
