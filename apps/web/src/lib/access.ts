import { auth } from './auth';
import { database, type Connection } from '../../../../packages/db';
import { requireThat, type Principal, type Project } from '../../../../packages/domain';

export async function principal(request: Request): Promise<Principal> {
  const session = await auth().api.getSession({ headers: request.headers });
  requireThat(session, 401, 'Sign in to continue.');
  const result = await database().query(
    'SELECT m.*,u.name,u.email FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.user_id=$1 AND m.active',
    [session.user.id],
  );
  requireThat(result.rows[0], 403, 'Workspace access is disabled.');
  return { ...result.rows[0], id: session.user.id };
}
export function sameOrigin(request: Request) {
  requireThat(
    request.headers.get('origin') === new URL(process.env.APP_URL!).origin,
    403,
    'Request origin is not allowed.',
  );
}
export async function access(db: Connection, user: Principal, projectId: string, lock = false) {
  const result = await db.query(
    'SELECT * FROM project WHERE id=$1 AND organization_id=$2' + (lock ? ' FOR UPDATE' : ''),
    [projectId, user.organization_id],
  );
  const project = result.rows[0] as Project | undefined;
  requireThat(project, 404, 'Project not found.');
  const membership = (
    await db.query('SELECT * FROM project_member WHERE project_id=$1 AND user_id=$2', [
      projectId,
      user.id,
    ])
  ).rows[0];
  const administrator = user.role === 'administrator';
  requireThat(administrator || membership, 404, 'Project not found.');
  return {
    project,
    permission: {
      administrator,
      designer: Boolean(membership?.designer),
      reviewer: Boolean(membership?.reviewer),
      scopes: (membership?.scopes ?? []) as string[],
    },
  };
}
export async function audit(
  db: Connection,
  user: Principal,
  projectId: string | null,
  action: string,
  targetId: string,
  metadata: object = {},
) {
  await db.query(
    'INSERT INTO audit_event(id,project_id,actor_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [crypto.randomUUID(), projectId, user.id, action, targetId, JSON.stringify(metadata)],
  );
  if (projectId) await db.query('UPDATE project SET updated_at=now() WHERE id=$1', [projectId]);
}
export async function notify(db: Connection, projectId: string, message: string) {
  await db.query(
    'INSERT INTO notification(id,user_id,project_id,message) SELECT gen_random_uuid(),user_id,$1,$2 FROM project_member WHERE project_id=$1',
    [projectId, message],
  );
}
