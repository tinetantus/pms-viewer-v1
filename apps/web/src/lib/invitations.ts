import { randomBytes, createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { transaction } from '../../../../packages/db';
import { requireThat, type Principal } from '../../../../packages/domain';
import { audit } from './access';

export async function invite(user: Principal, body: unknown) {
  requireThat(user.role === 'administrator', 403, 'Administrator access required.');
  const input = z
    .object({ email: z.email(), role: z.enum(['administrator', 'designer', 'reviewer', 'viewer']) })
    .parse(body);
  const token = randomBytes(32).toString('hex');
  await transaction(async (db) => {
    const invitationId = crypto.randomUUID();
    await db.query(
      "INSERT INTO invitation(id,organization_id,email,role,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,now()+interval '48 hours',$6)",
      [
        invitationId,
        user.organization_id,
        input.email.toLowerCase(),
        input.role,
        createHash('sha256').update(token).digest('hex'),
        user.id,
      ],
    );
    await audit(db, user, null, 'invitation.created', invitationId, { role: input.role });
  });
  return { url: `${process.env.APP_URL}/invite#${token}` };
}
export async function acceptInvite(body: unknown) {
  const input = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().trim().min(1).max(100),
      password: z.string().min(12).max(128),
    })
    .parse(body);
  return transaction(async (db) => {
    const invitation = (
      await db.query(
        'SELECT * FROM invitation WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',
        [createHash('sha256').update(input.token).digest('hex')],
      )
    ).rows[0];
    requireThat(invitation, 400, 'Invitation expired or already used.');
    const hash = await hashPassword(input.password);
    requireThat(
      !(await db.query('SELECT 1 FROM "user" WHERE email=$1', [invitation.email])).rowCount,
      409,
      'An account with this email already exists.',
    );
    const userId = crypto.randomUUID();
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [userId, input.name, invitation.email],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
      [crypto.randomUUID(), userId, hash],
    );
    await db.query('INSERT INTO member(user_id,organization_id,role) VALUES($1,$2,$3)', [
      userId,
      invitation.organization_id,
      invitation.role,
    ]);
    await db.query('UPDATE invitation SET used_at=now() WHERE id=$1', [invitation.id]);
    return { email: invitation.email };
  });
}
