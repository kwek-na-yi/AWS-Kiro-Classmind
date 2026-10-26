# Running ClassMind on AWS (optional)

> **You do not need any of this to run ClassMind.** The default setup in the
> [README](../README.md) runs entirely on your machine with no AWS account,
> no credentials and no Docker. This guide documents the optional AWS adapter
> the project was originally built around for the AWS Kiro competition. It was
> last exercised against an AWS Academy Learner Lab account; it is kept so the
> original architecture stays reproducible, but it is not part of the default
> path, and it is not covered by the automated test suites beyond unit tests of
> its DynamoDB expression translation.

Three targets, one switch: `CLASSMIND_TARGET`, resolved in `lib/target.ts`.

| | `local` (default) | `dynamodb-local` | `aws` |
| --- | --- | --- | --- |
| Database | embedded JSON store in `.classmind/` | DynamoDB Local in Docker | Amazon DynamoDB |
| Lecture bytes | files on disk | files on disk | Amazon S3 |
| Credentials | none | supplied in code (dummy) | standard AWS provider chain |
| Config | none needed | `.env.local` | `.env.aws` |
| AWS SDK loaded | never | yes | yes |

---

## AWS

### 1. Configure

```
cp .env.aws.example .env.aws
```

Fill in:

| Variable | Notes |
| --- | --- |
| `CLASSMIND_TARGET` | `aws` |
| `AWS_REGION` | Same region for the table and the bucket |
| `CLASSMIND_TABLE` | e.g. `classmind` |
| `CLASSMIND_BUCKET` | **Globally unique.** You choose it; no account id is derived |
| `APP_ORIGIN` | `http://localhost:3000` while running locally against AWS |
| `AWS_ACCESS_KEY_ID` | From the Learner Lab "AWS Details" panel |
| `AWS_SECRET_ACCESS_KEY` | Same |
| `AWS_SESSION_TOKEN` | **Required** — Academy issues temporary credentials |

`DYNAMODB_ENDPOINT` does not belong in this file, and no AWS credential belongs
in `.env.local`. `next dev` loads `.env.local` on **every** run, including
`npm run dev:aws`, and only fills in variables the caller did not already set —
so anything present there and absent here leaks into the AWS run. Two guards
make that harmless rather than silent:

- `dynamoEndpoint()` returns nothing at all on the `aws` target, so a leaked
  endpoint cannot route writes to localhost;
- `assertUsableAwsCredentials()` refuses to build a client when
  `AWS_ACCESS_KEY_ID` is not shaped like a real access key id, so a placeholder
  fails immediately with a sentence naming the file to fix rather than as an
  `UnrecognizedClientException` on every request.

DynamoDB Local still needs *some* credential pair to sign with; the local client
supplies its own in `lib/aws/ddb.ts`, which is why none is configured anywhere.

AWS Academy credentials expire every few hours. When calls start failing with
`ExpiredToken`, paste a fresh set into `.env.aws`; nothing else changes.

### 2. Provision

```
npm run setup:aws
```

Creates, and is safe to re-run:

- the DynamoDB table — `PK` (String) partition key, `SK` (String) sort key,
  on-demand billing, no secondary index
- the S3 bucket — public access blocked, SSE-S3 default encryption, a 30-day
  lifecycle rule on `sessions/`, and a policy denying non-TLS requests

The bucket policy and lifecycle rule are applied on a best-effort basis: the
Academy role restricts some bucket-level actions, and the script reports a
warning rather than failing, because the bucket is usable without them.

### 3. Seed

```
npm run seed:aws
```

- uploads the demo lecture to `sessions/demo/material/v1/demo-lecture.md`
- **reads it back from S3** and extracts from that, so the source text is one
  that genuinely round-tripped through object storage
- writes the class session `CM2026`, 5 topics, 15 quiz items (one per topic at
  each of the three levels), 6 learners, 30 responses and 3 peer explanations

Re-running clears both the previous learner activity **and** everything
previously generated from the material — the Quiz_Pool, every retained Recap
variant and every cached misconception clarification. Those are keyed by their
own content, so regenerating them from changed source text would otherwise leave
the old generation beside the new one and the demo would drift a little further
on every run. After a re-seed the class is exactly what the seed script
describes: 6 learners, three mastery bands, one weakest topic.

Re-seed immediately before a demo. Every real learner who joins — including the
one `npm run verify:aws` creates — genuinely moves the class map, which is the
product working, but it means an unseeded class reflects however much testing has
happened since.

### 4. Run

```
npm run dev:aws       # the app in development, against AWS
npm run build         # the production build
npm run start:aws     # the production server, against AWS
npm run verify:aws    # the whole journey, against AWS (needs one of the two running)
```

---

## Container

```
docker build -t classmind:latest .

docker run -d --name classmind --init -p 3000:3000 \
  -e CLASSMIND_TARGET=aws \
  -e AWS_REGION=us-east-1 \
  -e CLASSMIND_TABLE=classmind \
  -e CLASSMIND_BUCKET=<your-bucket> \
  -e APP_ORIGIN=http://localhost:3000 \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  classmind:latest
```

`-e NAME` with no value passes the variable through from the calling shell, so
no credential is written into a file, a shell history entry or an image layer.
In ECS none of those three is set at all — the task role supplies them and the
SDK's provider chain finds them.

`--env-file .env.aws` also works for the five configuration variables, but only
if that file carries the credentials too; when they live in `~/.aws/credentials`
the container cannot see them, because `~/.aws` is on the host.

### What the image contains

Three stages: `deps` installs the dependency tree from the lockfile alone,
`builder` runs `next build`, and `runner` receives only `.next/standalone` plus
`.next/static`. The result holds the traced server, its traced `node_modules`
subset, `package.json` and nothing else — no source, no lockfile, no TypeScript,
no test runner, no env file. It runs as an unprivileged user and binds
`0.0.0.0` so the port is reachable from outside the container.

### Seeding in the container

- **On the `aws` target it never seeds.** `npm run seed:aws` runs on the host,
  against AWS.
- **In local mode (no `CLASSMIND_TARGET`) it seeds itself** on the first request,
  from `lib/demo/demo-lecture.md`, which `.dockerignore` and
  `outputFileTracingIncludes` keep in the image. Data lives in
  `/app/.classmind`; mount a volume there to keep it across restarts.
- The S3 SDK is loaded lazily by `lib/ingest/material-store.ts` only on the
  `aws` target, when an upload stores or reads lecture bytes.

---

## Deployment — ECR and ECS Fargate

*Historical:* this is how the competition build was deployed. The deployment is
not maintained, and the URL it was served from has been removed from this guide.

| | |
| --- | --- |
| Registry | `<account>.dkr.ecr.us-east-1.amazonaws.com/classmind:latest` |
| Cluster | `classmind` |
| Service | `classmind` (Fargate, desiredCount 1) |
| Task definition | `classmind` |
| Roles | `LabRole` as both execution and task role |
| Load balancer | `classmind-alb` — internet-facing, HTTP :80, us-east-1a + us-east-1b |
| Target group | `classmind-tg` — IP targets, HTTP :3000, health check `GET /` |
| Networking | default VPC, existing public subnets, `assignPublicIp=ENABLED` |
| Security groups | `classmind-alb-sg` :80 from the internet; `classmind-sg` :3000 from the ALB only |
| Logs | CloudWatch `/ecs/classmind`, 7-day retention |

No NAT gateway, no new VPC and no new subnet: the load balancer and the task
both sit in subnets the default VPC already had, and the task reaches ECR,
DynamoDB and S3 through its existing internet gateway.

The task keeps a public IP — without a NAT gateway it needs one to pull from
ECR — but nothing can reach the application on it. `classmind-sg` accepts port
3000 from the load balancer's security group and from nowhere else, so the ALB
is the only way in.

### Redeploying a new image

```
# 1. build and push
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker build -t classmind:latest .
docker tag classmind:latest <account>.dkr.ecr.us-east-1.amazonaws.com/classmind:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/classmind:latest

# 2. roll the service onto it
aws ecs update-service --cluster classmind --service classmind --force-new-deployment

# 3. wait for the new task to pass the load balancer's health check
aws ecs wait services-stable --cluster classmind --services classmind
aws elbv2 describe-target-health \
  --target-group-arn "$(aws elbv2 describe-target-groups --names classmind-tg \
      --query 'TargetGroups[0].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[].TargetHealth.State' --output text
```

The URL does not change, so there is nothing to look up afterwards.
`--force-new-deployment` is enough because the task definition points at the
`:latest` tag. Only register a new revision when a *variable* changes — and
`APP_ORIGIN` no longer needs to, because the load balancer's DNS name is fixed.

### Why there is a load balancer

A Fargate task gets a fresh network interface — and so a fresh public IP — every
time it is replaced. Measured across three deployments: `54.205.245.253` →
`54.226.187.27` → `3.90.150.104`. That makes the demo link expire on every
deployment and leaves `APP_ORIGIN` naming an address that no longer answers.

Pinning the task's own address is not possible in this account: an Elastic IP
cannot be associated with an ECS task's network interface, which is
requester-managed —

    AuthFailure: You do not have permission to access the specified resource.

The load balancer solves it from the other side. Its DNS name is allocated once
and never changes, so `APP_ORIGIN` is set once and stays correct. Verified by
forcing a replacement: the task moved from `172.31.42.32` to `172.31.36.112`
and the URL was byte-identical before and after.

### Verifying a deployment

```
npm run seed:aws                                    # from the host, against AWS
APP_ORIGIN=http://<your-load-balancer-dns> npm run verify:aws
```

`verify:aws` already honours `APP_ORIGIN`, so it needs no change to target the
deployed URL rather than a local server.

---

## DynamoDB Local — exercising the adapter without AWS

```
docker run -d -p 8000:8000 --name classmind-ddb amazon/dynamodb-local
# in .env.local:  CLASSMIND_TARGET=dynamodb-local
npm run setup:table
npm run seed
npm run dev
npm run verify
```

No AWS account and no credentials are involved. `setup:table` refuses to run in
the default `local` mode, which has no table.

---

## What the switch actually changes

`lib/target.ts` resolves the target. Three things read it:

- **`lib/store/index.ts`** picks the storage backend behind every repository:
  the embedded `LocalStore` (`lib/store/local.ts`) for `local`, the
  `DynamoStore` adapter (`lib/store/dynamo.ts`) otherwise. The adapter and the
  AWS SDK behind it are loaded with a dynamic `import()`, so local mode never
  loads them. Both implement the same small port in `lib/store/types.ts` — key
  lookups, prefix queries, conditional writes and transactions — and the
  DynamoDB expressions are generated in `lib/store/expressions.ts`.
- **`lib/aws/ddb.ts`** passes an endpoint override and a dummy credential pair
  for `dynamodb-local`, and neither for `aws`, where the standard provider chain
  resolves the credentials.
- **`lib/ingest/material-store.ts`** stores lecture bytes in S3 on `aws` and on
  disk otherwise. Both are read back through `loadMaterialBytes`, so callers
  never learn which they got.

No repository, domain module, service or route handler branches on the
environment.
