import { hashPassword } from 'better-auth/crypto';
import { database, transaction } from '../packages/db';

const [email, name] = process.argv.slice(2);
const password = process.env.PMS_ADMIN_PASSWORD;
if (!email || !name || !password || password.length < 12)
  throw new Error(
    'Usage: set PMS_ADMIN_PASSWORD (12+ characters), then npm run admin:create -- email name.',
  );
const hash = await hashPassword(password);
await transaction(async (db) => {
  await db.query('SELECT pg_advisory_xact_lock(416303)');
  if ((await db.query("SELECT 1 FROM member WHERE role='administrator'")).rowCount)
    throw new Error('An administrator exists. Use invitations to add users.');
  const user = crypto.randomUUID();
  const org = crypto.randomUUID();
  await db.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
    [user, name, email.toLowerCase()],
  );
  await db.query(
    'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
    [crypto.randomUUID(), user, hash],
  );
  await db.query('INSERT INTO organization(id,name) VALUES($1,$2)', [org, 'Packaging Review']);
  await db.query("INSERT INTO member(user_id,organization_id,role) VALUES($1,$2,'administrator')", [
    user,
    org,
  ]);
});
console.log('Administrator created. Sign in using the password supplied through the environment.');
await database().end();
