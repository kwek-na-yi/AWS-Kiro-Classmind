# Route Handlers — Node runtime only

Every Route Handler in this tree runs on the Node runtime (the App Router
default). Some declare it explicitly:

```ts
export const runtime = "nodejs";
```

## Why

The Route Handlers are the entire ClassMind backend, and things on that path
need Node APIs that the Edge runtime does not provide:

- **In-process text extraction.** PDF, TXT and Markdown material is parsed inside
  the handler, which needs Node buffers.
- **The local data store.** The default embedded store (`lib/store/local.ts`)
  reads and writes a file under `.classmind/` with `node:fs`.
- **The optional AWS adapter.** On the `aws` / `dynamodb-local` targets, DynamoDB
  and S3 are reached through the AWS SDK from server code.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sessions/join` | Join a class with a code and a display name |
| PUT | `/api/sessions/{sid}/profile` | Save understanding level and explanation style |
| GET | `/api/sessions/{sid}/recap` | The recap for the learner's profile |
| POST | `/api/sessions/{sid}/material` | Upload lecture material (multipart `file`) |
| POST | `/api/sessions/{sid}/quiz-sessions` | Start a six-question adaptive quiz |
| GET | `/api/sessions/{sid}/quiz-sessions/{qsid}/next` | The next (or pending) question |
| POST | `/api/sessions/{sid}/quiz-sessions/{qsid}/responses` | Answer a question |
| GET | `/api/sessions/{sid}/reports/{qsid}` | The learner's understanding report |
| GET | `/api/sessions/{sid}/insight` | Class Understanding Map and misconceptions |
| GET | `/api/sessions/{sid}/threads/{topicId}` | A topic's study thread |
| POST | `/api/sessions/{sid}/threads/{topicId}/explanations` | Contribute a peer explanation |
| POST | `/api/sessions/{sid}/explanations/{eid}/validate` | Check an explanation against the material |

Every learner route requires the `x-learner-id` header returned by `join`.
Every failure uses one envelope — `{ "error": { "code", "message", "field?" } }` —
with the codes listed in `lib/http/errors.ts`.
