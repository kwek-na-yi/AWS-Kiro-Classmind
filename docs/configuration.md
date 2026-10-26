# Configuration

ClassMind reads all configuration from environment variables. **Local
development needs none.** The repository deliberately contains no `.env` files,
not even templates; this page is the reference instead.

Every variable is read on the server only. The single exception is
`NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO`, a non-secret flag the join page also reads.

## Where values come from

| Context | How to set variables |
| --- | --- |
| Local development | Optional. Create `.env.local` in the project root; Next.js and the npm scripts load it. Git ignores every `.env*` file. |
| Vercel | Project → **Settings** → **Environment Variables**, or `vercel env add`. The Neon integration sets the database variables itself. |
| Optional AWS adapter | Create `.env.aws`; the `*:aws` npm scripts load it. |
| Docker | `docker run -e NAME=value …` or `--env-file <file>`. |

## Variables

### Backend selection

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLASSMIND_TARGET` | `local` | Storage backend: `local` (embedded JSON store, the default), `postgres` (hosted demo), `dynamodb-local` or `aws` (optional DynamoDB adapter). An unrecognised value is an error. |
| `CLASSMIND_DATA_DIR` | `.classmind` | `local` only. Where the embedded store (`data/store.json`) and uploaded lecture files (`materials/`) live. Delete the directory to reset everything. |

### Hosted demo (Vercel)

| Variable | Secret | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Set automatically when a Neon database is connected to the Vercel project. `POSTGRES_URL` is accepted as a fallback. |
| `CLASSMIND_TARGET` | No | `postgres`. |
| `NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO` | No | `1` turns on the public-demo protections: rate limits, a read-only demo lecture and the shared-demo notice. |
| `CRON_SECRET` | Yes | Long random string. Authorises `/api/admin/reset-demo`; Vercel Cron sends it automatically. Without it the endpoint returns 404. |

On Vercel the local file store is refused, so a deployment without
`CLASSMIND_TARGET=postgres` and a database fails with a clear error rather than
silently losing data. See [deploy-vercel.md](deploy-vercel.md).

### Optional AWS adapter

Only for running against DynamoDB and S3. See [aws-setup.md](aws-setup.md).

| Variable | Target | Purpose |
| --- | --- | --- |
| `AWS_REGION` | `aws` | Region holding both the table and the bucket. |
| `CLASSMIND_TABLE` | `aws`, `dynamodb-local` | The single DynamoDB table (PK/SK, on-demand). Defaults to `classmind`. |
| `CLASSMIND_BUCKET` | `aws` | S3 bucket for lecture files. Must be globally unique; you choose it. |
| `APP_ORIGIN` | any | The server `npm run verify` / `npm run verify:aws` drives. Defaults to `http://localhost:3000`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | `aws` | Credentials, if not already in `~/.aws/credentials`. AWS Academy session credentials need all three. |
| `DYNAMODB_ENDPOINT` | `dynamodb-local` | DynamoDB Local endpoint. Defaults to `http://localhost:8000`. Ignored on `aws`. |

Do not put AWS credentials, or placeholder values for them, in `.env.local`:
`next dev` loads that file on every run, including AWS runs, and a placeholder
there would be used to sign real AWS requests. ClassMind refuses to start an
AWS client with a placeholder key for that reason.

## Examples

Local development needs nothing. To keep local data elsewhere:

```bash
# .env.local
CLASSMIND_DATA_DIR=/path/to/classmind-data
```

The optional AWS adapter (placeholders only):

```bash
# .env.aws
CLASSMIND_TARGET=aws
AWS_REGION=us-east-1
CLASSMIND_TABLE=classmind
CLASSMIND_BUCKET=classmind-your-unique-suffix
APP_ORIGIN=http://localhost:3000
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_SESSION_TOKEN=...
```

Never commit real values. Git ignores every `.env*` file, and `.vercelignore`
and `.dockerignore` keep them out of deployments and images.
