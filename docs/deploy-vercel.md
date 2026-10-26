# Deploying the public demo to Vercel

The public demo runs at <https://classmind-app.vercel.app>. Local development
needs none of this — see the [README](../README.md).

## Architecture on Vercel

| Concern | Where it lives |
| --- | --- |
| App and API routes | Vercel Functions (Node.js), pinned to `sin1` (Singapore) in `vercel.json` |
| Classes, learners, quiz responses, recaps, explanations | PostgreSQL (Neon), table `classmind_items` |
| Uploaded lecture files | The same database, table `classmind_files` (private, never served directly) |
| Rate-limit counters | The same database, table `classmind_rate_limits` |
| Daily demo reset | Vercel Cron → `GET /api/admin/reset-demo` at 04:00 UTC |

The tables are created automatically on first use. The demo classes (CM2026 and
UPLOAD) are built automatically on the first request after an empty database or
a reset. No AWS account and no AI API key are involved.

Vercel's local disk is neither durable nor shared between function instances,
so the default embedded store is **refused** on Vercel: a deployment without a
database returns errors rather than quietly losing data.

## Environment variables

Four variables, all described in [configuration.md](configuration.md#hosted-demo-vercel):

- `DATABASE_URL` — set automatically by the Neon integration (secret)
- `CLASSMIND_TARGET` = `postgres`
- `NEXT_PUBLIC_CLASSMIND_PUBLIC_DEMO` = `1`
- `CRON_SECRET` — a long random string (secret)

Sensitive values cannot be read back from Vercel once saved; keep `CRON_SECRET`
in a password manager.

## One-time setup

1. `vercel link` in the project directory.
2. Connect a database: Vercel dashboard → the project → **Storage** → **Create
   Database** → **Neon** → choose the **Free** plan → connect it to Production
   and Preview. Or run `vercel integration add neon` in an interactive terminal.
   **The database region must match `regions` in `vercel.json`.** The hosted
   demo's database is in Singapore, so functions run in `sin1`. Every write is a
   short transaction of several round trips, so a cross-region database turns a
   first-run seed of about two seconds into one of about two minutes.
3. Add the three non-database variables above (`vercel env add …`).
4. Deploy: `vercel deploy` for a preview, `vercel deploy --prod` for production.

## Resetting the demo

The cron job resets daily. To reset by hand:

```bash
curl -X POST https://<your-deployment>/api/admin/reset-demo \
  -H "Authorization: Bearer <CRON_SECRET>"
```

It rebuilds CM2026, empties UPLOAD and clears the rate-limit counters, so each
daily reset also renews every visitor's budget. It touches nothing else.
Without `CRON_SECRET` configured the endpoint returns 404.

## Testing a deployment

See [testing.md](testing.md#against-a-deployment). The deployed suite resets the
shared demo, so run it deliberately.

## Public-demo protections

- Per-IP rate limits (hashed, never stored raw) on joining, starting quizzes,
  posting explanations and uploading; plus a global daily upload ceiling.
- The seeded CM2026 lecture cannot be replaced; uploads go to UPLOAD.
- Uploads are capped at 4 MB (Vercel rejects request bodies above 4.5 MB).
- Security headers: `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  `nosniff`, a strict referrer policy and a restrictive permissions policy.
- A notice on the join page: data is shared with other visitors and reset daily.

What it does **not** have: accounts, per-visitor private classes, or moderation
of uploaded or written content. Everything a visitor enters is visible to other
visitors of the same class until the next reset. It is a portfolio demo, not a
production learning platform.
