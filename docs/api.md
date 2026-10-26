# API reference

The Next.js Route Handlers under `app/api/` are the whole ClassMind backend.
Every learner-facing handler runs the same pipeline (`lib/http/pipeline.ts`);
the admin reset endpoint is a small standalone handler.

```
parse → authorise → validate → read → compute → generate → write → project
```

`project` is the only stage that produces a response, so every field that
reaches a client passes through an explicit projection — that is where learner
identities are kept out of class-level data.

All handlers run on the Node.js runtime: PDF extraction, the local file store
and the PostgreSQL driver need Node APIs.

## Authentication

There are no accounts. `POST /api/sessions/join` returns an opaque `learnerId`
scoped to one class; every other learner route requires it in the
`x-learner-id` header and checks membership of that class. A learner can read
only their own quiz sessions and reports.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/sessions/join` | Join a class with a class code and a display name |
| PUT | `/api/sessions/{sid}/profile` | Save understanding level and explanation style |
| GET | `/api/sessions/{sid}/recap` | The recap for the learner's profile |
| POST | `/api/sessions/{sid}/material` | Upload lecture material (multipart `file`; PDF, TXT, MD) |
| POST | `/api/sessions/{sid}/quiz-sessions` | Start a six-question adaptive quiz |
| GET | `/api/sessions/{sid}/quiz-sessions/{qsid}/next` | The next question, or the pending one |
| POST | `/api/sessions/{sid}/quiz-sessions/{qsid}/responses` | Answer a question (first answer wins) |
| GET | `/api/sessions/{sid}/reports/{qsid}` | The learner's understanding report |
| GET | `/api/sessions/{sid}/insight` | Class Understanding Map and shared misconceptions |
| GET | `/api/sessions/{sid}/threads/{topicId}` | A topic's study thread |
| POST | `/api/sessions/{sid}/threads/{topicId}/explanations` | Contribute a peer explanation |
| POST | `/api/sessions/{sid}/explanations/{eid}/validate` | Check an explanation against the lecture |
| GET, POST | `/api/admin/reset-demo` | Reset the demo classes. Requires `Authorization: Bearer $CRON_SECRET`; 404 when no secret is configured |

## Errors

Every failure uses one envelope:

```json
{ "error": { "code": "MATERIAL_TOO_LARGE", "message": "…", "field": "file" } }
```

Unexpected failures return `INTERNAL` with a request id only; the detail goes
to the server log, never to the client.

| Code | Status | Code | Status |
| --- | --- | --- | --- |
| `SESSION_NOT_FOUND` | 404 | `LEARNER_NOT_IN_SESSION` | 403 |
| `INVALID_DISPLAY_NAME` | 400 | `INSTRUCTOR_TOKEN_REQUIRED` | 403 |
| `UNSUPPORTED_EXTENSION` | 400 | `QUIZ_CLOSED` | 409 |
| `MATERIAL_TOO_LARGE` | 400 | `ANSWER_CONFLICT` | 409 |
| `NO_READABLE_TEXT` | 422 | `MATERIAL_REQUIRED` | 409 |
| `PROFILE_REQUIRED` | 400 | `DEMO_READ_ONLY` | 403 |
| `INVALID_PROFILE` | 400 | `RATE_LIMITED` | 429 |
| `POOL_UNAVAILABLE` | 409 | `AWS_UNAVAILABLE` | 503 |
| `EXPLANATION_LENGTH` | 400 | `INTERNAL` | 500 |
| `NOT_YOUR_REPORT` | 403 | | |

The table is defined, and tested, in `lib/http/errors.ts`.
