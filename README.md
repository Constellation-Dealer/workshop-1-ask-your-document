# Ask Your Document — RAG with Agentic Loop

A hands-on exercise where you build an agentic loop that uploads a PDF, waits for it to be indexed, and answers questions about it using semantic search.

## Getting Started

Open `index.html` in your browser. That's it — no build step, no dependencies, no server.

## Mock Mode (default)

All API responses are embedded in the page as JSON data. No network, no server, no credentials needed. The loop runs instantly with simulated delays so you can see each step animate in. **Start here** to learn the loop pattern without any setup friction.

## Live Mode

Click the "Live" toggle in the header to switch to real API calls against TargetUMH DEV. You'll need to paste a Bearer token from the Champion Portal. Upload a real PDF (up to 10 MB), get real AI-powered embeddings, and do real semantic search — same code, real infrastructure.

## What You Write

Look for the `// YOUR CODE HERE` comments in the `<script>` block of `index.html`. Step 1 (Upload) is done for you. You fill in Steps 2-5 (~20 lines total):

1. **Polling loop** — check status, wait, repeat until embeddings are ready
2. **Semantic search** — call `vector_search_media` with the user's question
3. **Chunk retrieval** — call `get_document_chunks` with the matched indexes
4. **Compose answer** — format chunks with page citations
