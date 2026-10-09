# crystal-ball-backend

Express + TypeScript (strict) API for the **OomniEye Approvals assistant**, built for the Crystal Ball
*Sr. Fullstack Developer — MERN + AI (Wave 2)* take-home. It serves the approval queue and five AI
actions (Greeting, Summary, Talk, Help, Teach) backed by GPT-4o. Every action streams over SSE and falls back to a deterministic answer when the AI is unavailable.

The frontend is a separate repository (`crystal-ball-frontend`). The two repositories share no code and communicate only over HTTP.

## Submission note (AI-necessary vs. AI-unnecessary, fallbacks, next steps)

**Needs AI:** *Talk to me* (open-ended reasoning and follow-ups over the queue) and *Help me* phrasing
(turning retrieved policy text into a direct, cited answer). *Teach me* uses AI only to adapt
explanations to follow-ups; the steps themselves are fixed policy. *Present me Summary* uses AI for
ordering rationale and wording, but every fact in it is verified against the data.

**Doesn't need AI:** *Replay Greeting* — a template ("You have 4 pending approvals") is enough; the LLM only
adds variety and language support, so it is wired per the spec but the template is its fallback.
Retrieval, counting, ID checks and citation checks are deterministic code, never the model.

**Fallback design:** every call has an 8 s budget and errors are normalised to `timeout`, `provider_error`,
`missing_api_key` or `invalid_output`. Each action has a fallback built only from known data: count
greeting, policy-ordered summary, data-only chat answers, a verbatim policy section, the policy's
numbered steps. If no safe fallback exists, the API returns a retryable error rather than a guess.
Fallbacks are labelled in `done.source`, so the UI never presents them as AI output.

**With more time:** a Redis-backed rate limiter and session store for multi-instance deploys, prompt
evals with recorded fixtures per prompt version, and real auth to replace client session ids.

**AI tools:** built with Claude Code (Claude Opus 5.5) for scaffolding, tests and implementation. I
reviewed every change and kept the test-first commit history.

## Architecture

```
src/
  app.ts                 createApp(deps) — Express app without listen() (Supertest drives it)
  server.ts              wires env → data layer → OpenAI provider → app.listen
  config/                environment (Zod-validated env), database (optional MongoDB + fallback)
  schemas/               Zod contracts: requests, SSE events, summary, errors; contract.ts → JSON Schema
  routes/ controllers/   thin HTTP layer: per-IP limit → Zod validation → per-session limit → handler
  services/ai/           one service per action + openai.service (LlmService: timeouts, cancel, errors)
  services/rag/          policy chunking, keyword/IDF retriever, citation verification
  prompts/               versioned prompts: GREETING_PROMPT_V1 … TEACH_PROMPT_V1 (+ active aliases)
  repositories/          Approval (fixture | Mongo), Conversation (memory | Mongo) behind interfaces
  utils/                 SSE streaming helpers, deterministic fallbacks, JSON logger
  data/                  approvals.json (canonical seed), approval-policy.md (mock policy, RAG source)
```

Request flow for a streaming action:

```
POST /api/ai/chat → perIp limiter → validateBody(Zod) → perSession limiter
  → chat.prepare(): load queue + bounded history, build CHAT_PROMPT_V1
  → streamText(): SSE meta → delta… → done   (or result[fallback] → done / error)
  → onComplete: persist user + assistant turn (failures logged, never surfaced)
```

## API

All AI endpoints are `POST`, take JSON, and respond with `text/event-stream`. A request that fails
before streaming starts (validation, rate limit, unknown route, oversized or malformed body) gets a
JSON error instead:

```json
{ "error": { "code": "validation_error | rate_limited | not_found | internal_error", "message": "…", "details": [{ "path": "sessionId", "message": "…" }] } }
```

| Endpoint | Body | Stream |
|---|---|---|
| `GET /api/health` | – | `{ "status": "ok", "ai": "configured" \| "fallback-only" }` |
| `GET /api/approvals` | query: `q`, `type`, `submittedBy`, `status`, `page`, `pageSize` | `{ approvals, total, page, pageSize, pageCount, pendingCount, facets, source }` (see below) |
| `POST /api/ai/greeting` | `{ sessionId, language? }` | `meta → delta… → done` |
| `POST /api/ai/summary` | `{ sessionId, language? }` | `meta → result{kind:"summary"} → done` (no deltas: JSON is buffered and validated first) |
| `POST /api/ai/chat` | `{ sessionId, message, language? }` | `meta → delta… → done` |
| `POST /api/ai/help` | `{ sessionId, message, language? }` | `meta{sources} → delta… → done{citedSources}` |
| `POST /api/ai/teach` | `{ sessionId, message, language? }` | `meta{sources} → delta… → done{citedSources}` |

**Approvals query.** Filtering, search and pagination are done on the server: in MongoDB (`$in` filters, an escaped case-insensitive regex for search, `skip`/`limit`, and a `$facet` aggregation) or over the fixture with the same rules.
- `q`: up to 100 characters. It matches the title, submitter or type.
- `type`, `submittedBy`, `status`: list filters, given comma-separated (`type=pdf,video`) or repeated. Values within one filter are OR'd; different filters are AND'd.
- `page`: 1 or higher. A page past the end is clamped to the last page, and the response reports the page actually returned.
- `pageSize`: 1–50, default 10.
- Unknown params or invalid values get a JSON 400.
- `facets` (`{ type, submittedBy, status }`, each a list of `{ value, count }`) and `pendingCount` describe the whole queue, so filter menus stay stable while filters change.

- `sessionId`: `^[A-Za-z0-9_-]{8,64}$`, generated by the client. It groups history and keys rate limits. It is **not** authentication.
- `language`: an optional BCP-47 tag such as `es` or `hi-IN`. The answer is written in that language.
- `message`: trimmed, 1–1000 characters. Request bodies are capped at 16 KB, and unknown fields are rejected.

SSE events (`event: <name>\ndata: <json>\n\n`):

| Event | Payload |
|---|---|
| `meta` | `{ action, requestId, sources? }` — `sources` are retrieved policy chunk ids (deterministic) |
| `delta` | `{ text }` — next tokens |
| `result` | `{ kind: "text", text }` replaces any partial deltas with a fallback, or `{ kind: "summary", summary }` |
| `error` | `{ code: "ai_unavailable" \| "internal_error", message, retryable }` — terminal |
| `done` | `{ source: "ai" \| "fallback", fallbackReason?, citedSources? }` — terminal |

Summary shape: `{ pendingCount, overview, priorityItems: [{ approvalId, title, reason }], recommendations[], orderingNote }`.

The full contract is exported as JSON Schema to [`contract/api-contract.json`](contract/api-contract.json).
`tests/unit/contract.test.ts` fails if the Zod schemas change without re-exporting. The frontend
keeps a copy and its own contract test fails if its schemas drift.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `FRONTEND_URL` | `http://localhost:3000` | The only origin that receives CORS headers |
| `MONGODB_URI` | *(empty)* | Optional. Leave it empty to use the JSON fixture and in-memory history |
| `OPENAI_API_KEY` | *(empty)* | Without it, every AI action returns its labelled fallback |
| `OPENAI_MODEL` | `gpt-4o` | |
| `LLM_TIMEOUT_MS` | `8000` | Per-call budget (see "Timeouts") |

## Setup

```bash
cp .env.example .env      # add OPENAI_API_KEY (and optionally MONGODB_URI)
npm install
npm run dev               # http://localhost:4000
```

Production: `npm run build && npm start`.

### MongoDB Atlas (optional)

MongoDB is an **optional enhancement** beyond the assignment's minimum requirements.

1. Create a free **M0** cluster, a database user, and allow your IP under Network Access.
2. Set `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/crystal-ball` in `.env`.
3. Run `npm run seed`. It upserts the four approvals by `id`, so it is idempotent: re-running it never creates duplicates.
4. Run `npm run dev`. The startup log shows `approvals: "mongodb"`, and conversations are stored in the `conversations` collection.

Collections:
- `approvals`: `id, title, type, submittedBy, status, submittedDateLabel, createdAt, updatedAt`
- `conversations`: `sessionId, actionType, messages[{ role, content, timestamp }], createdAt, updatedAt`. There is one document per (session, action), capped at 20 messages via `$push`/`$slice`.

Only user and assistant turns are stored; system prompts and credentials never are. If `MONGODB_URI` is missing or the connection fails, the API logs a warning (without the URI), serves `approvals.json`, and keeps history in memory. Losing history storage mid-conversation is logged and the chat continues.

## AI integration

- The **OpenAI Node SDK** with `gpt-4o` is called only from the server, and the key never leaves it. `createOpenAiProvider` is a thin seam, and tests swap it for `FakeProvider`.
- **`LlmService`** wraps the provider and owns the reliability rules: timeouts, cancellation through `AbortController` when the client disconnects or presses Stop, and error normalisation. A provider that ignores the abort signal still can't hang a request, because every await is raced against the abort.
- **Prompts** live in `src/prompts/*.prompt.ts` as `*_PROMPT_V1` exports. Each one declares its version, `maxTokens` and temperature. Services import the active alias (`CHAT_PROMPT = CHAT_PROMPT_V1`), so bumping a version is a one-line change.
- **Prompt-injection awareness:**
  - User text only ever goes in `user` turns.
  - Queue data and policy text sit inside `<approval_queue>`/`<policy>` tags, which the model is told are data, not instructions.
  - Approval records are serialised as JSON.
  - The assistant is told it cannot approve or reject anything, and it has no tools that could.
- **Structured output (Summary):**
  1. The request uses JSON mode.
  2. The raw text goes through `JSON.parse` and then the strict `SummaryModelOutputSchema`.
  3. Deterministic checks follow: `pendingCount` must equal the real count, and every `approvalId` must exist and be unique.
  4. Titles and the "suggested order, not official urgency" note are added by the server, not the model.
  5. Any failure returns the factual fallback, labelled `invalid_output`. No regex parsing is involved.
- **Verification limits:** Help and Teach answers are checked so that citations point at chunks the model was actually given (`done.citedSources`). These checks can't prove a free-text answer is correct. They only catch structural and grounding errors cheaply. No second LLM acts as a verifier.

### RAG (Help me)

`approval-policy.md` is a 4-chunk mock policy (about 320 words), written for this assignment and clearly marked as **not** an OomniEye policy. The pipeline:

1. `tokenize` the question: lower-case it, drop stop words, and apply light stemming.
2. Score chunks by keyword overlap × IDF, counting headings twice, and keep the top 2.
3. Build `HELP_PROMPT_V1` with only those chunks, or with an explicit "no relevant sections found" note when nothing matches.
4. Stream the answer, which cites `[policy-N]`.
5. Verify the citations against the retrieved ids.

A purely referential follow-up such as "and what about that?" reuses the previous question's terms for retrieval. There are no embeddings and no vector database: with 4 chunks, keyword/IDF retrieval is transparent, deterministic and unit-testable.

### Timeouts and fallbacks

**Assumption:** a complete streamed GPT-4o answer can take longer than 8 s to arrive, so a hard 8 s total cap would cut off normal answers. Streams therefore get three limits:
- **8 s to the first token**
- **8 s maximum silence between tokens**
- a 30 s overall cap

Non-streaming calls (Summary) get a strict 8 s total. Every limit ends in a fallback or a retryable error, never a hung request or a raw 500.

| Action | Fallback |
|---|---|
| Greeting | `Welcome back. You have N pending approvals.` (N from the data) |
| Summary | Factual summary: safety-related items first (policy-3), then queue order |
| Chat | Answers only counts, lists and "who submitted X" from the data; otherwise a retryable `error` |
| Help | The best retrieved policy section, quoted verbatim, or "couldn't find a section…" |
| Teach | The policy's numbered review steps (no fallback if the policy has none) |

If a stream fails partway through, the fallback arrives as `result{kind:"text"}`, which tells the client to replace the partial text.

### Rate limiting

`express-rate-limit` runs only on `/api/ai/*` and has two layers:
- **Per IP:** 60/min. This runs first and bounds clients that rotate session ids.
- **Per session:** 20/min, applied after validation so the key is well-formed.

Limited requests get a JSON `429` before any LLM call. The in-memory store is fine for a single instance; several instances would need Redis.

## Testing

```bash
npm test                  # all Jest tests (unit + Supertest integration), no network, no API credits
npm run test:unit
npm run test:integration
npm run typecheck && npm run lint && npm run build
```

Tests run against `FakeProvider`, which can stream chunks, hang forever while ignoring abort, throw, or fail mid-stream. They are built to catch a broken AI response shape or a silent provider failure:
- Malformed JSON, prose instead of JSON, missing or extra fields, unknown or duplicate ids, a wrong count, or an empty response must all produce the fallback.
- A stalled provider times out at exactly 8 s (fake timers).
- Every endpoint is tested without an API key and with a stalled provider.
- SSE payloads are validated against the published contract in every integration test.
- Also covered: rate limits, CORS, oversized and malformed bodies, session isolation, and a history-store outage.

The git history shows each feature as a failing-test commit followed by its implementation commit.
