// Auth.js route handler (B2) — wires the App Router to the config in
// auth.ts. Handles GET (e.g. the /api/auth/callback/google redirect) and
// POST (sign-in/sign-out form submissions).
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
