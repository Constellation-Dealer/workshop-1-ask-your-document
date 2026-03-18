# Ask Your Document — RAG with Agentic Loop

A hands-on exercise where you build an agentic loop that uploads a PDF, waits for it to be indexed, and answers questions about it using semantic search.

## Getting Started

1. Clone this repo
2. Open `index.html` in your browser — no build step, no dependencies, no server
3. Click **Run** to see Step 1 execute (and a prompt to implement the rest)

## File Structure

```
ask-your-document/
├── index.html      ← Page structure (no need to modify)
├── styles.css      ← UI styling (no need to modify)
├── helpers.js      ← API helpers, mock data, UI wiring (no need to modify)
└── loop.js         ← YOUR CODE GOES HERE (the agentic loop)
```

**You only need to edit `loop.js`.**

## What You Write

Open `loop.js` and look for the `TODO: YOUR CODE HERE` comments. Step 1 (Upload) is done for you as an example. You fill in Steps 2–5 (~20 lines total):

1. **Polling loop** — check status, wait, repeat until embeddings are ready
2. **Semantic search** — call `vector_search_media` with the user's question
3. **Chunk retrieval** — call `get_document_chunks` with the matched indexes
4. **Compose answer** — format chunks with page citations

Each TODO tells you exactly which helper function to call and what arguments to use.

## Mock Mode (default)

All API responses are embedded as mock data in `helpers.js`. No network, no server, no credentials needed. The loop runs with simulated delays so you can see each step animate in. **Start here.**

## Live Mode

Click the **Live** toggle in the header to switch to real API calls against TargetUMH DEV. You'll need to paste a Bearer token from the Champion Portal. Upload a real PDF (up to 10 MB), get real AI-powered vector embeddings, and do real semantic search.
