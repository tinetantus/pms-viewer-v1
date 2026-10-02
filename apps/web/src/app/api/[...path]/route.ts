import { z } from 'zod';
import { createHash } from 'node:crypto';
import { database, transaction } from '../../../../../../packages/db';
import { Problem, requireThat, id } from '../../../../../../packages/domain';
import { principal, sameOrigin, access, audit } from '@/lib/access';
import { listProjects, createProject, workspace, updateProject, setMember } from '@/lib/projects';
import { uploadIntent, transfer, finalize } from '@/lib/uploads';
import { createIssue, issueCommand } from '@/lib/issues';
import { reviewCommand } from '@/lib/reviews';
import { compare, disposition } from '@/lib/comparisons';
import { invite, acceptInvite } from '@/lib/invitations';
import { getObject } from '@/lib/storage';
import { rateLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url),
      parts = url.pathname.split('/').filter(Boolean).slice(1);
    const [resource, projectId, section, targetId, command] = parts;
    const method = request.method;
    if (method !== 'GET') sameOrigin(request);
    const body = async () => {
      requireThat(
        Number(request.headers.get('content-length') || 0) < 65536,
        413,
        'Request too large.',
      );
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = request.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length >= 65536) {
            await reader.cancel();
            throw new Problem(413, 'Request too large.');
          }
          chunks.push(value);
        }
      }
      const text = Buffer.concat(chunks).toString('utf8');
      return text ? JSON.parse(text) : {};
    };
    if (resource === 'invitations' && projectId === 'accept' && method === 'POST') {
      await rateLimit('invitation-accept', 20);
      return Response.json(await acceptInvite(await body()));
    }
    const user = await principal(request);
    if (method !== 'GET') await rateLimit(`mutate:${user.id}`, 120);
    let result: unknown;
    if (resource === 'me') result = user;
    else if (resource === 'members' && projectId && method === 'POST') {
      requireThat(user.role === 'administrator', 403, 'Administrator access required.');
      id.parse(projectId);
      const input = z.object({ active: z.boolean() }).parse(await body());
      result = await transaction(async (db) => {
        await db.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE', [
          user.organization_id,
        ]);
        requireThat(
          projectId !== user.id || input.active,
          409,
          'You cannot disable your own administrator access.',
        );
        const changed = await db.query(
          'UPDATE member SET active=$3 WHERE user_id=$1 AND organization_id=$2 RETURNING user_id',
          [projectId, user.organization_id, input.active],
        );
        requireThat(changed.rowCount, 404, 'Member not found.');
        if (!input.active) await db.query('DELETE FROM session WHERE "userId"=$1', [projectId]);
        await audit(
          db,
          user,
          null,
          input.active ? 'account.enabled' : 'account.disabled',
          projectId,
        );
        return { ok: true };
      });
    } else if (resource === 'members' && method === 'GET') {
      requireThat(user.role === 'administrator', 403, 'Administrator access required.');
      result = (
        await database().query(
          'SELECT m.user_id,m.role,m.active,u.name,u.email FROM member m JOIN "user" u ON u.id=m.user_id WHERE m.organization_id=$1',
          [user.organization_id],
        )
      ).rows;
    } else if (resource === 'invitations' && method === 'POST')
      result = await invite(user, await body());
    else if (resource === 'notifications') {
      if (method === 'POST') {
        await database().query('UPDATE notification SET read_at=now() WHERE user_id=$1', [user.id]);
        result = { ok: true };
      } else
        result = (
          await database().query(
            'SELECT n.* FROM notification n WHERE n.user_id=$1 AND EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=n.project_id AND m.user_id=$1) ORDER BY n.created_at DESC LIMIT 50',
            [user.id],
          )
        ).rows;
    } else if (resource === 'projects') {
      if (!projectId)
        result =
          method === 'POST'
            ? await createProject(user, await body())
            : await listProjects(user, url);
      else {
        id.parse(projectId);
        if (targetId) id.parse(targetId);
        if (!section)
          result =
            method === 'GET'
              ? await workspace(user, projectId)
              : await updateProject(user, projectId, await body());
        else if (section === 'members' && method === 'POST')
          result = await setMember(user, projectId, await body());
        else if (section === 'uploads' && method === 'POST' && !targetId)
          result = await uploadIntent(user, projectId, await body());
        else if (section === 'uploads' && targetId && method === 'PUT')
          result = await transfer(user, projectId, targetId, request);
        else if (section === 'uploads' && targetId && command === 'finalize' && method === 'POST')
          result = await finalize(user, projectId, targetId);
        else if (section === 'issues' && method === 'POST')
          result = targetId
            ? await issueCommand(user, projectId, targetId, await body())
            : await createIssue(user, projectId, await body());
        else if (section === 'review' && method === 'POST')
          result = await reviewCommand(user, projectId, await body());
        else if (section === 'comparisons' && method === 'POST')
          result = await compare(user, projectId, await body());
        else if (section === 'findings' && targetId && method === 'POST')
          result = await disposition(user, projectId, targetId, await body());
        else if (section === 'jobs' && targetId && method === 'POST')
          result = await transaction(async (db) => {
            const { permission, project } = await access(db, user, projectId, true);
            requireThat(
              (permission.designer || permission.reviewer) &&
                !project.archived &&
                project.status !== 'approved',
              403,
              'Active project and editor capability required.',
            );
            const input = z
              .object({ action: z.enum(['retry', 'cancel']).default('retry') })
              .parse(await body());
            if (input.action === 'cancel') {
              const job = (
                await db.query(
                  "UPDATE job SET state='cancelled',lease_token=NULL,lease_until=NULL,error='Cancelled by reviewer' WHERE id=$1 AND project_id=$2 AND state IN ('queued','running') RETURNING *",
                  [targetId, projectId],
                )
              ).rows[0];
              requireThat(job, 409, 'Job is no longer cancellable.');
              await db.query(
                `UPDATE ${job.kind === 'revision' ? 'revision' : 'comparison'} SET state=$2,error='Processing cancelled; retry when ready.' WHERE id=$1`,
                [job.target_id, job.kind === 'revision' ? 'failed' : 'cancelled'],
              );
              await audit(db, user, projectId, 'job.cancelled', targetId);
              return { ok: true };
            }
            const job = (
              await db.query(
                "UPDATE job SET state='queued',attempts=0,error=NULL,available_at=now() WHERE id=$1 AND project_id=$2 AND state IN ('failed','cancelled') RETURNING *",
                [targetId, projectId],
              )
            ).rows[0];
            requireThat(job, 409, 'Only failed jobs can be retried.');
            await db.query(
              `UPDATE ${job.kind === 'revision' ? 'revision' : 'comparison'} SET state='queued',error=NULL WHERE id=$1`,
              [job.target_id],
            );
            await audit(db, user, projectId, 'job.retried', targetId);
            return { ok: true };
          });
        else if (section === 'files' && targetId && method === 'GET') {
          await access(database(), user, projectId);
          const revision = (
            await database().query('SELECT * FROM revision WHERE id=$1 AND project_id=$2', [
              targetId,
              projectId,
            ])
          ).rows[0];
          requireThat(revision, 404, 'Revision not found.');
          const data = await getObject(revision.object_key);
          requireThat(
            createHash('sha256').update(data).digest('hex') === revision.sha256,
            409,
            'Stored original failed checksum verification. Contact your administrator.',
          );
          return new Response(new Uint8Array(data), {
            headers: {
              'Content-Type': revision.mime,
              'Content-Length': String(data.length),
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(revision.filename)}`,
            },
          });
        } else if (section === 'assets' && method === 'GET') {
          await access(database(), user, projectId);
          const key = url.searchParams.get('key') || '';
          requireThat(
            key.startsWith(`${projectId}/generated/`) &&
              !key.includes('..') &&
              key.endsWith('.png'),
            403,
            'Invalid asset key.',
          );
          return new Response(new Uint8Array(await getObject(key)), {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } else throw new Problem(404, 'Endpoint not found.');
      }
    } else throw new Problem(404, 'Endpoint not found.');
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (error) {
    const status =
      error instanceof Problem
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    if (status === 500)
      console.error(
        JSON.stringify({ requestId, error: error instanceof Error ? error.name : 'UnknownError' }),
      );
    return Response.json(
      {
        error:
          status === 500
            ? 'The operation failed. Try again or contact your administrator.'
            : error instanceof Error
              ? error.message
              : 'Invalid request',
        requestId,
      },
      { status },
    );
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
