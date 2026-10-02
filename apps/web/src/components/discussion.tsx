'use client';
import { useState } from 'react';
import { date } from '@/lib/client';
type Comment = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  parent_id?: string | null;
  edited_at?: string | null;
  history?: { body: string; created_at: string }[];
};
export function Discussion({
  comments,
  members,
  userId,
  editable,
  busy,
  onSubmit,
}: {
  comments: Comment[];
  members: { user_id: string; name: string }[];
  userId: string;
  editable: boolean;
  busy: boolean;
  onSubmit: (body: object) => Promise<unknown>;
}) {
  const [text, setText] = useState(''),
    [reply, setReply] = useState(''),
    [editing, setEditing] = useState(''),
    [mentions, setMentions] = useState<string[]>([]);
  return (
    <>
      <h3>Conversation</h3>
      {comments.map((comment) => (
        <div
          className="comment"
          key={comment.id}
          style={
            comment.parent_id ? { marginLeft: 14, borderLeft: '3px solid #d0ddbc' } : undefined
          }
        >
          <strong>
            {members.find((m) => m.user_id === comment.author_id)?.name || 'Team member'}
          </strong>
          {comment.parent_id && <small> · reply</small>}
          <p>{comment.body}</p>
          <small>
            {date(comment.created_at)}
            {comment.edited_at ? ' · edited' : ''}
          </small>
          {editable && (
            <div className="form-row">
              <button
                className="text-button"
                onClick={() => {
                  setReply(comment.id);
                  setEditing('');
                }}
              >
                Reply
              </button>
              {comment.author_id === userId && (
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(comment.id);
                    setReply('');
                    setText(comment.body);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
          )}
          {Boolean(comment.history?.length) && (
            <details>
              <summary className="fine">Edit history</summary>
              {comment.history!.map((entry, i) => (
                <p key={i} className="fine">
                  {date(entry.created_at)}
                  <br />
                  {entry.body}
                </p>
              ))}
            </details>
          )}
        </div>
      ))}
      {editable && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await onSubmit({
              action: editing ? 'edit_comment' : 'comment',
              note: text,
              parent_id: reply || undefined,
              comment_id: editing || undefined,
              mentions: mentions.filter((id) =>
                text.includes(`@${members.find((m) => m.user_id === id)?.name}`),
              ),
            });
            if (result) {
              setText('');
              setReply('');
              setEditing('');
              setMentions([]);
            }
          }}
        >
          <label>
            {editing ? 'Edit your comment' : reply ? 'Reply to comment' : 'Add a comment'}
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required />
          </label>
          <label>
            Mention a teammate
            <select
              value=""
              onChange={(e) => {
                if (e.target.value)
                  setMentions((current) => [...new Set([...current, e.target.value])]);
                if (e.target.value)
                  setText(
                    (t) => `${t} @${members.find((m) => m.user_id === e.target.value)?.name} `,
                  );
              }}
            >
              <option value="">Choose teammate</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>{editing ? 'Save edit' : 'Post comment'}</button>
          {(editing || reply) && (
            <button
              type="button"
              onClick={() => {
                setEditing('');
                setReply('');
                setText('');
              }}
            >
              Cancel
            </button>
          )}
        </form>
      )}
    </>
  );
}
