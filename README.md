This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### 1. A local database

Develop against a Postgres on your own machine, **never the production one**: `prisma migrate dev` can offer to reset the database it points at.

On a Mac, install [Postgres.app](https://postgresapp.com), open it and press **Initialize**. Then create the database:

```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb squadlock_dev
```

### 2. `.env.local`

Copy `.env.example` to `.env.local` and set the database to the one you just made. Postgres.app needs no password; the user is your Mac username:

```
DATABASE_URL="postgresql://<your-mac-username>@localhost:5432/squadlock_dev"
```

The other values are described in `.env.example` itself.

### 3. Install, migrate, run

```bash
npm install                 # also generates the Prisma client and installs the git hooks
npm run db:migrate:deploy   # creates every table in the local database
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The database starts empty: sign in and create a group.

After pulling changes that add a migration, run `npm run db:migrate:deploy` again. If the type-checker says a Prisma model is missing a field, run `npm run db:generate`.

### Databases and migrations

| Where             | Database                                 | Migrations applied by              |
| ----------------- | ---------------------------------------- | ---------------------------------- |
| Your machine      | local Postgres                           | you (`npm run db:migrate:dev`)     |
| Vercel Preview    | production's, until a staging one (#157) | nobody                             |
| Vercel Production | Supabase                                 | the deploy itself (`vercel-build`) |

To change the schema: edit `prisma/schema.prisma`, run `npm run db:migrate:dev -- --name <what_changed>` to write and apply the migration locally, and commit both. Merging to `main` applies it to production. Rules for what a migration may do are in [AGENTS.md](AGENTS.md) → _Migrations_; the tables are described in [docs/database-schema.md](docs/database-schema.md).

## Checks

`npm install` also installs the git hooks. From then on, committing formats and lints your staged files, and pushing runs the type-checker and the test suite; CI re-runs all of it, plus a production build, on every pull request.

```bash
npm run verify   # everything at once: format:check · lint · typecheck · test
npm run test:watch
npm run format   # write formatting fixes
npm run lint:fix
```

See the _Quality gates_ section of [AGENTS.md](AGENTS.md) for what runs where and why.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
