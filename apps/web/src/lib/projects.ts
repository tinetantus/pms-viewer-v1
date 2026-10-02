import { z } from 'zod';
import { database, transaction, type Connection } from '../../../../packages/db';
import {
  projectInput,
  requireThat,
  checkVersion,
  id,
  type Principal,
  type Workspace,
} from '../../../../packages/domain';
import { access, audit } from './access';

export async function listProjects(user: Principal, url: URL) {
  const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1));
  const search = (url.searchParams.get('q') || '').slice(0, 150);
  const result = await database().query(
    `SELECT p.*, (SELECT count(*)::int FROM issue i WHERE i.project_id=p.id AND i.status<>'closed') open_issues,
    (SELECT r.pages->0->>'thumbnail' FROM revision r WHERE r.id=p.current_revision_id AND r.state='ready') thumbnail,
    (SELECT r.sequence FROM revision r WHERE r.id=p.current_revision_id) current_sequence,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',u.name)) FROM project_member m JOIN "user" u ON u.id=m.user_id WHERE m.project_id=p.id AND m.reviewer),'[]') reviewers,
    count(*) OVER()::int total FROM project p WHERE p.organization_id=$1
    AND ($2::boolean OR EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=$3))
    AND (p.name ILIKE $4 OR p.sku ILIKE $4) AND p.archived=$5
    AND ($6='' OR p.status=$6) AND ($8='' OR EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=$8)) ORDER BY p.updated_at DESC LIMIT 24 OFFSET $7`,
    [
      user.organization_id,
      user.role === 'administrator',
      user.id,
      `%${search}%`,
      url.searchParams.get('archived') === 'true',
      url.searchParams.get('status') || '',
      (page - 1) * 24,
      url.searchParams.get('assignee') || '',
    ],
  );
  const assignees = await database().query(
    'SELECT DISTINCT u.id user_id,u.name FROM project_member pm JOIN "user" u ON u.id=pm.user_id JOIN project p ON p.id=pm.project_id WHERE p.organization_id=$1 AND ($2 OR EXISTS(SELECT 1 FROM project_member own WHERE own.project_id=p.id AND own.user_id=$3)) ORDER BY u.name',
    [user.organization_id, user.role === 'administrator', user.id],
  );
  return {
    projects: result.rows,
    page,
    total: result.rows[0]?.total || 0,
    assignees: assignees.rows,
  };
}
export async function createProject(user: Principal, body: unknown) {
  requireThat(
    ['administrator', 'designer'].includes(user.role),
    403,
    'Only designers and administrators can create projects.',
  );
  const input = projectInput.parse(body);
  return transaction(async (db) => {
    const projectId = crypto.randomUUID();
    await db.query(
      'INSERT INTO project(id,organization_id,name,sku,product,pack_size,market,language,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        projectId,
        user.organization_id,
        input.name,
        input.sku,
        input.product,
        input.pack_size,
        input.market,
        input.language,
        user.id,
      ],
    );
    await db.query('INSERT INTO project_member(project_id,user_id,designer) VALUES($1,$2,true)', [
      projectId,
      user.id,
    ]);
    await audit(db, user, projectId, 'project.created', projectId);
    return { id: projectId };
  });
}
export async function workspace(user: Principal, projectId: string): Promise<Workspace> {
  id.parse(projectId);
  const { project, permission } = await access(database(), user, projectId);
  const db = database();
  const results = await Promise.all([
    db.query('SELECT * FROM revision WHERE project_id=$1 ORDER BY sequence DESC', [projectId]),
    db.query('SELECT * FROM issue WHERE project_id=$1 ORDER BY number DESC', [projectId]),
    db.query('SELECT * FROM anchor WHERE project_id=$1', [projectId]),
    db.query(
      "SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('body',e.body,'created_at',e.created_at) ORDER BY e.created_at) FROM comment_edit e WHERE e.comment_id=c.id),'[]') history FROM comment c WHERE project_id=$1 ORDER BY created_at",
      [projectId],
    ),
    db.query('SELECT * FROM comparison WHERE project_id=$1 ORDER BY created_at DESC', [projectId]),
    db.query('SELECT * FROM finding WHERE project_id=$1', [projectId]),
    db.query('SELECT * FROM review_round WHERE project_id=$1 ORDER BY created_at DESC', [
      projectId,
    ]),
    db.query(
      'SELECT a.* FROM review_assignment a JOIN review_round r ON r.id=a.round_id WHERE r.project_id=$1',
      [projectId],
    ),
    db.query(
      'SELECT m.*,u.name,u.email FROM project_member m JOIN "user" u ON u.id=m.user_id WHERE project_id=$1',
      [projectId],
    ),
    db.query('SELECT * FROM audit_event WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100', [
      projectId,
    ]),
    db.query(
      'SELECT id,state,progress,error,kind FROM job WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50',
      [projectId],
    ),
  ]);
  const [
    revisions,
    issues,
    anchors,
    comments,
    comparisons,
    findings,
    rounds,
    assignments,
    members,
    activity,
    jobs,
  ] = results.map((r) => r.rows);
  return {
    project,
    permission,
    revisions,
    issues,
    anchors,
    comments,
    comparisons,
    findings,
    rounds,
    assignments,
    members,
    activity,
    jobs,
  } as Workspace;
}
export async function updateProject(user: Principal, projectId: string, body: unknown) {
  const input = projectInput
    .extend({ version: z.number().int(), archived: z.boolean() })
    .parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(
      permission.designer || permission.administrator,
      403,
      'Project management permission required.',
    );
    if (project.archived !== input.archived)
      requireThat(permission.administrator, 403, 'Only administrators can archive projects.');
    checkVersion(project.version, input.version);
    await db.query(
      'UPDATE project SET name=$2,sku=$3,product=$4,pack_size=$5,market=$6,language=$7,archived=$8,version=version+1 WHERE id=$1',
      [
        projectId,
        input.name,
        input.sku,
        input.product,
        input.pack_size,
        input.market,
        input.language,
        input.archived,
      ],
    );
    await audit(db, user, projectId, 'project.updated', projectId);
    return { ok: true };
  });
}
export async function setMember(user: Principal, projectId: string, body: unknown) {
  const input = z
    .object({
      user_id: id,
      designer: z.boolean(),
      reviewer: z.boolean(),
      scopes: z.array(z.enum(['marketing', 'qa'])).max(2),
      version: z.number().int(),
      remove: z.boolean().default(false),
    })
    .parse(body);
  requireThat(
    input.reviewer || !input.scopes.length,
    400,
    'Review scope requires reviewer capability.',
  );
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(permission.administrator, 403, 'Only administrators can manage membership.');
    checkVersion(project.version, input.version);
    requireThat(
      (
        await db.query(
          'SELECT 1 FROM member WHERE user_id=$1 AND organization_id=$2 AND (active OR $3)',
          [input.user_id, user.organization_id, input.remove],
        )
      ).rowCount,
      400,
      'User is not an active organization member.',
    );
    if (input.remove) {
      await db.query('DELETE FROM project_member WHERE project_id=$1 AND user_id=$2', [
        projectId,
        input.user_id,
      ]);
    } else
      await db.query(
        'INSERT INTO project_member(project_id,user_id,designer,reviewer,scopes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,user_id) DO UPDATE SET designer=$3,reviewer=$4,scopes=$5',
        [projectId, input.user_id, input.designer, input.reviewer, [...new Set(input.scopes)]],
      );
    await db.query(
      "UPDATE review_round SET state='superseded' WHERE project_id=$1 AND state='open'",
      [projectId],
    );
    await db.query("UPDATE project SET version=version+1,status='draft' WHERE id=$1", [projectId]);
    await audit(db, user, projectId, 'membership.updated', input.user_id);
    return { ok: true };
  });
}
export async function projectRevision(db: Connection, projectId: string, revisionId: string) {
  const row = (
    await db.query('SELECT * FROM revision WHERE id=$1 AND project_id=$2', [revisionId, projectId])
  ).rows[0];
  requireThat(row, 400, 'Revision does not belong to this project.');
  return row;
}
