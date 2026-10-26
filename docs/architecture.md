# Architecture

ClassMind is one Next.js (App Router) application. Its Route Handlers are the
entire backend; there are no separate services.

```
Browser (React 19, Next.js App Router)
   │  fetch, x-learner-id header
   ▼
Route Handlers  app/api/**          parse → authorise → validate → read → compute → generate → write → project
   │
   ├── lib/domain/     pure rules: adaptive difficulty, mastery, class map, misconceptions, gating, anonymisation
   ├── lib/ai/         provider interface, deterministic provider, services (recap, quiz pool, insight, validation)
   ├── lib/ingest/     text extraction (unpdf), source units, topics, upload pipeline, lecture-file storage
   ├── lib/repo/       repositories over one PK/SK item model
   └── lib/store/      storage port ─┬─ LocalStore     embedded JSON file (default, local development)
                                     ├─ PostgresStore  PostgreSQL / Neon (hosted demo)
                                     └─ DynamoStore    optional DynamoDB adapter, loaded lazily
```

The route reference is in [api.md](api.md).

## Business rules

Everything that is scored, aggregated or gated is a pure, deterministic
function in `lib/domain/`, covered by unit and property-based tests:

- **Adaptive quiz.** Six questions starting at the intermediate level; two
  correct answers in a row move the difficulty up, two incorrect move it down.
  The first answer to a question stands; repeats are reported, not re-scored.
- **Mastery and the understanding report.** Per-topic percentage of correct
  answers for one quiz; topics below 60% are flagged as weak.
- **Class Understanding Map.** Recomputed from the stored responses on every
  request. A topic is published only once at least 3 distinct learners have
  answered it, and only answers to the current lecture version count.
- **Misconceptions.** A wrong option chosen by at least 30% of a question's
  answers, and at least 2 answers, is a shared misconception; the top 3 are shown.
- **Anonymity.** Class-level responses pass through an allow-list projection, so
  learner ids and names cannot reach them.

## Content generation

The original design generated recaps, quiz questions, misconception
clarifications and explanation checks with Amazon Bedrock. Bedrock access was
denied on the account used during the competition, so the application was built
against a provider interface (`lib/ai/provider.ts`) with one implementation: a
**deterministic, rule-based provider** (`lib/ai/demo/provider.ts`).

It is **not a language model**. It performs no inference and makes no network
calls. Every recap sentence, quiz option and clarification is text selected from
the lecture by fixed rules, framed with a little structural wording, and every
citation is resolved by the server against the lecture's own source units. That
makes it fast, free and unable to invent facts — and also limited: it cannot
paraphrase, and its explanation checks compare words rather than meaning. A
hosted model can be added by implementing `AIProvider` and registering it in
`lib/ai/index.ts`.

## Storage

The data model is a single-table design (partition key `PK`, sort key `SK`)
originally written for DynamoDB. `lib/store/types.ts` defines a small port —
key lookups, prefix queries, conditional writes and all-or-nothing transactions
— and the repositories in `lib/repo/` run unchanged on any backend. The
conditional writes are what make a double-submitted answer count once and
quiz-pool generation happen once.

`CLASSMIND_TARGET` selects the backend (see [configuration.md](configuration.md)):

| Target | Data | Lecture files | Used for |
| --- | --- | --- | --- |
| `local` (default) | JSON file in `.classmind/data/` | `.classmind/materials/` | Local development |
| `postgres` | PostgreSQL table `classmind_items` | PostgreSQL table `classmind_files` | The hosted demo on Vercel |
| `dynamodb-local` | DynamoDB Local | `.classmind/materials/` | Exercising the DynamoDB adapter |
| `aws` | Amazon DynamoDB | Amazon S3 | The original AWS design |

The PostgreSQL store serialises writes to the same key with transaction-scoped
advisory locks and evaluates conditions with the same functions as the local
store, so both behave identically; a shared contract test runs against both.

The demo classes are built on first use by `lib/demo/bootstrap.ts`, under a lock
so concurrent serverless instances seed once.

## Original AWS design, and what changed

| Component | Original design | Now |
| --- | --- | --- |
| Structured data | Amazon DynamoDB (one table) | Local: embedded JSON store. Hosted: PostgreSQL (Neon) |
| Lecture files | Amazon S3 | Local: disk. Hosted: the same PostgreSQL database |
| Generation and validation | Amazon Bedrock (never enabled) | Deterministic provider, no model |
| Logs | CloudWatch via stderr | stderr (Vercel function logs) |
| Deployment | ECS Fargate behind a load balancer | Vercel + Neon |

The DynamoDB and S3 adapter remains and is documented in
[aws-setup.md](aws-setup.md). The AWS SDK is loaded only when an AWS target is
selected. The original Kiro requirements, design and task plan are kept in
`.kiro/specs/classmind-mvp/`, each with a note on what changed.

## Source layout

```
app/                 pages (join, lecture, recap, quiz, insight, study thread) and API routes
components/          UI components and design primitives
hooks/               learner identity in local storage, last quiz session
lib/domain/          deterministic business rules
lib/ai/              provider interface, deterministic provider, generation services
lib/ingest/          extraction, segmentation, topics, uploads, lecture-file storage
lib/repo/            repositories over the PK/SK model
lib/store/           storage port and its backends
lib/demo/            demo lecture, seeding, reset, first-run bootstrap
lib/http/            request pipeline, error envelope, auth, rate limits
lib/aws/             optional DynamoDB and S3 clients, structured logger
scripts/             seed, reset, verification, optional AWS provisioning
tests/               route and integration tests, fixtures
e2e/                 Playwright browser tests (local and deployed)
```
