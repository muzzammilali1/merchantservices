# Merchant Payment Tracking System

A merchant payment tracking and management system with three parts:

- **`server/`** — Node.js + Express + PostgreSQL (via Prisma) API
- **`portal/`** — React frontend where staff submit payment records
- **`admin/`** — React admin dashboard (merchant sheets, gateway management, reports, audit log)

## Architecture

Both frontends are separate Vite/React SPAs that talk to the same API over HTTP, using an httpOnly session cookie for auth (`ADMIN` / `STAFF` roles). See [server/prisma/schema.prisma](server/prisma/schema.prisma) for the data model.

Key business logic decisions (see conversation history / commit messages for full rationale):

- Merchant payment percentage is set **per merchant+gateway pair**, not a single merchant-wide rate.
- Rate changes are **forward-only by default** — existing payments keep the rate they were submitted under (`rateSnapshot`). An admin can optionally apply a rate change **retroactively**, which rewrites `rateSnapshot`/deduction/net on that merchant+gateway's existing payments and logs the bulk change.
- Deduction/net are only computed once a payment's status is `RECEIVED`; `NOT_RECEIVED` and `PENDING` payments show as empty until they're marked received.
- All merchant/gateway/rate/payment totals are computed live from the underlying payment rows on every read — never cached running totals — so a status change is reflected immediately everywhere.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (or Docker, see below)

## Local development setup

1. **Database**: create a Postgres database (default expected: `merchant_payments` on `localhost:5432`, user `postgres`).
2. **Server**:
   ```bash
   cd server
   cp .env.example .env   # edit DATABASE_URL / JWT_SECRET as needed
   npm install
   npx prisma migrate deploy
   npm run seed            # creates the first admin account; prints a temp password
   npm run dev              # http://localhost:4000
   ```
3. **Portal** (in a second terminal):
   ```bash
   cd portal
   npm install
   npm run dev               # http://localhost:5173
   ```
4. **Admin** (in a third terminal):
   ```bash
   cd admin
   npm install
   npm run dev               # http://localhost:5174
   ```

Log into either frontend with the email/temp password the seed script printed — you'll be forced to set a new password on first login.

### Setting up a gateway + rate

Payments can't be recorded until an admin has: (1) created a gateway, (2) set a rate for the merchant on that gateway. Merchants can be created either via the portal (typing a new name auto-creates one) or the admin's merchant list. Gateways and rates are managed from the admin app.

## Running tests

```bash
cd server
npm test
```

93 tests covering business logic, auth, every CRUD route, retroactive recalculation, reports, CSV/PDF exports, audit logging, and error handling. Tests run against the same local Postgres database as dev (they clean up after themselves).

## Production build

```bash
cd server && npm run build && npm start
cd portal && npm run build   # outputs static files to portal/dist
cd admin  && npm run build   # outputs static files to admin/dist
```

## Docker

Dockerfiles and a `docker-compose.yml` are included for containerized deployment (Postgres + server + portal + admin). **Note: these have not been build-tested in this environment** since Docker isn't installed here — review them before relying on them.

```bash
cp .env.example .env   # set POSTGRES_PASSWORD, JWT_SECRET, etc.
docker compose up --build
# then, once, in a separate terminal:
docker compose exec server npm run seed
```

## Security notes / production checklist

Before deploying anywhere real:

- [ ] Replace the local dev `JWT_SECRET` and Postgres password with real secrets (never reuse the ones generated during local development).
- [ ] Set `NODE_ENV=production` and serve everything over HTTPS — cookies are `secure` only when `NODE_ENV=production`, and `helmet`'s HSTS header only matters over TLS.
- [ ] Set `ALLOWED_ORIGINS` to your real frontend domain(s) — the default allowlist only covers local dev ports.
- [ ] Review the seeded admin account and change its password / rotate it as part of any redeploy from a fresh database.
- [ ] The login/change-password endpoints are rate-limited (20 requests / 15 min / IP) via `express-rate-limit`; tune `authRateLimiter` in `server/src/lib/rateLimiters.ts` if needed.
- [ ] Consider adding a managed backup schedule for the Postgres database — none is configured here.

Already in place: bcrypt password hashing, parameterized queries throughout (Prisma; no raw SQL string concatenation), CORS locked to an explicit origin allowlist, `helmet` security headers, global error handler that never leaks stack traces to clients, full audit trail on merchant/gateway/rate/payment edits.

## Known scaling limitations

`GET /api/reports/merchants` and `GET /api/reports/gateways` currently load **all** merchants/gateways and their matching payments into memory and aggregate in JS, rather than aggregating in the database. This is fine at the scale this system was built for; if the merchant or payment count grows into the tens of thousands, that would need to move to DB-level aggregation (`GROUP BY`) with pagination.

## What's intentionally not done here

- No git repository has been initialized — that's left to you, since it may affect how you want to review the history.
- Nothing has been deployed to any real hosting provider. These are local dev builds plus deployment-readiness files (Dockerfiles/compose) — actually provisioning infrastructure is a decision for you to make explicitly.
