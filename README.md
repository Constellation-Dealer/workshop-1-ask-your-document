# Ask Your Document — Gateway Chat with Agentic Loop

A hands-on exercise where you upload a PDF, wait for it to be indexed, and then ask questions about it through the TargetMCP Gateway's streaming Chat API. The Gateway's LLM agent calls the right tools automatically — you watch the agentic loop happen in real time via SSE events.

## Getting Started

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your credentials (from the Champion Portal → Workshop Details)
3. Open `index.html` in your browser — no build step, no dependencies, no server
4. Click **Run** to see Step 1 execute (and a prompt to implement the rest)

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
