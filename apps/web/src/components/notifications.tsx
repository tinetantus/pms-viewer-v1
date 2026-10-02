'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { api, date } from '@/lib/client';
type Notice = {
  id: string;
  project_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
};
export function Notifications() {
  const [items, setItems] = useState<Notice[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(
    () =>
      api<Notice[]>('notifications')
        .then(setItems)
        .catch(() => setError('Notifications unavailable')),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className="notification-control">
      <button onClick={() => setOpen(!open)} aria-label="Notifications">
        <Bell size={17} />
        {items.filter((n) => !n.read_at).length || ''}
      </button>
      {open && (
        <div className="notification-popover">
          <h3>Workspace updates</h3>
          {error && <p>{error}</p>}
          <button
            className="text-button"
            onClick={async () => {
              await api('notifications', {});
              await load();
            }}
          >
            Mark all as read
          </button>
          {items.length ? (
            items.map((n) => (
              <Link className="notification-item" key={n.id} href={`/projects/${n.project_id}`}>
                <strong>
                  {n.read_at ? '' : '● '}
                  {n.message}
                </strong>
                <small>{date(n.created_at)}</small>
              </Link>
            ))
          ) : (
            <p className="fine">You’re all caught up.</p>
          )}
        </div>
      )}
    </div>
  );
}
