import { z } from 'zod';
import { transaction } from '../../../../packages/db';
import { enqueueComparison } from '../../../../packages/db/jobs';
import {
  id,
  geometry,
  requireThat,
  checkVersion,
  type Principal,
} from '../../../../packages/domain';
import { access, audit } from './access';
import { projectRevision } from './projects';

export async function compare(user: Principal, projectId: string, body: unknown) {
  const input = z
    .object({
      before_id: id,
      after_id: id,
      exclusions: z
        .array(z.object({ page: z.number().int().min(1), geometry }))
        .max(50)
        .default([]),
      page_map: z
        .array(z.object({ before: z.number().int().min(1), after: z.number().int().min(1) }))
        .max(50)
        .default([]),
    })
    .parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(
      !project.archived &&
        project.status !== 'approved' &&
        (permission.designer || permission.reviewer),
      403,
      'An active review and designer/reviewer capability are required.',
    );
    const before = await projectRevision(db, projectId, input.before_id),
      after = await projectRevision(db, projectId, input.after_id);
    requireThat(
      before.id !== after.id && before.state === 'ready' && after.state === 'ready',
      400,
      'Choose two different viewable revisions.',
    );
    if (input.page_map.length) {
      requireThat(
        new Set(input.page_map.map((m) => m.before)).size === input.page_map.length &&
          new Set(input.page_map.map((m) => m.after)).size === input.page_map.length,
        400,
        'Page mappings must be one-to-one.',
      );
      requireThat(
        input.page_map.every(
          (m) => m.before <= before.pages.length && m.after <= after.pages.length,
        ),
        400,
        'Mapped page does not exist.',
      );
    }
    const comparisonId = await enqueueComparison(
      db,
      projectId,
      before,
      after,
      user.id,
      input.exclusions,
      input.page_map,
    );
    await audit(db, user, projectId, 'comparison.created', comparisonId);
    return { id: comparisonId };
  });
}
export async function disposition(
  user: Principal,
  projectId: string,
  findingId: string,
  body: unknown,
) {
  const input = z
    .object({
      version: z.number().int(),
      disposition: z.enum(['expected', 'needs_attention', 'comparison_noise', 'unreviewed']),
      reason: z.string().trim().min(1).max(2000),
      issue_id: id.nullable().optional(),
    })
    .parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(
      permission.reviewer && !project.archived && project.status !== 'approved',
      403,
      'Reviewer capability required on an active review.',
    );
    const finding = (
      await db.query('SELECT * FROM finding WHERE id=$1 AND project_id=$2 FOR UPDATE', [
        findingId,
        projectId,
      ])
    ).rows[0];
    requireThat(finding, 404, 'Finding not found.');
    checkVersion(finding.version, input.version);
    if (input.issue_id)
      requireThat(
        (
          await db.query('SELECT 1 FROM issue WHERE id=$1 AND project_id=$2', [
            input.issue_id,
            projectId,
          ])
        ).rowCount,
        400,
        'Linked issue must belong to the project.',
      );
    await db.query(
      'UPDATE finding SET disposition=$2,reason=$3,reviewed_by=$4,issue_id=$5,version=version+1 WHERE id=$1',
      [
        findingId,
        input.disposition,
        input.reason,
        user.id,
        input.issue_id === undefined ? finding.issue_id : input.issue_id,
      ],
    );
    await audit(db, user, projectId, 'finding.reviewed', findingId, input);
    return { ok: true };
  });
}
