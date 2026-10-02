'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AccountAdmin } from './account-admin';
import { Notifications } from './notifications';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Plus,
  Search,
  Layers,
  LogOut,
  ShieldCheck,
  Clock3,
  FolderOpen,
} from 'lucide-react';
import { api, date, label } from '@/lib/client';
import type { Principal, Project } from '../../../../packages/domain';

export function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<Principal | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [assignee, setAssignee] = useState(''),
    [assignmentOptions, setAssignmentOptions] = useState<{ user_id: string; name: string }[]>([]),
    [archived, setArchived] = useState(false),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [create, setCreate] = useState(false),
    [admin, setAdmin] = useState(false),
    [busy, setBusy] = useState(false),
    [inviteUrl, setInviteUrl] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{
        projects: Project[];
        total: number;
        assignees: { user_id: string; name: string }[];
      }>(
        `projects?q=${encodeURIComponent(search)}&status=${status}&archived=${archived}&page=${page}&assignee=${assignee}`,
      );
      setProjects(result.projects);
      setAssignmentOptions(result.assignees);
      setTotal(result.total);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, status, archived, page, assignee]);
  useEffect(() => {
    void api<Principal>('me')
      .then(setUser)
      .catch(() => {
        router.push('/login');
      });
  }, [router]);
  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => void load(), 200);
      return () => clearTimeout(timer);
    }
  }, [user, load]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(event.currentTarget);
    try {
      const p = await api<{ id: string }>('projects', Object.fromEntries(f));
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function invitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ url: string }>(
        'invitations',
        Object.fromEntries(new FormData(event.currentTarget)),
      );
      setInviteUrl(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <div className="loading-page">Opening your workspace…</div>;
  return (
    <div className="dashboard">
      <aside className="app-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">P</span>proofroom
        </Link>
        <div className="workspace-badge">
          <span>4</span>
          <div>
            Packaging Review<small>INTERNAL WORKSPACE</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <button
          className="nav-item active"
          onClick={() => {
            setAdmin(false);
            setArchived(false);
          }}
        >
          <Layers size={18} /> All projects <span>{total}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setArchived(!archived);
            setAdmin(false);
          }}
        >
          <FolderOpen size={18} /> {archived ? 'Active projects' : 'Archive'}
        </button>
        {user.role === 'administrator' && (
          <button className="nav-item" onClick={() => setAdmin(!admin)}>
            <ShieldCheck size={18} /> Invite a teammate
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
          <div>
            {user.name}
            <small>{label(user.role)}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={async () => {
              await api('auth/sign-out', {});
              router.push('/login');
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-top">
          <span>
            Workspace <span className="muted">/</span> Projects
          </span>
          <Notifications />
          <span className="secure-label">
            <span className="dot" /> Private workspace
          </span>
        </header>
        <div className="dashboard-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">ARTWORK, ALIGNED.</p>
              <h1>{archived ? 'Archived projects' : 'Your proofing workspace'}</h1>
              <p className="muted">Every version, conversation, and decision. In one place.</p>
            </div>
            {['administrator', 'designer'].includes(user.role) && (
              <button className="primary" onClick={() => setCreate(true)}>
                <Plus size={18} /> New project
              </button>
            )}
          </div>
          <div className="stats-strip">
            <div>
              <span className="stat-icon">
                <Layers size={20} />
              </span>
              <div>
                <strong>{total}</strong>
                <span>Matching projects</span>
              </div>
            </div>
            <div>
              <span className="stat-icon amber">
                <Clock3 size={20} />
              </span>
              <div>
                <strong>{projects.filter((p) => p.status === 'in_review').length}</strong>
                <span>In review on this page</span>
              </div>
            </div>
            <div>
              <span className="stat-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>{projects.filter((p) => p.status === 'approved').length}</strong>
                <span>Approved on this page</span>
              </div>
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => void load()}>Retry</button>
            </div>
          )}
          {admin && (
            <section className="panel admin-panel">
              <h2>Invite a teammate</h2>
              <p className="muted">
                Create a private, single-use invitation valid for 48 hours. Share it directly with
                your teammate.
              </p>
              <form onSubmit={invitation} className="form-row">
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Workspace role
                  <select name="role">
                    <option value="reviewer">Reviewer</option>
                    <option value="designer">Designer</option>
                    <option value="viewer">Viewer</option>
                    <option value="administrator">Administrator</option>
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Create invitation
                </button>
              </form>
              {inviteUrl && (
                <label>
                  Invitation link
                  <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
                </label>
              )}
              <AccountAdmin />
            </section>
          )}
          <div className="project-toolbar">
            <div className="tabs">
              <button
                className={!status ? 'selected' : ''}
                onClick={() => {
                  setStatus('');
                  setPage(1);
                }}
              >
                All projects
              </button>
              <button
                className={status === 'in_review' ? 'selected' : ''}
                onClick={() => {
                  setStatus('in_review');
                  setPage(1);
                }}
              >
                In review
              </button>
              <button
                className={status === 'approved' ? 'selected' : ''}
                onClick={() => {
                  setStatus('approved');
                  setPage(1);
                }}
              >
                Approved
              </button>
            </div>
            <label className="search">
              <Search size={17} />
              <input
                aria-label="Search projects"
                placeholder="Search name or SKU…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          <select
            aria-label="Project assignment filter"
            value={assignee}
            onChange={(e) => {
              setAssignee(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All accessible projects</option>
            <option value={user.id}>Assigned to me</option>
            {assignmentOptions
              .filter((m) => m.user_id !== user.id)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
          </select>
          {loading ? (
            <div className="empty-state">Loading projects…</div>
          ) : projects.length ? (
            <div className="project-grid">
              {projects.map((p, index) => (
                <Link className="project-card" href={`/projects/${p.id}`} key={p.id}>
                  <div className={`project-cover color-${index % 4}`}>
                    {p.thumbnail ? (
                      <img
                        className="project-thumbnail"
                        src={`/api/projects/${p.id}/assets?key=${encodeURIComponent(p.thumbnail)}`}
                        alt={`${p.name} latest proof`}
                      />
                    ) : (
                      <div className="pack-illustration">
                        <span>{p.sku || 'ARTWORK'}</span>
                        <strong>{p.product || p.name}</strong>
                        <i>PACKAGING PROOF</i>
                      </div>
                    )}
                    <span className={`status ${p.status}`}>{label(p.status)}</span>
                    <ArrowUpRight className="card-arrow" size={20} />
                  </div>
                  <div className="project-card-body">
                    <p className="card-overline">
                      {p.sku || 'NO SKU'} <span>·</span> {p.market || 'Market not set'}
                    </p>
                    <h2>{p.name}</h2>
                    <div className="project-card-meta">
                      <span>
                        <span className="mini-dot" /> {p.open_issues || 0} open issues
                      </span>
                      <span>
                        {p.current_sequence ? `Revision ${p.current_sequence}` : 'Awaiting artwork'}
                      </span>
                    </div>
                    <footer>
                      <span>
                        {p.reviewers?.map((m) => m.name).join(', ') || 'No reviewers assigned'}
                      </span>
                      <span>Updated {date(p.updated_at)}</span>
                      <span>↗</span>
                    </footer>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <FolderOpen size={36} />
              <h2>{search ? 'No matching projects' : 'Room for your next proof'}</h2>
              <p>Create a project, upload the first revision, and invite your reviewers.</p>
              {!search && ['administrator', 'designer'].includes(user.role) && (
                <button onClick={() => setCreate(true)} className="primary">
                  Create a project
                </button>
              )}
            </div>
          )}
          <div className="pagination">
            <span>{total} projects</span>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button disabled={page * 24 >= total} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
          <footer className="dashboard-footer">
            A considered review makes a better final proof.
            <span>All times shown in Bangkok time.</span>
          </footer>
        </div>
      </main>
      {create && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <button className="modal-close" aria-label="Close" onClick={() => setCreate(false)}>
              ×
            </button>
            <p className="eyebrow">START SOMETHING PRECISE</p>
            <h2 id="create-title">New artwork project</h2>
            <form onSubmit={submit}>
              <label>
                Project name
                <input
                  autoFocus
                  name="name"
                  required
                  maxLength={180}
                  placeholder="e.g. Balance cereal drink · dark chocolate"
                />
              </label>
              <div className="form-grid">
                {[
                  ['sku', 'SKU'],
                  ['product', 'Product'],
                  ['pack_size', 'Pack size'],
                  ['market', 'Market'],
                  ['language', 'Language'],
                ].map(([name, title]) => (
                  <label key={name}>
                    {title}
                    <input name={name} />
                  </label>
                ))}
              </div>
              <p className="fine">
                Upload artwork and assign reviewers after creating the project.
              </p>
              {error && <p className="error">{error}</p>}
              <button className="primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create project'}
                <ArrowUpRight size={18} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
