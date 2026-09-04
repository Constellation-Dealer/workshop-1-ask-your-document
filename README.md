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

## The PDF you bring

### 🔴 One corpus, everyone's documents

**Everyone in this workshop signs in as the same dealer, and every upload lands in the same shared
corpus.** There is no per-person partition in this exercise. Whatever you upload can be retrieved
and quoted back, word for word, in the answer to somebody else's question — and theirs in yours.

So: **do not upload anything you would not hand round the room.** No customer data, no contracts,
no internal financials, nothing under NDA.

What works well instead: an **equipment manual**, a **spec sheet**, or any **public PDF** you like.
The exercise only needs a document with real text in it, and one you know well enough to tell a
good answer from a plausible one.

Naming the file distinctively — `compact-tractor-manual-yourname.pdf` — makes it easier to ask a
question you know only your document answers. That is a **retrieval aid, not a control**: it helps
you steer your own question, it keeps nobody else out. Your upload now carries a tag with your name
on it as well — see *Your own corner of the corpus* below — which is a better retrieval aid and
still not a control.

## Your own corner of the corpus

The warning above stays true: one dealer, one corpus, nothing you upload is private to you. This is
the other half of it. Within a shared corpus, your upload can still say which of us put it there.

TargetUMH lets a file be **tagged with an entity** — a type and an id, stored next to the file — and
the retrieval tool can filter on it. That is not a workshop invention. Of this dealer's roughly
3,400 documents, about 2,400 already carry such a tag, and the platform's OEM manual lookup filters
on exactly `entityType="Model"`. This exercise was one of the few things not using it, so every
question you asked searched all 3,400 documents at once.

Now it uses it. Two things changed, and they are **not the same kind of thing**.

**On upload — enforced.** `uploadPdf` now sends `entityType: "Model"` and `entityId: <your handle>`
along with the file. TargetUMH records the tag, and rejects the upload with a 400 if only one of the
pair arrives — so they always travel together. Your handle comes from `participantEntityId()` in
`helpers.js`: the local part of the IDMS username already in your `.env`, lowercased and normalised,
so `first.last@…` becomes `first-last`. Nothing new to configure and no extra credential. It is the
same every run, which is what lets today's run find what you uploaded yesterday. The connection
panel at the top of the page shows the tag you will get.

**On the question — steered, not enforced.** The same entity goes to the Gateway with your question.
But the Gateway's *agent* chooses the tool arguments, and it is free to leave yours out. The entity
is a request, not a filter. Retrieval usually narrows to your own document. It is not guaranteed to.

### The observable

So how do you know which of those happened? Not from the answer — a good answer looks the same
either way.

The trace now carries a **Retrieval scope** card under the Gateway step, and it prints the arguments
the agent *actually* passed to the media tools.

Green means every search of the corpus it ran carried your `entityType`/`entityId` — or that it did
not need to search at all, because it went straight to your document by its id, which is narrower
still.

Red means at least one search did not carry it, and there are two ways to be red. Either none of
them did, or, the one worth watching for, **some did and some did not**. A turn is not one search:
the agent can run several and it does not have to treat them alike. The card calls that case
**MIXED**, and then names the searches that went out wide, because those are the ones that read
everybody's documents.

A red card is not a bug in your loop. It is what "steered, not enforced" looks like from outside.

Calls that could never have carried the entity are left out of the verdict: fetching a document by
its id is already narrower than any entity could make it, a tool that reads the list of entity
*names* is not reading documents at all, and a tool on another server never touched this corpus in
the first place. The card judges the searches the entity could actually have narrowed — a red card
on a run that was scoped would teach you the wrong thing just as surely as a green one on a run that
was not.

Case does not count against you either way. TargetUMH matches an entity type and id without regard
to case, so if the agent writes back `model` or `First-Last`, that is still your document and the
card still counts it as scoped.

That card is the only place those arguments show up. The `tool_start` event the tool card is drawn
from carries the tool's *name* and a description and nothing else; the arguments do not reach the
page until the turn is over, on the `complete` event.

Worth doing once: ask something only your document answers and read the card. Then ask something
only somebody else's document could answer, and read it again.

### Still not a privacy control

Tagging changes what gets **retrieved**. It does not change what can be **reached**. Your document
is still in the shared corpus, still readable by everyone in the cohort, and a question asked
without the scope — or an agent that ignores it — will still find it. **The warning above is the one
that governs what you upload.**

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

## The skill shaping these answers

Every answer you get in this exercise passes through a **system skill** — a short markdown file,
stored on the platform, prepended to the model's instructions. It is not part of this repo and you
do not need to touch it to finish the exercise. It is here because it is worth seeing.

This workshop's is **`workshop-1-answer-style`**. It asks for a short paragraph plus a `Source:`
line naming the document the answer
came from, and tells the model to say so plainly when the documents do not contain the answer.

### 🔴 One skill, everyone's answers — so read it, do not edit it

**There is one copy, shared by every participant in this workshop, and there is no reset.** An edit
changes the answers *everyone* gets, immediately. That is not a bug to route around; it is what a
system skill is.

This exercise is pre-work: people do it alone, over several days, with nobody to announce a change
to. Edit the skill on the Tuesday and the person who runs the exercise on the Wednesday gets answers
shaped by your experiment with no way of knowing that is what happened — they will read it as how
the platform behaves. **So for the pre-work, treat it as read-only: open it, read the markdown, see
what it is doing to the answers you are getting, and do not save or publish.**

Version history is kept, so a bad edit is recoverable — but only by somebody who notices, and
nobody working through this alone will.

### Seeing it

1. Open <https://dev-dealeriq.csidealer.com>.
2. Sign in with the **email and password you were sent** — the same credential that opens the
   Champion Portal and the one in your `.env`. Use the email/password form, not *Sign in with
   Microsoft*.
3. Go to **Skills** and find this workshop's. Your account is scoped to the workshop, so the list
   is short.
4. Open `workshop-1-answer-style` and read it. The markdown you see is exactly what shapes your
   answers — the length, the `Source:` line, what to do when the documents do not contain the
   answer. Then leave it as you found it.

This one is **published already**, so it is live for you from the start.

### On the day: things worth trying

Save these for the live session, where you can say "I am about to change the skill" out loud before
you save it, and say when you have put it back. Editing is edit, save, then **publish** — an
unpublished edit changes nothing.

- Delete the trailing `- workshop-1-answer-style` line and re-run. Nothing marks the answers any
  more, and you cannot tell whether the skill applied — which is why that line is there.
- Ask for something the tools cannot answer, then change the instruction about what to do when the
  answer is not available. That one line is the difference between a useful assistant and a
  confident wrong one.
- Look at **version history**. Every save is a version with an author, which is how you find out
  who changed the room's answers.

> At most **two** skills are injected into any one request, which is why only one of the three
> workshop skills is published at a time. If yours is a draft, publishing it is step one.

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
