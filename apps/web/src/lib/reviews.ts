import { z } from 'zod';
import { transaction } from '../../../../packages/db';
import { id, requireThat, checkVersion, type Principal } from '../../../../packages/domain';
import { access, audit, notify } from './access';
import { projectRevision } from './projects';

export async function reviewCommand(user: Principal, projectId: string, body: unknown) {
  const input = z
    .object({
      action: z.enum(['submit', 'decision', 'manual', 'finalize', 'reopen']),
      version: z.number().int(),
      revision_id: id,
      round_id: id.optional(),
      scope: z.enum(['marketing', 'qa']).optional(),
      decision: z.enum(['approve', 'request_changes']).optional(),
      note: z.string().max(10000).default(''),
      acknowledge_nonblocking: z.boolean().default(false),
    })
    .parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(!project.archived, 409, 'Archived projects are read-only.');
    checkVersion(project.version, input.version);
    requireThat(
      project.current_revision_id === input.revision_id,
      409,
      'A newer revision exists. Reload before reviewing.',
    );
    const revision = await projectRevision(db, projectId, input.revision_id);
    requireThat(revision.state === 'ready', 409, 'Revision processing must finish before review.');
    if (input.action === 'reopen') {
      requireThat(
        (permission.reviewer || permission.administrator) && input.note.trim(),
        403,
        'Reopening requires reviewer or administrator permission and a reason.',
      );
      await db.query(
        "UPDATE review_round SET state='superseded' WHERE project_id=$1 AND state='open'",
        [projectId],
      );
      await db.query("UPDATE project SET status='draft',version=version+1 WHERE id=$1", [
        projectId,
      ]);
      await audit(db, user, projectId, 'review.reopened', input.revision_id, {
        reason: input.note,
      });
      return { ok: true };
    }
    requireThat(
      project.status !== 'approved',
      409,
      'Approved rounds are read-only. Reopen review first.',
    );
    if (input.action === 'submit') {
      requireThat(
        permission.designer || permission.reviewer,
        403,
        'Designer or reviewer capability required.',
      );
      const members = (
        await db.query(
          'SELECT pm.* FROM project_member pm JOIN member m ON m.user_id=pm.user_id WHERE pm.project_id=$1 AND pm.reviewer AND m.active',
          [projectId],
        )
      ).rows;
      requireThat(
        ['marketing', 'qa'].every((s) => members.some((m) => m.scopes.includes(s))),
        400,
        'Assign at least one marketing and one QA reviewer.',
      );
      await db.query(
        "UPDATE review_round SET state='superseded' WHERE project_id=$1 AND state='open'",
        [projectId],
      );
      const roundId = crypto.randomUUID();
      await db.query(
        'INSERT INTO review_round(id,project_id,revision_id,sha256,policy) VALUES($1,$2,$3,$4,$5)',
        [
          roundId,
          projectId,
          revision.id,
          revision.sha256,
          JSON.stringify({ all_required: true, findings_required: true }),
        ],
      );
      for (const member of members)
        for (const scope of member.scopes)
          await db.query('INSERT INTO review_assignment(round_id,user_id,scope) VALUES($1,$2,$3)', [
            roundId,
            member.user_id,
            scope,
          ]);
      await db.query("UPDATE project SET status='in_review',version=version+1 WHERE id=$1", [
        projectId,
      ]);
      await audit(db, user, projectId, 'review.submitted', roundId);
      await notify(db, projectId, 'A revision is ready for review');
      return { id: roundId };
    }
    requireThat(input.round_id, 400, 'A review round is required.');
    const round = (
      await db.query(
        "SELECT * FROM review_round WHERE id=$1 AND project_id=$2 AND revision_id=$3 AND state='open' FOR UPDATE",
        [input.round_id, projectId, input.revision_id],
      )
    ).rows[0];
    requireThat(
      round && round.sha256 === revision.sha256,
      409,
      'Review round has changed. Reload.',
    );
    if (input.action === 'decision') {
      requireThat(
        permission.reviewer && input.scope && input.decision,
        403,
        'An assigned reviewer and scope are required.',
      );
      if (input.decision === 'request_changes')
        requireThat(input.note.trim(), 400, 'Explain the requested changes.');
      const result = await db.query(
        'UPDATE review_assignment SET decision=$4,note=$5,decided_at=now() WHERE round_id=$1 AND user_id=$2 AND scope=$3',
        [round.id, user.id, input.scope, input.decision, input.note],
      );
      requireThat(result.rowCount, 403, 'You are not assigned this review scope.');
      const requested = (
        await db.query(
          "SELECT 1 FROM review_assignment WHERE round_id=$1 AND decision='request_changes'",
          [round.id],
        )
      ).rowCount;
      await db.query('UPDATE project SET status=$2 WHERE id=$1', [
        projectId,
        requested ? 'changes_requested' : 'in_review',
      ]);
    } else if (input.action === 'manual') {
      requireThat(
        permission.reviewer && permission.scopes.includes('qa') && input.note.trim(),
        403,
        'QA reviewer and manual comparison reason required.',
      );
      await db.query('UPDATE review_round SET manual_by=$2,manual_reason=$3 WHERE id=$1', [
        round.id,
        user.id,
        input.note,
      ]);
    } else {
      requireThat(permission.reviewer, 403, 'Reviewer capability required.');
      const assignments = (
        await db.query('SELECT * FROM review_assignment WHERE round_id=$1', [round.id])
      ).rows;
      requireThat(
        assignments.length > 0 && assignments.every((a) => a.decision === 'approve'),
        409,
        'Every assigned reviewer must approve; requests for changes block finalization.',
      );
      const issues = (
        await db.query("SELECT * FROM issue WHERE project_id=$1 AND status<>'closed'", [projectId])
      ).rows;
      requireThat(
        !issues.some((i) => i.severity === 'blocking'),
        409,
        'Resolve all blocking issues before approval.',
      );
      requireThat(
        !issues.length || input.acknowledge_nonblocking,
        409,
        'Acknowledge remaining nonblocking issues.',
      );
      const previous = (
        await db.query(
          'SELECT id FROM revision WHERE project_id=$1 AND sequence<$2 ORDER BY sequence DESC LIMIT 1',
          [projectId, revision.sequence],
        )
      ).rows[0];
      if (previous) {
        const comparison = (
          await db.query(
            'SELECT * FROM comparison WHERE project_id=$1 AND before_id=$2 AND after_id=$3 ORDER BY created_at DESC LIMIT 1',
            [projectId, previous.id, revision.id],
          )
        ).rows[0];
        requireThat(
          !comparison || !['queued', 'running'].includes(comparison.state),
          409,
          'Wait for active comparison to finish or cancel it before manual comparison.',
        );
        if (comparison?.state === 'succeeded')
          requireThat(
            !(
              await db.query(
                "SELECT 1 FROM finding WHERE comparison_id=$1 AND disposition='unreviewed'",
                [comparison.id],
              )
            ).rowCount,
            409,
            'Review every change finding before approval.',
          );
        else
          requireThat(
            round.manual_by && round.manual_reason,
            409,
            'QA must record manual comparison when analysis is missing, incomplete, or failed.',
          );
        if (comparison)
          requireThat(
            !(
              await db.query(
                "SELECT 1 FROM finding WHERE comparison_id=$1 AND disposition='unreviewed'",
                [comparison.id],
              )
            ).rowCount,
            409,
            'Manual comparison does not waive existing unreviewed findings.',
          );
      }
      await db.query("UPDATE review_round SET state='approved' WHERE id=$1", [round.id]);
      await db.query("UPDATE project SET status='approved' WHERE id=$1", [projectId]);
    }
    await db.query('UPDATE project SET version=version+1 WHERE id=$1', [projectId]);
    await audit(db, user, projectId, `review.${input.action}`, round.id, {
      note: input.note,
      decision: input.decision,
      scope: input.scope,
      acknowledge_nonblocking: input.acknowledge_nonblocking,
    });
    await notify(db, projectId, `Review: ${input.action}`);
    return { ok: true };
  });
}
