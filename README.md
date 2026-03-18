# Ask Your Document — Gateway Chat with Agentic Loop

A hands-on exercise where you upload a PDF, wait for it to be indexed, and then ask questions about it through the TargetMCP Gateway's streaming Chat API. The Gateway's LLM agent calls the right tools automatically — you watch the agentic loop happen in real time via SSE events.

## Getting Started

1. Clone this repo
2. Open `index.html` in your browser — no build step, no dependencies, no server
3. Click **Run** to see Step 1 execute (and a prompt to implement the rest)

## File Structure

```
ask-your-document/
├── index.html      ← Page structure (no need to modify)
├── styles.css      ← UI styling (no need to modify)
├── helpers.js      ← Auth, API helpers, mock data, UI wiring (no need to modify)
└── loop.js         ← YOUR CODE GOES HERE (the agentic loop)
```

**You only need to edit `loop.js`.**

## What You Write

Open `loop.js` and look for the `TODO: YOUR CODE HERE` comments. Step 1 (Upload) is done for you as an example. You fill in Steps 2-4 (~20 lines total):

1. **Polling loop** — check ingestion status, wait, repeat until embeddings are ready
2. **Ask the Gateway** — send your question to `chatWithGateway()` with SSE callbacks that render each tool call the LLM agent makes
3. **Show the answer** — display the Gateway's composed response

The key difference from a traditional RAG loop: you do NOT call `vector_search_media` or `get_document_chunks` yourself. The Gateway's LLM agent decides which tools to call and calls them for you. You just watch the SSE events stream in.

## Mock Mode (default)

All API responses are embedded as mock data in `helpers.js`. No network, no server, no credentials needed. The loop runs with simulated delays so you can see each step animate in. **Start here.**

## Live Mode

Click the **Live** toggle in the header to switch to real API calls. You will need credentials from the Champion Portal workshop detail page:

- **Username** — your workshop login
- **Password** — your workshop password
- **Client Secret** — the TargetDMS client secret

The app authenticates with IDMS automatically to get a bearer token, uploads your PDF to TargetUMH, and streams the Gateway's chat response in real time.
