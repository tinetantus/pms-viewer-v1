import { z } from 'zod';
import { transaction } from '../../../../packages/db';
import {
  issueInput,
  geometry,
  id,
  requireThat,
  checkVersion,
  type Principal,
  type Issue,
} from '../../../../packages/domain';
import { access, audit, notify } from './access';
import { projectRevision } from './projects';

export async function createIssue(user: Principal, projectId: string, body: unknown) {
  const input = issueInput.parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(permission.reviewer, 403, 'Reviewer capability required.');
    requireThat(
      !project.archived && project.status !== 'approved',
      409,
      'Reopen review before adding issues to approved or archived artwork.',
    );
    const revision = await projectRevision(db, projectId, input.revision_id);
    requireThat(
      revision.state === 'ready' && input.page <= revision.pages.length,
      400,
      'Choose a viewable page.',
    );
    if (input.assignee)
      requireThat(
        (
          await db.query('SELECT 1 FROM project_member WHERE project_id=$1 AND user_id=$2', [
            projectId,
            input.assignee,
          ])
        ).rowCount,
        400,
        'Assignee must belong to the project.',
      );
    const issueId = crypto.randomUUID();
    if (input.finding_id) {
      const finding = (
        await db.query(
          'SELECT f.*,c.after_id FROM finding f JOIN comparison c ON c.id=f.comparison_id WHERE f.id=$1 AND f.project_id=$2 FOR UPDATE OF f',
          [input.finding_id, projectId],
        )
      ).rows[0];
      requireThat(
        finding && finding.after_id === input.revision_id && finding.page === input.page,
        400,
        'Finding must refer to this revision and page.',
      );
      requireThat(!finding.issue_id, 409, 'This finding is already linked to an issue.');
      requireThat(input.finding_version !== undefined, 400, 'Finding version required.');
      checkVersion(finding.version, input.finding_version);
    }
    const number = (
      await db.query('SELECT COALESCE(max(number),0)+1 number FROM issue WHERE project_id=$1', [
        projectId,
      ])
    ).rows[0].number;
    await db.query(
      'INSERT INTO issue(id,project_id,number,title,description,category,severity,assignee,due_date,original_revision_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        issueId,
        projectId,
        number,
        input.title,
        input.description,
        input.category,
        input.severity,
        input.assignee,
        input.due_date,
        input.revision_id,
        user.id,
      ],
    );
    await db.query(
      "INSERT INTO anchor(id,project_id,issue_id,revision_id,page,geometry,state,created_by) VALUES($1,$2,$3,$4,$5,$6,'original',$7)",
      [
        crypto.randomUUID(),
        projectId,
        issueId,
        input.revision_id,
        input.page,
        JSON.stringify(input.geometry),
        user.id,
      ],
    );
    await audit(db, user, projectId, 'issue.created', issueId);
    if (input.finding_id) {
      await db.query(
        "UPDATE finding SET issue_id=$2,disposition='needs_attention',reason='Issue created from finding',reviewed_by=$3,version=version+1 WHERE id=$1",
        [input.finding_id, issueId, user.id],
      );
      await audit(db, user, projectId, 'finding.linked', input.finding_id, { issue_id: issueId });
    }
    await notify(db, projectId, `Issue #${number} opened`);
    return { id: issueId };
  });
}
export async function issueCommand(
  user: Principal,
  projectId: string,
  issueId: string,
  body: unknown,
) {
  const input = z
    .object({
      action: z.enum([
        'start',
        'ready',
        'verify',
        'reopen',
        'comment',
        'edit_comment',
        'anchor',
        'reject_anchor',
        'assign',
      ]),
      version: z.number().int(),
      revision_id: id.optional(),
      comment_id: id.optional(),
      parent_id: id.optional(),
      mentions: z.array(id).max(30).default([]),
      note: z.string().max(10000).default(''),
      page: z.number().int().min(1).optional(),
      geometry: geometry.optional(),
      assignee: id.nullable().optional(),
    })
    .parse(body);
  return transaction(async (db) => {
    const { project, permission } = await access(db, user, projectId, true);
    requireThat(
      permission.designer || permission.reviewer,
      403,
      'Designer or reviewer capability required.',
    );
    requireThat(
      !project.archived && project.status !== 'approved',
      409,
      'Reopen the approved review before making changes.',
    );
    const issue = (
      await db.query('SELECT * FROM issue WHERE id=$1 AND project_id=$2 FOR UPDATE', [
        issueId,
        projectId,
      ])
    ).rows[0] as Issue | undefined;
    requireThat(issue, 404, 'Issue not found.');
    checkVersion(issue.version, input.version);
    const mentions = [...new Set(input.mentions)];
    if (mentions.length) {
      requireThat(
        ['comment', 'edit_comment'].includes(input.action),
        400,
        'Mentions belong to comments.',
      );
      const valid = await db.query(
        'SELECT user_id FROM project_member WHERE project_id=$1 AND user_id=ANY($2::text[])',
        [projectId, mentions],
      );
      requireThat(
        valid.rowCount === mentions.length,
        400,
        'Mentioned users must belong to the project.',
      );
    }
    if (input.action === 'comment') {
      requireThat(input.note.trim(), 400, 'Comment cannot be empty.');
      if (input.parent_id)
        requireThat(
          (
            await db.query('SELECT 1 FROM comment WHERE id=$1 AND issue_id=$2 AND project_id=$3', [
              input.parent_id,
              issueId,
              projectId,
            ])
          ).rowCount,
          400,
          'Reply target must belong to this issue.',
        );
      await db.query(
        'INSERT INTO comment(id,project_id,issue_id,author_id,body,parent_id) VALUES($1,$2,$3,$4,$5,$6)',
        [crypto.randomUUID(), projectId, issueId, user.id, input.note, input.parent_id ?? null],
      );
    } else if (input.action === 'edit_comment') {
      requireThat(
        input.comment_id && input.note.trim(),
        400,
        'Comment and replacement text required.',
      );
      const comment = (
        await db.query(
          'SELECT * FROM comment WHERE id=$1 AND issue_id=$2 AND author_id=$3 FOR UPDATE',
          [input.comment_id, issueId, user.id],
        )
      ).rows[0];
      requireThat(comment, 403, 'Only the author may edit a comment.');
      await db.query('INSERT INTO comment_edit(id,comment_id,body,author_id) VALUES($1,$2,$3,$4)', [
        crypto.randomUUID(),
        comment.id,
        comment.body,
        user.id,
      ]);
      await db.query('UPDATE comment SET body=$2,edited_at=now() WHERE id=$1', [
        comment.id,
        input.note,
      ]);
    } else if (input.action === 'start') {
      requireThat(
        permission.designer && issue.status === 'open',
        409,
        'Only a designer can start an open issue.',
      );
      await db.query("UPDATE issue SET status='in_progress' WHERE id=$1", [issueId]);
    } else if (input.action === 'ready') {
      requireThat(
        permission.designer && ['open', 'in_progress'].includes(issue.status),
        409,
        'Only a designer can submit an open correction.',
      );
      requireThat(input.revision_id, 400, 'Choose the revision containing the fix.');
      const revision = await projectRevision(db, projectId, input.revision_id);
      requireThat(revision.state === 'ready', 409, 'Fix revision must be viewable.');
      await db.query(
        "UPDATE issue SET status='ready_for_verification',fix_revision_id=$2,fixed_by=$3,verified_revision_id=NULL WHERE id=$1",
        [issueId, input.revision_id, user.id],
      );
    } else if (input.action === 'verify') {
      requireThat(
        permission.reviewer && issue.status === 'ready_for_verification',
        409,
        'Reviewer verification requires a submitted correction.',
      );
      requireThat(issue.fixed_by !== user.id, 403, 'You cannot verify your own correction.');
      const fix = await projectRevision(db, projectId, issue.fix_revision_id!);
      requireThat(
        fix.uploaded_by !== user.id,
        403,
        'You cannot verify a correction in a revision you uploaded.',
      );
      requireThat(
        input.revision_id === issue.fix_revision_id &&
          input.revision_id === project.current_revision_id,
        409,
        'Verify the current candidate fix revision.',
      );
      await db.query("UPDATE issue SET status='closed',verified_revision_id=$2 WHERE id=$1", [
        issueId,
        input.revision_id,
      ]);
    } else if (input.action === 'reopen') {
      requireThat(permission.reviewer, 403, 'Reviewer capability required.');
      requireThat(input.note.trim(), 400, 'A reason is required to reopen.');
      await db.query("UPDATE issue SET status='open',verified_revision_id=NULL WHERE id=$1", [
        issueId,
      ]);
    } else if (input.action === 'reject_anchor') {
      requireThat(permission.reviewer && input.revision_id, 403, 'Reviewer and revision required.');
      const changed = await db.query(
        "UPDATE anchor SET state='unmapped' WHERE issue_id=$1 AND revision_id=$2 AND state='proposed'",
        [issueId, input.revision_id],
      );
      requireThat(changed.rowCount, 409, 'Only a proposed mapping can be rejected.');
    } else if (input.action === 'assign') {
      if (input.assignee)
        requireThat(
          (
            await db.query('SELECT 1 FROM project_member WHERE project_id=$1 AND user_id=$2', [
              projectId,
              input.assignee,
            ])
          ).rowCount,
          400,
          'Assignee must belong to the project.',
        );
      await db.query('UPDATE issue SET assignee=$2 WHERE id=$1', [issueId, input.assignee ?? null]);
    } else {
      requireThat(
        permission.reviewer && input.revision_id && input.geometry && input.page,
        400,
        'Reviewer, revision, page and geometry required.',
      );
      requireThat(
        input.revision_id !== issue.original_revision_id,
        409,
        'Original anchors are immutable.',
      );
      const revision = await projectRevision(db, projectId, input.revision_id);
      requireThat(input.page <= revision.pages.length, 400, 'Invalid page.');
      await db.query(
        "INSERT INTO anchor(id,project_id,issue_id,revision_id,page,geometry,state,created_by) VALUES($1,$2,$3,$4,$5,$6,'confirmed',$7) ON CONFLICT(issue_id,revision_id) DO UPDATE SET page=$5,geometry=$6,state='confirmed'",
        [
          crypto.randomUUID(),
          projectId,
          issueId,
          input.revision_id,
          input.page,
          JSON.stringify(input.geometry),
          user.id,
        ],
      );
    }
    await db.query('UPDATE issue SET version=version+1,updated_at=now() WHERE id=$1', [issueId]);
    await audit(db, user, projectId, `issue.${input.action}`, issueId, {
      note: input.note,
      revision_id: input.revision_id,
    });
    await notify(db, projectId, `Issue #${issue.number}: ${input.action}`);
    for (const mentioned of mentions)
      await db.query(
        'INSERT INTO notification(id,user_id,project_id,message) VALUES($1,$2,$3,$4)',
        [
          crypto.randomUUID(),
          mentioned,
          projectId,
          `${user.name} mentioned you in issue #${issue.number}`,
        ],
      );
    return { ok: true };
  });
}
