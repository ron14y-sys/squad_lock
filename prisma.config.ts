// Prisma ORM 7 config — connection details live here, not in schema.prisma.
// See docs/spec.md §6.3 and §10: the connection string is a secret and is
// never committed; it comes from the environment only (Vercel env vars in
// production, .env locally — see .env.example).

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Read through, rather than asserted with prisma's `env()`. That helper
  // throws on a missing value and runs as this module loads, so it fired for
  // *every* CLI command — including `generate`, which reads the schema file
  // and needs no connection at all. That made a fresh clone and CI unable to
  // build the client without a database that does not exist yet.
  //
  // `datasource` is optional by design (`@prisma/config`: "required for
  // migration / introspection commands"), so migrate, studio and introspect
  // still fail loudly, with prisma's own message, when the variable really is
  // missing. Do not put `env()` back.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
