import { createHash } from 'node:crypto';
import { z } from 'zod';
import { database, transaction } from '../../../../packages/db';
import { requireThat, type Principal } from '../../../../packages/domain';
import { access, audit } from './access';
import { getObject, putObject } from './storage';

export async function uploadIntent(user: Principal, projectId: string, body: unknown) {
  const limit = Number(process.env.UPLOAD_MAX_BYTES || 104857600);
  const input = z
    .object({
      filename: z.string().min(1).max(250),
      byte_size: z.number().int().min(1).max(limit),
      notes: z.string().max(10000).default(''),
    })
    .parse(body);
  const { project, permission } = await access(database(), user, projectId);
  requireThat(
    permission.designer && !project.archived,
    403,
    'An active project and designer capability are required.',
  );
  const intentId = crypto.randomUUID();
  await database().query(
    'INSERT INTO upload_intent(id,project_id,user_id,object_key,filename,notes,byte_size) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      intentId,
      projectId,
      user.id,
      `${projectId}/originals/${intentId}`,
      input.filename.replace(/[\\/\r\n]/g, '_'),
      input.notes,
      input.byte_size,
    ],
  );
  return { id: intentId };
}
export async function transfer(
  user: Principal,
  projectId: string,
  intentId: string,
  request: Request,
) {
  // Intent row lock prevents concurrent writers to the immutable key. Size is bounded while reading.
  return transaction(async (db) => {
    const { permission } = await access(db, user, projectId);
    requireThat(permission.designer, 403, 'Designer capability required.');
    const intent = (
      await db.query(
        'SELECT * FROM upload_intent WHERE id=$1 AND project_id=$2 AND user_id=$3 AND expires_at>now() FOR UPDATE',
        [intentId, projectId, user.id],
      )
    ).rows[0];
    requireThat(intent, 404, 'Upload intent expired or unavailable.');
    if (intent.state !== 'pending') return { ok: true };
    requireThat(request.body, 400, 'File bytes are required.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > Number(intent.byte_size)) {
        await reader.cancel();
        requireThat(false, 413, 'File exceeds declared size.');
      }
      chunks.push(part.value);
    }
    requireThat(
      size === Number(intent.byte_size),
      400,
      'Transferred file size differs from declared size.',
    );
    const data = Buffer.concat(chunks);
    const mime =
      data.subarray(0, 5).toString() === '%PDF-'
        ? 'application/pdf'
        : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? 'image/png'
          : data[0] === 255 && data[1] === 216 && data[2] === 255
            ? 'image/jpeg'
            : null;
    requireThat(mime, 415, 'Upload a PDF, PNG, or JPEG file.');
    const sha = createHash('sha256').update(data).digest('hex');
    try {
      await putObject(intent.object_key, data, mime);
    } catch (error) {
      // Recover a successful object write followed by an interrupted database commit.
      const existing = await getObject(intent.object_key).catch(() => null);
      if (!existing || createHash('sha256').update(existing).digest('hex') !== sha) throw error;
    }
    await db.query("UPDATE upload_intent SET state='uploaded',mime=$2,sha256=$3 WHERE id=$1", [
      intentId,
      mime,
      sha,
    ]);
    return { ok: true };
  });
}
export async function finalize(user: Principal, projectId: string, intentId: string) {
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(
      permission.designer && !project.archived,
      403,
      'Designer capability required on an active project.',
    );
    const intent = (
      await db.query(
        'SELECT * FROM upload_intent WHERE id=$1 AND project_id=$2 AND user_id=$3 FOR UPDATE',
        [intentId, projectId, user.id],
      )
    ).rows[0];
    requireThat(intent, 404, 'Upload intent not found.');
    if (intent.revision_id) return { id: intent.revision_id };
    requireThat(
      intent.state === 'uploaded' && new Date(intent.expires_at) > new Date(),
      409,
      'Complete the file transfer before finalizing.',
    );
    const data = await getObject(intent.object_key);
    requireThat(
      data.length === Number(intent.byte_size) &&
        createHash('sha256').update(data).digest('hex') === intent.sha256,
      409,
      'Stored file checksum does not match.',
    );
    const revisionId = crypto.randomUUID();
    const sequence = (
      await db.query('SELECT COALESCE(max(sequence),0)+1 n FROM revision WHERE project_id=$1', [
        projectId,
      ])
    ).rows[0].n;
    await db.query(
      'INSERT INTO revision(id,project_id,sequence,object_key,sha256,mime,byte_size,filename,notes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        revisionId,
        projectId,
        sequence,
        intent.object_key,
        intent.sha256,
        intent.mime,
        intent.byte_size,
        intent.filename,
        intent.notes,
        user.id,
      ],
    );
    await db.query("UPDATE upload_intent SET state='finalized',revision_id=$2 WHERE id=$1", [
      intentId,
      revisionId,
    ]);
    await db.query(
      "UPDATE project SET current_revision_id=$2,status='draft',version=version+1 WHERE id=$1",
      [projectId, revisionId],
    );
    await db.query(
      "UPDATE review_round SET state='superseded' WHERE project_id=$1 AND state='open'",
      [projectId],
    );
    await db.query("INSERT INTO job(id,project_id,target_id,kind) VALUES($1,$2,$3,'revision')", [
      crypto.randomUUID(),
      projectId,
      revisionId,
    ]);
    await audit(db, user, projectId, 'revision.uploaded', revisionId, { sequence });
    return { id: revisionId };
  });
}
