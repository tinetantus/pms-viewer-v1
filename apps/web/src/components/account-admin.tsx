'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
type Account = { user_id: string; name: string; email: string; role: string; active: boolean };
export function AccountAdmin() {
  const [members, setMembers] = useState<Account[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    void api<Account[]>('members')
      .then(setMembers)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h3>Workspace accounts</h3>
      {error && <p className="error">{error}</p>}
      {members.map((m) => (
        <div className="history-row" key={m.user_id}>
          <div>
            <strong>{m.name}</strong>
            <small style={{ display: 'block' }}>
              {m.email} · {m.role}
            </small>
          </div>
          <button
            onClick={async () => {
              try {
                await api(`members/${m.user_id}`, { active: !m.active });
                setMembers(await api<Account[]>('members'));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {m.active ? 'Disable access' : 'Restore access'}
          </button>
        </div>
      ))}
    </section>
  );
}
