# Route Handlers — Node runtime only

Every Route Handler in this tree MUST declare the Node runtime explicitly:

```ts
export const runtime = "nodejs";
```

## Why

The Route Handlers are the entire ClassMind backend (design.md Section 4), and two
things on that path need Node APIs that the Edge runtime does not provide:

- **In-process text extraction.** PDF, TXT and Markdown material is parsed inside the
  handler rather than through Amazon Textract (design.md Section 1), which needs Node
  buffers and filesystem-style APIs.
- **The AWS SDK.** S3, DynamoDB, Bedrock and the CloudWatch-bound logger are all reached
  through the AWS SDK for JavaScript from server code (design.md Sections 2 and 5).

Node is already the App Router default for Route Handlers, so this declaration does not
change behaviour today. It is written at each handler so the dependency is visible at the
file that relies on it, and so a later refactor cannot silently move a handler to Edge and
break PDF parsing or an SDK call at demo time.

## Scope

No route files exist yet. They are added by the tasks that own them:

- `sessions/` and `sessions/join/` — Phase 3
- `sessions/[sid]/material/*` and `sessions/[sid]/pool/` — Phase 4
- `sessions/[sid]/profile/` and `sessions/[sid]/recap/` — Phase 5
- `sessions/[sid]/quiz-sessions/*` — Phase 6
- `sessions/[sid]/reports/[qsid]/` — Phase 7
- `sessions/[sid]/insight/` — Phases 8 and 9
- `sessions/[sid]/threads/*` and `sessions/[sid]/explanations/*` — Phase 10
- `demo/warmup/` — Phase 12
