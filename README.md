# ClassMind

**Understand yourself. Understand your class.**

ClassMind turns one lecture into a personalised study session — a recap written
for how much you already know, a six-question quiz that adapts as you answer, and
a report of which ideas have not landed — then shows the whole class, anonymously,
where understanding is breaking down and which wrong beliefs are shared.

Originally built for the **AWS Kiro competition**, specified with Kiro
(see [`.kiro/specs/classmind-mvp/`](.kiro/specs/classmind-mvp/)) and designed
around Amazon S3, Amazon Bedrock and Amazon DynamoDB. It now runs **entirely on
your machine**: no AWS account, no credentials, no Docker and no AI API key.

![Class Insight: the weakest topic and the shared misconception behind it](docs/screenshots/07-class-insight.png)

---

## Quick start

Requires **Node.js 22.12 or newer** and npm.

```bash
git clone <this repository>
cd classmind
npm install
npm run dev
```

Open <http://localhost:3000>. The class code **`CM2026`** is pre-filled — type a
name and press **Start learning**.

That is the whole setup. No environment variables are required: on the first
request ClassMind creates its local data store under `.classmind/` and builds the
demo classes. To change a default, copy [`.env.example`](.env.example) to
`.env.local`.

**Production build:** `npm run build && npm start`.

---

## The demo

Two classes exist on first run. Everything in them is **synthetic sample data**.

| Code | Class | What it is for |
| --- | --- | --- |
| `CM2026` | Relational Databases — Week 4 | A short synthetic lecture ([`lib/demo/demo-lecture.md`](lib/demo/demo-lecture.md)), five topics, and six synthetic learners (“Avery”, “Blake”, …) who have already taken the quiz, so Class Insight has something to show. |
| `UPLOAD` | Your own lecture | Empty. Upload a PDF, TXT or Markdown file and the class is built from it. |

A suggested walk-through:

1. **Join** `CM2026` with any name.
2. **Learn** — pick how confident you are and how you want it explained, then
   *Create My Recap*.
3. **Recap** — key takeaways and one section per topic, shaped by your profile.
   Change the profile and the recap changes with it.
4. **Check** — six questions. Two right in a row moves the difficulty up, two
   wrong moves it down. Each answer shows the correct option and where the
   lecture says so.
5. **Your understanding** — per-topic mastery from your answers, weakest first.
6. **Class Insight** — the Class Understanding Map (you are now the seventh
   learner) and the misconceptions the class shares.
7. **Study together** — open a topic, read classmates’ explanations and write
   your own; it is checked against the lecture before it can be recommended.
8. Join **`UPLOAD`** and drop in your own lecture notes.

| | |
| --- | --- |
| ![Join](docs/screenshots/01-join.png) | ![Personalise](docs/screenshots/02-lecture.png) |
| ![Recap](docs/screenshots/03-recap.png) | ![Quiz feedback](docs/screenshots/05-feedback.png) |
| ![Understanding report](docs/screenshots/06-report.png) | ![Study thread](docs/screenshots/08-study-thread.png) |

### Resetting

```bash
npm run demo:reset
```

Rebuilds `CM2026` to its seeded state and empties `UPLOAD`. It is safe while the
server is running; a browser that had joined before the reset rejoins
automatically. Alternatively, stop the server and delete the `.classmind/`
directory — the demo is recreated on the next request.

---

## What runs locally, and how

| Feature | Local mode | Notes |
| --- | --- | --- |
| Join a class, learner identity | ✅ Full | Anonymous id per class, kept in the browser’s local storage. |
| Learner profile | ✅ Full | Stored server-side; persists across reloads. |
| Personalised recap | ⚙️ Deterministic | See *About the “AI”* below. Personalised by understanding level and explanation style; every section cites the lecture. |
| Adaptive quiz, scoring, report | ✅ Full | Pure, deterministic engine in `lib/domain/`. Duplicate submissions are recorded once. |
| Quiz question generation | ⚙️ Deterministic | Built from the lecture’s own sentences; distractors are statements from other topics. |
| Class Understanding Map | ✅ Full | Recomputed from the stored responses on every request; topics stay hidden until 3 learners have answered. |
| Misconception detection | ✅ Full | A wrong option chosen by ≥30% of answers and ≥2 answers. Clarifications quote the lecture. |
| Peer explanation validation | ⚙️ Deterministic | Word-overlap and negation checks against the lecture — it matches words, not meaning. |
| Lecture upload (PDF/TXT/MD) | ✅ Full | Text extracted in-process; files stored under `.classmind/materials/`. Scanned PDFs without a text layer are rejected with a message. |
| Data persistence | ✅ Full | One JSON file, `.classmind/data/store.json`, shared by every browser that connects. |

### About the “AI”

The original design generated recaps, quizzes, clarifications and explanation
checks with **Amazon Bedrock**. Bedrock access was denied on the account used
during the competition, so the application was built against a provider
interface (`lib/ai/provider.ts`) with one implementation: a **deterministic,
rule-based provider** ([`lib/ai/demo/provider.ts`](lib/ai/demo/provider.ts)).

It is **not a language model**. It performs no inference and makes no network
calls: every recap sentence, quiz option and clarification is text selected from
the uploaded lecture by fixed rules, framed with a little structural wording, and
every citation is resolved by the server against the lecture’s own source units.
That makes it fast, free and unable to invent facts — and also limited: it
cannot paraphrase, explain beyond what the lecture says, or understand an
explanation the way a model would. A hosted model can be added by implementing
`AIProvider` and registering it in [`lib/ai/index.ts`](lib/ai/index.ts).

---

## Architecture

```
Browser (React 19, Next.js App Router)
   │  fetch, x-learner-id header
   ▼
Route Handlers  app/api/**            parse → authorise → validate → read → compute → generate → write → project
   │
   ├── lib/domain/     pure rules: adaptive difficulty, mastery, class map, misconceptions, gating, anonymisation
   ├── lib/ai/         provider interface + deterministic provider + services (recap, pool, insight, validation)
   ├── lib/ingest/     text extraction (unpdf), source units, topics, upload pipeline, material storage
   ├── lib/repo/       repositories over one PK/SK item model
   └── lib/store/      storage port ─┬─ LocalStore     embedded JSON file (default, local)
                                     ├─ PostgresStore  PostgreSQL / Neon (hosted demo)
                                     └─ DynamoStore    optional DynamoDB adapter, loaded lazily
```

The data model is a single-table PK/SK design originally written for DynamoDB.
`lib/store/` puts it behind a small port — key lookups, prefix queries,
conditional writes and all-or-nothing transactions — so the repositories run
unchanged on either backend. The conditional writes matter: they are what make
a double-clicked answer count once and quiz-pool generation happen once.

### Original AWS design, and what changed

| Component | Original design | Now (default) |
| --- | --- | --- |
| Structured data | Amazon DynamoDB (one table) | Locally: embedded JSON store in `.classmind/data/`. Hosted: PostgreSQL (Neon) |
| Lecture files | Amazon S3 | Locally: `.classmind/materials/`. Hosted: the same PostgreSQL database |
| Generation & validation | Amazon Bedrock (never enabled) | Deterministic provider, no model |
| Logs | CloudWatch via stderr | stderr |
| Deployment | ECS Fargate behind an ALB | Vercel + Neon (see [docs/deploy-vercel.md](docs/deploy-vercel.md)), `npm start`, or the Dockerfile |

The DynamoDB/S3 adapter is still in the code and can be selected with
`CLASSMIND_TARGET=aws` (or `dynamodb-local` against DynamoDB Local in Docker). It
is optional and documented separately in [`docs/aws-setup.md`](docs/aws-setup.md).
The AWS SDK is only loaded when one of those targets is selected.

### Project layout

```
app/                 pages (join, lecture, recap, quiz, insight, study thread) and API routes
components/          UI components and design primitives
hooks/               learner identity in local storage, last quiz session
lib/domain/          deterministic business rules (+ property tests)
lib/ai/              provider interface, deterministic provider, generation services
lib/ingest/          extraction, segmentation, topics, uploads
lib/repo/            repositories
lib/store/           storage port, local store, DynamoDB adapter
lib/demo/            demo lecture, seeding, reset, first-run bootstrap
scripts/             seed, reset, verification, optional AWS setup
tests/               route and integration tests
e2e/                 Playwright browser tests
.kiro/specs/         original Kiro requirements, design and task plan
```

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build and server |
| `npm run demo:reset` | Restore both demo classes to their initial state |
| `npm run seed` | Rebuild only `CM2026` |
| `npm run reset:class` | Empty the `UPLOAD` class |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit, property, route and integration tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright) against a fresh production build |
| `npm run verify` | Drives the whole journey over HTTP against a running server (default `http://localhost:3000`) |

The first time you run the browser tests, install Chromium:
`npx playwright install chromium`. They use their own data directory and never
touch your `.classmind/` data.

### Configuration

Nothing is required. Optional variables are listed in
[`.env.example`](.env.example): `CLASSMIND_DATA_DIR` moves the local data
directory, and `CLASSMIND_TARGET` selects the optional DynamoDB backends.

### Hosted demo (Vercel)

The public demo runs on Vercel with a free Neon PostgreSQL database, a daily
automatic reset and public-demo protections (rate limits, read-only demo lecture,
4 MB uploads). Setup, environment variables and testing a deployment are in
[docs/deploy-vercel.md](docs/deploy-vercel.md). None of it is needed locally.

### Docker

```bash
docker build -t classmind .
docker run --rm --init -p 3000:3000 -v classmind-data:/app/.classmind classmind
```

With no environment variables the container runs in local mode. The Dockerfile
was updated for local mode but the image has not been rebuilt and run since that
change; `npm run build && npm start` is the tested path.

---

## Known limitations

- **No language model.** Recaps quote rather than rewrite; explanation checks
  compare words, not meaning, so a correct explanation in very different wording
  can be marked *Unsupported*. See *About the “AI”*.
- **No instructor interface.** Classes are created by scripts; the two demo
  classes are created automatically. There are no accounts — anyone with a class
  code can join, by design for the demo.
- **Local storage is single-server.** The default embedded store is one JSON
  file written by one Node process. Multi-instance hosting uses the PostgreSQL
  target instead, as the hosted demo does.
- **The hosted demo is shared.** Everything a visitor enters is visible to other
  visitors of the same class until the daily reset; there are no private classes
  and no content moderation. Uploads there are limited to 4 MB.
- **Text-based PDFs only.** There is no OCR.
- The optional AWS adapter was not exercised against AWS after the move to local
  mode; its DynamoDB expression translation is covered by unit tests.

## Credits

Built by the ClassMind team for the AWS Kiro competition. Requirements, design and
task plan were developed with [Kiro](https://kiro.dev); the specs are kept, with a
note on what changed, in [`.kiro/specs/classmind-mvp/`](.kiro/specs/classmind-mvp/).
