// Prisma ORM 7 config — connection details live here, not in schema.prisma.
// See docs/spec.md §6.3 and §10: the connection string is a secret and is
// never committed; it comes from the environment only (Vercel env vars in
// production, .env locally — see .env.example).

import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
