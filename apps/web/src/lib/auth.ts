import { betterAuth } from 'better-auth';
import { database } from '../../../../packages/db';

function createAuth() {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)
    throw new Error('AUTH_SECRET must contain at least 32 characters.');
  return betterAuth({
    database: database(),
    baseURL: process.env.APP_URL,
    secret: process.env.AUTH_SECRET,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function auth() {
  return (instance ??= createAuth());
}
