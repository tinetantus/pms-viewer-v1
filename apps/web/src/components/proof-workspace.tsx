'use client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Upload,
  PanelLeftClose,
  PanelRightClose,
  Hand,
  Square,
  MapPin,
  Ruler,
  RotateCw,
  Maximize,
  Columns2,
  Layers,
  Check,
  Plus,
  SlidersHorizontal,
} from 'lucide-react';
import { api, date, label } from '@/lib/client';
import { PageMappingEditor, type PageMapping } from './page-mapping';
import { Discussion } from './discussion';
import { Notifications } from './notifications';
import { PdfPane, type Tool, type Mark } from './pdf-pane';
import type { Workspace, Principal, Geometry, Member, Revision } from '../../../../packages/domain';

export function ProofWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [remapping, setRemapping] = useState(''),
    [pageMap, setPageMap] = useState<PageMapping[]>([]),
    [syncPages, setSyncPages] = useState(false);
  const [data, setData] = useState<Workspace | null>(null),
    [user, setUser] = useState<Principal | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [rightId, setRightId] = useState(''),
    [leftId, setLeftId] = useState(''),
    [page, setPage] = useState(1),
    [leftPage, setLeftPage] = useState(1),
    [zoom, setZoom] = useState(0.75),
    [leftZoom, setLeftZoom] = useState(0.75),
    [rotation, setRotation] = useState(0),
    [mode, setMode] = useState<'single' | 'split' | 'overlay'>('single'),
    [opacity, setOpacity] = useState(0.5),
    [tool, setTool] = useState<Tool>('pan'),
    [syncZoom, setSyncZoom] = useState(true),
    [syncPan, setSyncPan] = useState(true),
    [view, setView] = useState<{ x: number; y: number; source: string }>(),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true),
    [tab, setTab] = useState('issues'),
    [selected, setSelected] = useState(''),
    [filter, setFilter] = useState(''),
    [categoryFilter, setCategoryFilter] = useState(''),
    [severityFilter, setSeverityFilter] = useState(''),
    [assigneeFilter, setAssigneeFilter] = useState(''),
    [sourceFilter, setSourceFilter] = useState(''),
    [verificationFilter, setVerificationFilter] = useState(''),
    [showMarks, setShowMarks] = useState(true),
    [showChanges, setShowChanges] = useState(true),
    [focus, setFocus] = useState<Geometry>(),
    [draft, setDraft] = useState<Geometry | null>(null),
    [sourceFinding, setSourceFinding] = useState<{ id: string; version: number } | null>(null),
    [upload, setUpload] = useState(false),
    [settings, setSettings] = useState(false),
    [orgMembers, setOrgMembers] = useState<Member[]>([]),
    [exclusions, setExclusions] = useState<{ page: number; geometry: Geometry }[]>([]),
    [progress, setProgress] = useState(''),
    [compareId, setCompareId] = useState('');
  const load = useCallback(async () => {
    const result = await api<Workspace>(`projects/${projectId}`);
    setData(result);
    setRightId(
      (current) =>
        current ||
        result.revisions.find((r) => r.state === 'ready')?.id ||
        result.revisions[0]?.id ||
        '',
    );
    setLeftId(
      (current) => current || result.revisions.filter((r) => r.state === 'ready')[1]?.id || '',
    );
  }, [projectId]);
  useEffect(() => {
    void api<Principal>('me')
      .then(setUser)
      .catch(() => {
        router.push('/login');
      });
    const timer = setTimeout(() => void load().catch((e) => setError(e.message)), 0);
    return () => clearTimeout(timer);
  }, [load, router]);
  useEffect(() => {
    const timer = setInterval(() => void load().catch((e) => setError(e.message)), 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ id?: string }>(`projects/${projectId}/${path}`, body);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const right = data?.revisions.find((r) => r.id === rightId),
    left = data?.revisions.find((r) => r.id === leftId);
  const issue = data?.issues.find((i) => i.id === selected);
  const selectedAnchor = data?.anchors.find(
    (a) => a.issue_id === selected && a.revision_id === rightId,
  );
  const comparison =
    data?.comparisons.find((c) => c.id === compareId) ||
    data?.comparisons.find((c) => c.before_id === leftId && c.after_id === rightId);
  const findings = data?.findings.filter((f) => f.comparison_id === comparison?.id) || [];
  const round = data?.rounds.find(
    (r) => r.state === 'open' && r.revision_id === data.project.current_revision_id,
  );
  const canEdit = Boolean(data && !data.project.archived && data.project.status !== 'approved');
  function changeZoom(value: number) {
    const next = Math.max(0.2, Math.min(8, value));
    setZoom(next);
    if (syncZoom) setLeftZoom(next);
  }
  function fit(widthOnly = false) {
    const element = document.querySelector('.canvas-scroll');
    if (!element || !right?.pages[page - 1]) return;
    const m = right.pages[page - 1]!;
    const turned = (m.rotation + rotation) % 180 !== 0;
    changeZoom(
      Math.min(
        (element.clientWidth - 80) / (turned ? m.height : m.width),
        widthOnly ? 8 : (element.clientHeight - 80) / (turned ? m.width : m.height),
      ),
    );
  }
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (e.key === 'Escape') {
        setDraft(null);
        setTool('pan');
      }
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(8, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(0.2, z - 0.25));
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [router]);
  function jump(issueId: string) {
    setSelected(issueId);
    setTab('issues');
    const anchor = data?.anchors.find((a) => a.issue_id === issueId && a.revision_id === rightId);
    if (anchor) {
      setPage(anchor.page);
      setFocus({ ...anchor.geometry });
    }
  }
  function marks(revision?: Revision): Mark[] {
    if (!data || !revision) return [];
    const currentPage = revision.id === leftId ? leftPage : page;
    return [
      ...(showMarks
        ? data.anchors
            .filter(
              (a) =>
                a.revision_id === revision.id && a.page === currentPage && a.state !== 'unmapped',
            )
            .map((a) => ({
              id: a.issue_id,
              geometry: a.geometry,
              kind: a.state === 'proposed' ? ('proposed' as const) : ('issue' as const),
              label: `${a.state === 'proposed' ? 'Proposed location · ' : ''}Issue #${data.issues.find((i) => i.id === a.issue_id)?.number}`,
            }))
        : []),
      ...(showChanges && revision.id === rightId
        ? findings
            .filter((f) => f.page === page)
            .map((f) => ({
              id: f.id,
              geometry: f.geometry,
              kind: 'change' as const,
              label: label(f.kind),
            }))
        : []),
      ...(revision.id === rightId
        ? [...exclusions, ...(comparison?.config.exclusions || [])]
            .filter((e) => e.page === page)
            .map((e, i) => ({
              id: `excluded-${i}`,
              geometry: e.geometry,
              kind: 'exclusion' as const,
              label: 'Excluded from comparison',
            }))
        : []),
    ];
  }
  function onDraw(g: Geometry) {
    if (remapping && data) {
      const target = data.issues.find((i) => i.id === remapping);
      if (target)
        void act(`issues/${target.id}`, {
          action: 'anchor',
          version: target.version,
          revision_id: rightId,
          page,
          geometry: g,
        }).then((result) => {
          if (result) {
            setRemapping('');
            setTool('pan');
          }
        });
      return;
    }
    if (tool === 'exclude') setExclusions((current) => [...current, { page, geometry: g }]);
    else if (canEdit && data?.permission.reviewer) {
      setSourceFinding(null);
      setDraft(g);
    }
  }
  async function sendFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget),
      file = f.get('file') as File;
    if (!file?.size) return;
    setBusy(true);
    setError('');
    try {
      setProgress('Preparing upload…');
      const intent = await api<{ id: string }>(`projects/${projectId}/uploads`, {
        filename: file.name,
        byte_size: file.size,
        notes: f.get('notes') || '',
      });
      setProgress('Uploading original…');
      const response = await fetch(`/api/projects/${projectId}/uploads/${intent.id}`, {
        method: 'PUT',
        body: file,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setProgress('Creating revision…');
      const rev = await api<{ id: string }>(
        `projects/${projectId}/uploads/${intent.id}/finalize`,
        {},
      );
      setRightId(rev.id);
      setPage(1);
      setUpload(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function createIssue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !right) return;
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const result = await act('issues', {
      ...form,
      assignee: form.assignee || null,
      due_date: form.due_date || null,
      revision_id: right.id,
      page,
      geometry: draft,
      finding_id: sourceFinding?.id,
      finding_version: sourceFinding?.version,
    });
    if (result) {
      setDraft(null);
      setSourceFinding(null);
      setSelected(result.id || '');
      setTool('pan');
    }
  }
  async function transition(action: string, note = '', revisionId?: string) {
    if (issue)
      await act(`issues/${issue.id}`, {
        action,
        version: issue.version,
        note,
        revision_id: revisionId,
      });
  }
  async function review(action: string, extra: object = {}) {
    if (data?.project.current_revision_id)
      await act('review', {
        action,
        version: data.project.version,
        revision_id: data.project.current_revision_id,
        round_id: round?.id,
        ...extra,
      });
  }
  async function openSettings() {
    setSettings(true);
    if (data?.permission.administrator)
      try {
        setOrgMembers(await api<Member[]>('members'));
      } catch (e) {
        setError((e as Error).message);
      }
  }
  if (!data || !user)
    return (
      <div className="loading-page">
        {error || 'Opening proofing workspace…'}
        {error && <Link href="/">Back to projects</Link>}
      </div>
    );
  const pending = data.jobs.filter((j) => ['queued', 'running'].includes(j.state));
  const filtered = data.issues.filter(
    (i) =>
      (!sourceFilter || i.original_revision_id === sourceFilter) &&
      (!verificationFilter || i.verified_revision_id === verificationFilter) &&
      (!filter || i.status === filter) &&
      (!categoryFilter || i.category === categoryFilter) &&
      (!severityFilter || i.severity === severityFilter) &&
      (!assigneeFilter ||
        (assigneeFilter === 'unassigned' ? !i.assignee : i.assignee === assigneeFilter)),
  );
  function revisionSelect(value: string, onChange: (v: string) => void) {
    return (
      <select aria-label="Choose revision" value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Choose revision</option>}
        {data!.revisions.map((r) => (
          <option key={r.id} value={r.id}>
            V{r.sequence} · {r.filename} ({r.state})
          </option>
        ))}
      </select>
    );
  }
  function pane(revision: Revision | undefined, paneId: string) {
    if (!revision) return <div className="viewer-state">Choose a second revision to compare.</div>;
    if (revision.state !== 'ready')
      return (
        <div className="viewer-state">
          <Layers size={32} />
          <h2>{revision.state === 'failed' ? 'Processing failed' : 'Preparing your proof'}</h2>
          <p>{revision.error || 'The original is stored securely. Page processing is queued.'}</p>
          <a href={`/api/projects/${projectId}/files/${revision.id}?download`}>Download original</a>
        </div>
      );
    return (
      <PdfPane
        key={revision.id + paneId}
        projectId={projectId}
        revision={revision}
        page={paneId === 'left' ? leftPage : page}
        zoom={paneId === 'left' ? leftZoom : zoom}
        rotation={rotation}
        tool={paneId === 'left' ? 'pan' : tool}
        marks={marks(revision)}
        onDraw={onDraw}
        onMark={(id) => {
          if (data!.issues.some((i) => i.id === id)) jump(id);
          else setTab('changes');
        }}
        view={syncPan ? view : undefined}
        onView={setView}
        paneId={paneId}
        focus={paneId === 'right' ? focus : undefined}
      />
    );
  }
  return (
    <div className="proof-app">
      <header className="proof-header">
        <Link href="/" className="back-button" aria-label="Back to projects">
          <ArrowLeft size={20} />
        </Link>
        <div className="proof-title">
          <span className="eyebrow">
            {data.project.sku || 'PACKAGING PROOF'} / {data.project.market || 'WORKSPACE'}
          </span>
          <h1>{data.project.name}</h1>
        </div>
        <span className={`status ${data.project.status}`}>{label(data.project.status)}</span>
        <div className="header-actions">
          <Notifications />
          <button onClick={() => void openSettings()} aria-label="Project settings">
            <SlidersHorizontal size={18} />
          </button>
          {data.permission.designer && !data.project.archived && (
            <button onClick={() => setUpload(true)}>
              <Upload size={16} /> Upload revision
            </button>
          )}
          <button
            className="primary"
            onClick={() => {
              setTab('review');
              setRightOpen(true);
            }}
          >
            <Check size={17} /> Review decision
          </button>
        </div>
      </header>
      <div className="proof-toolbar">
        <button onClick={() => setLeftOpen(!leftOpen)} aria-label="Toggle revisions">
          <PanelLeftClose size={18} />
        </button>
        <div className="mode-switch">
          {(['single', 'split', 'overlay'] as const).map((m) => (
            <button
              key={m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                if (m === 'overlay') {
                  setSyncZoom(true);
                  setSyncPan(true);
                  setLeftZoom(zoom);
                }
              }}
            >
              {m === 'single' ? (
                <Square size={15} />
              ) : m === 'split' ? (
                <Columns2 size={15} />
              ) : (
                <Layers size={15} />
              )}{' '}
              {m === 'split' ? 'Side by side' : label(m)}
            </button>
          ))}
        </div>
        {mode !== 'single' && (
          <>
            {revisionSelect(leftId, (value) => {
              setLeftId(value);
              setLeftPage(1);
            })}
            <span className="muted">→</span>
          </>
        )}
        {revisionSelect(rightId, (value) => {
          setRightId(value);
          setPage(1);
          setSelected('');
          setFocus(undefined);
        })}
        <div className="toolbar-spacer" />
        {mode === 'overlay' && (
          <label className="inline-label">
            Opacity
            <input
              aria-label="Overlay opacity"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
        )}
        <button onClick={() => setRightOpen(!rightOpen)} aria-label="Toggle inspector">
          <PanelRightClose size={18} />
        </button>
      </div>
      {error && (
        <div role="alert" className="error app-error">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {remapping && (
        <div className="notice">
          Draw the matching region on this revision to confirm its anchor.{' '}
          <button
            onClick={() => {
              setRemapping('');
              setTool('pan');
            }}
          >
            Cancel placement
          </button>
        </div>
      )}
      <div className="proof-body">
        {leftOpen && (
          <aside className="revision-sidebar">
            <div className="sidebar-section-title">
              REVISIONS <span>{data.revisions.length}</span>
            </div>
            {data.revisions.map((r) => (
              <button
                className={`revision-item ${r.id === rightId ? 'selected' : ''}`}
                key={r.id}
                onClick={() => {
                  setRightId(r.id);
                  setPage(1);
                }}
              >
                <span className="revision-number">V{r.sequence}</span>
                <span>
                  <strong>
                    {r.id === data.project.current_revision_id
                      ? 'Latest revision'
                      : 'Previous revision'}
                  </strong>
                  <small>
                    {label(r.state)} · {date(r.created_at).split(',')[0]}
                  </small>
                </span>
              </button>
            ))}
            <div className="sidebar-section-title">
              PAGES <span>{right?.pages.length || 0}</span>
            </div>
            <div className="thumbnails">
              {right?.pages.map((p, i) => (
                <button
                  key={i}
                  className={page === i + 1 ? 'selected' : ''}
                  onClick={() => {
                    setPage(i + 1);
                    if (syncPages) {
                      const map = pageMap.length ? pageMap : comparison?.coverage.page_map || [];
                      const match = map.find((m) => m.after === i + 1);
                      if (match) setLeftPage(match.before);
                    }
                  }}
                >
                  <img
                    alt={`Page ${i + 1}`}
                    src={`/api/projects/${projectId}/assets?key=${encodeURIComponent(p.thumbnail)}`}
                  />
                  <span>Page {i + 1}</span>
                </button>
              ))}
            </div>
            {right && (
              <a
                className="download-link"
                href={`/api/projects/${projectId}/files/${right.id}?download`}
              >
                ↓ Download original
              </a>
            )}
            <div className="fine sidebar-note">
              Originals stay immutable.
              <br />
              Review overlays are stored separately.
            </div>
          </aside>
        )}
        <main className="proof-canvas">
          <div className={`viewer-panes ${mode}`}>
            {!right ? (
              <div className="viewer-state">
                <Upload size={36} />
                <h2>Your first proof starts here</h2>
                <p>Upload a PDF, PNG, or JPEG to begin the review.</p>
                {data.permission.designer && (
                  <button className="primary" onClick={() => setUpload(true)}>
                    Upload artwork
                  </button>
                )}
              </div>
            ) : (
              <>
                {mode !== 'single' && <div className="pane-wrap">{pane(left, 'left')}</div>}
                <div
                  className="pane-wrap"
                  style={mode === 'overlay' ? { opacity, pointerEvents: 'none' } : undefined}
                >
                  {pane(right, 'right')}
                </div>
              </>
            )}
          </div>
          <div className="viewer-footer">
            <div className="tool-group">
              {(
                [
                  { name: 'pan', icon: Hand },
                  { name: 'rectangle', icon: Square },
                  { name: 'pin', icon: MapPin },
                  { name: 'measure', icon: Ruler },
                ] as const
              ).map((t) => (
                <button
                  key={t.name}
                  title={label(t.name)}
                  aria-label={label(t.name)}
                  className={tool === t.name ? 'active' : ''}
                  disabled={
                    ['rectangle', 'pin'].includes(t.name) &&
                    (!data.permission.reviewer || !canEdit || mode === 'overlay')
                  }
                  onClick={() => setTool(t.name)}
                >
                  <t.icon size={17} />
                </button>
              ))}
            </div>
            <button onClick={() => fit()}>Fit page</button>
            <button onClick={() => fit(true)}>Fit width</button>
            <button onClick={() => changeZoom(zoom - 0.25)} aria-label="Zoom out">
              −
            </button>
            <select
              aria-label="Zoom"
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
            >
              {[...new Set([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, zoom])]
                .sort((a, b) => a - b)
                .map((z) => (
                  <option value={z} key={z}>
                    {Math.round(z * 100)}%
                  </option>
                ))}
            </select>
            <button onClick={() => changeZoom(zoom + 0.25)} aria-label="Zoom in">
              +
            </button>
            <button onClick={() => setRotation((rotation + 90) % 360)} aria-label="Rotate page">
              <RotateCw size={17} />
            </button>
            <button
              onClick={() => void document.documentElement.requestFullscreen().catch(() => {})}
              aria-label="Fullscreen"
            >
              <Maximize size={17} />
            </button>
            <span className="toolbar-spacer" />
            <label className="check-label">
              <input
                type="checkbox"
                checked={showMarks}
                onChange={(e) => setShowMarks(e.target.checked)}
              />{' '}
              Issues
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={showChanges}
                onChange={(e) => setShowChanges(e.target.checked)}
              />{' '}
              Changes
            </label>
          </div>
          {mode !== 'single' && (
            <div className="sync-bar">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={syncZoom}
                  onChange={(e) => {
                    setSyncZoom(e.target.checked);
                    if (e.target.checked) setLeftZoom(zoom);
                  }}
                />{' '}
                Sync zoom
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={syncPan}
                  onChange={(e) => setSyncPan(e.target.checked)}
                />{' '}
                Sync pan
              </label>
              {!syncZoom && (
                <label>
                  Left zoom{' '}
                  <input
                    aria-label="Left zoom"
                    type="number"
                    min="20"
                    max="800"
                    value={Math.round(leftZoom * 100)}
                    onChange={(e) =>
                      setLeftZoom(Math.max(0.2, Math.min(8, Number(e.target.value) / 100)))
                    }
                  />
                  %
                </label>
              )}
              <label>
                Left page{' '}
                <select value={leftPage} onChange={(e) => setLeftPage(Number(e.target.value))}>
                  {left?.pages.map((_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={syncPages}
                  onChange={(e) => setSyncPages(e.target.checked)}
                  disabled={!pageMap.length && !comparison?.coverage.page_map?.length}
                />{' '}
                Sync mapped pages
              </label>
            </div>
          )}
          <div className="canvas-note">
            {pending.length
              ? `${pending.length} background job${pending.length > 1 ? 's' : ''} processing`
              : 'Source detail rendering · native PDF annotation objects hidden'}
            <span>Screen preview is not a certified colour proof.</span>
          </div>
        </main>
        {rightOpen && (
          <aside className="inspector">
            <div className="inspector-tabs">
              {['issues', 'changes', 'review', 'activity'].map((t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {label(t)}
                  {t === 'issues' && (
                    <span>{data.issues.filter((i) => i.status !== 'closed').length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="inspector-content">
              {tab === 'issues' && (
                <>
                  {issue ? (
                    <>
                      <button className="text-button" onClick={() => setSelected('')}>
                        ← All issues
                      </button>
                      <div className="issue-detail">
                        <span className="eyebrow">
                          ISSUE #{issue.number} · {issue.severity}
                        </span>
                        <h2>{issue.title}</h2>
                        <span className={`status ${issue.status}`}>{label(issue.status)}</span>
                        <p>{issue.description}</p>
                        <label>
                          Assigned to
                          <select
                            aria-label="Issue assignee"
                            value={issue.assignee || ''}
                            disabled={
                              busy ||
                              !canEdit ||
                              !(data.permission.designer || data.permission.reviewer)
                            }
                            onChange={(e) =>
                              void act(`issues/${issue.id}`, {
                                action: 'assign',
                                version: issue.version,
                                assignee: e.target.value || null,
                              })
                            }
                          >
                            <option value="">Unassigned</option>
                            {data.members.map((m) => (
                              <option value={m.user_id} key={m.user_id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="fine">
                          Requested on V
                          {
                            data.revisions.find((r) => r.id === issue.original_revision_id)
                              ?.sequence
                          }
                          {issue.fix_revision_id
                            ? ` · Candidate fix V${data.revisions.find((r) => r.id === issue.fix_revision_id)?.sequence}`
                            : ''}
                        </p>
                        {issue.status === 'closed' && issue.verified_revision_id !== rightId && (
                          <div className="notice">
                            Closed on an earlier revision. Review later changes before relying on
                            that decision.
                          </div>
                        )}
                        {issue.fix_revision_id && (
                          <button
                            onClick={() => {
                              setLeftId(issue.original_revision_id);
                              setRightId(issue.fix_revision_id!);
                              setMode('split');
                              const original = data.anchors.find(
                                (a) => a.issue_id === issue.id && a.state === 'original',
                              );
                              const candidate = data.anchors.find(
                                (a) =>
                                  a.issue_id === issue.id &&
                                  a.revision_id === issue.fix_revision_id,
                              );
                              if (original) setLeftPage(original.page);
                              if (candidate) {
                                setPage(candidate.page);
                                setFocus({ ...candidate.geometry });
                              }
                            }}
                          >
                            Compare request and candidate fix
                          </button>
                        )}
                        {selectedAnchor?.state === 'proposed' && (
                          <div className="notice">
                            Suggested location ·{' '}
                            {Math.round((selectedAnchor.confidence || 0) * 100)}% alignment
                            confidence. Confirm the region or place it manually.
                            {canEdit && data.permission.reviewer && (
                              <>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(`issues/${issue.id}`, {
                                      action: 'anchor',
                                      version: issue.version,
                                      revision_id: rightId,
                                      page: selectedAnchor.page,
                                      geometry: selectedAnchor.geometry,
                                    })
                                  }
                                >
                                  Confirm suggested location
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(`issues/${issue.id}`, {
                                      action: 'reject_anchor',
                                      version: issue.version,
                                      revision_id: rightId,
                                    })
                                  }
                                >
                                  Reject suggested location
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {(!selectedAnchor || selectedAnchor.state === 'unmapped') && (
                          <div className="notice">
                            Unmapped on this revision. The original anchor is preserved.
                            <button
                              onClick={() => {
                                setRightId(issue.original_revision_id);
                                const a = data.anchors.find(
                                  (a) => a.issue_id === issue.id && a.state === 'original',
                                );
                                if (a) {
                                  setPage(a.page);
                                  setFocus({ ...a.geometry });
                                }
                              }}
                            >
                              View original request
                            </button>
                            {canEdit && data.permission.reviewer && (
                              <button
                                onClick={() => {
                                  setRemapping(issue.id);
                                  setTool('rectangle');
                                }}
                              >
                                Place anchor on this revision
                              </button>
                            )}
                          </div>
                        )}
                        <div className="stack-actions">
                          {data.permission.designer && canEdit && issue.status === 'open' && (
                            <button disabled={busy} onClick={() => void transition('start')}>
                              Start correction
                            </button>
                          )}
                          {data.permission.designer &&
                            canEdit &&
                            ['open', 'in_progress'].includes(issue.status) && (
                              <button
                                disabled={busy || right?.state !== 'ready'}
                                className="primary"
                                onClick={() => void transition('ready', '', rightId)}
                              >
                                Mark V{right?.sequence} ready for verification
                              </button>
                            )}
                          {data.permission.reviewer &&
                            canEdit &&
                            issue.status === 'ready_for_verification' && (
                              <button
                                disabled={busy || issue.fixed_by === user.id}
                                className="primary"
                                onClick={() => void transition('verify', '', rightId)}
                              >
                                Verify correction on selected revision
                              </button>
                            )}
                          {data.permission.reviewer &&
                            canEdit &&
                            ['closed', 'ready_for_verification'].includes(issue.status) && (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  void transition(
                                    'reopen',
                                    String(new FormData(e.currentTarget).get('reason')),
                                  );
                                }}
                              >
                                <label>
                                  Reopen reason
                                  <input name="reason" required />
                                </label>
                                <button disabled={busy}>Reject / reopen correction</button>
                              </form>
                            )}
                        </div>
                        <Discussion
                          key={issue.id}
                          comments={data.comments.filter((c) => c.issue_id === issue.id)}
                          members={data.members}
                          userId={user.id}
                          editable={
                            canEdit && (data.permission.designer || data.permission.reviewer)
                          }
                          busy={busy}
                          onSubmit={(body) =>
                            act(`issues/${issue.id}`, { ...body, version: issue.version })
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="inspector-heading">
                        <h2>Review issues</h2>
                        <button
                          aria-label="Draw a new issue"
                          disabled={!canEdit || !data.permission.reviewer}
                          onClick={() => setTool('rectangle')}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      <select
                        aria-label="Filter issues"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="">All statuses</option>
                        {['open', 'in_progress', 'ready_for_verification', 'closed'].map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                      <div className="issue-filters">
                        <select
                          aria-label="Filter source revision"
                          value={sourceFilter}
                          onChange={(e) => setSourceFilter(e.target.value)}
                        >
                          <option value="">All source revisions</option>
                          {data.revisions.map((r) => (
                            <option key={r.id} value={r.id}>
                              Requested on V{r.sequence}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Filter verification revision"
                          value={verificationFilter}
                          onChange={(e) => setVerificationFilter(e.target.value)}
                        >
                          <option value="">All verification revisions</option>
                          {data.revisions.map((r) => (
                            <option key={r.id} value={r.id}>
                              Verified on V{r.sequence}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Filter category"
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                        >
                          <option value="">All categories</option>
                          {['marketing', 'wording', 'qa', 'layout', 'graphics', 'other'].map(
                            (s) => (
                              <option key={s} value={s}>
                                {label(s)}
                              </option>
                            ),
                          )}
                        </select>
                        <select
                          aria-label="Filter severity"
                          value={severityFilter}
                          onChange={(e) => setSeverityFilter(e.target.value)}
                        >
                          <option value="">All severities</option>
                          <option value="blocking">Blocking</option>
                          <option value="nonblocking">Nonblocking</option>
                        </select>
                        <select
                          aria-label="Filter assignee"
                          value={assigneeFilter}
                          onChange={(e) => setAssigneeFilter(e.target.value)}
                        >
                          <option value="">All assignees</option>
                          <option value="unassigned">Unassigned</option>
                          {data.members.map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {filtered.map((i) => (
                        <button
                          className={`issue-card ${selected === i.id ? 'selected' : ''}`}
                          onClick={() => jump(i.id)}
                          key={i.id}
                        >
                          <div>
                            <span className={`severity ${i.severity}`}>
                              {i.severity === 'blocking' ? '●' : '○'} {i.severity}
                            </span>
                            <small>#{i.number}</small>
                          </div>
                          <h3>{i.title}</h3>
                          <p>{i.description || 'Select to view the request and conversation.'}</p>
                          <footer>
                            <span className={`status ${i.status}`}>{label(i.status)}</span>
                            <span>
                              {data.members.find((m) => m.user_id === i.assignee)?.name ||
                                'Unassigned'}
                            </span>
                          </footer>
                        </button>
                      ))}
                      {!filtered.length && (
                        <div className="inspector-empty">
                          <Square size={30} />
                          <h3>No issues here</h3>
                          <p>
                            Select the rectangle or pin tool to leave feedback directly on the
                            artwork.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === 'changes' && (
                <>
                  <div className="inspector-heading">
                    <h2>What changed?</h2>
                  </div>
                  <p className="muted">
                    Compare clean source renders. Flattened review marks remain unless you exclude
                    them.
                  </p>
                  <button
                    className="primary full"
                    disabled={
                      busy ||
                      !left ||
                      !right ||
                      !canEdit ||
                      !(data.permission.designer || data.permission.reviewer)
                    }
                    onClick={async () => {
                      const result = await act('comparisons', {
                        before_id: leftId,
                        after_id: rightId,
                        exclusions,
                        page_map: pageMap,
                      });
                      if (result) {
                        setCompareId(result.id || '');
                        setExclusions([]);
                        setMode('split');
                      }
                    }}
                  >
                    Analyze selected revisions
                  </button>
                  <PageMappingEditor
                    beforeCount={left?.pages.length || 0}
                    afterCount={right?.pages.length || 0}
                    value={pageMap}
                    onChange={setPageMap}
                  />
                  <button
                    className={tool === 'exclude' ? 'active' : ''}
                    onClick={() => setTool(tool === 'exclude' ? 'pan' : 'exclude')}
                    disabled={!canEdit}
                  >
                    Draw exclusion region ({exclusions.length})
                  </button>
                  {exclusions.length > 0 && (
                    <button onClick={() => setExclusions([])}>Clear draft exclusions</button>
                  )}
                  {comparison && (
                    <>
                      <span className={`status ${comparison.state}`}>
                        {label(comparison.state)}
                      </span>
                      <p className="fine">
                        {comparison.coverage.note || 'Analysis queued. You can continue reviewing.'}
                      </p>
                      {comparison.error && <p className="error">{comparison.error}</p>}
                      <p className="fine">
                        {comparison.coverage.compared ?? 0} mapped page pairs · {findings.length}{' '}
                        findings · {findings.filter((f) => f.disposition === 'unreviewed').length}{' '}
                        unreviewed
                      </p>
                    </>
                  )}
                  {findings.map((f) => (
                    <section className="finding-card" key={f.id}>
                      <button
                        className="text-button"
                        onClick={() => {
                          setPage(f.page);
                          setFocus({ ...f.geometry });
                        }}
                      >
                        {label(f.kind)} ↗
                      </button>
                      {f.evidence.before_crop && f.evidence.after_crop && (
                        <div className="crop-pair">
                          {[f.evidence.before_crop, f.evidence.after_crop].map((key, i) => (
                            <div key={key}>
                              <small>{i ? 'AFTER' : 'BEFORE'}</small>
                              <img
                                src={`/api/projects/${projectId}/assets?key=${encodeURIComponent(key)}`}
                                alt={i ? 'Changed region after' : 'Changed region before'}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      <p>{f.evidence.description}</p>
                      <span className="fine">{label(f.disposition)}</span>
                      {f.evidence.ai && (
                        <div className="notice">
                          <strong>AI suggestion · {f.evidence.ai.uncertainty} uncertainty</strong>
                          <p>{f.evidence.ai.description}</p>
                          <p className="fine">{f.evidence.ai.rationale}</p>
                          {f.evidence.ai.suggested_issue_ids.map((id) => (
                            <button key={id} onClick={() => jump(id)}>
                              Suggested issue #{data.issues.find((i) => i.id === id)?.number}
                            </button>
                          ))}
                        </div>
                      )}
                      {canEdit && data.permission.reviewer && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = Object.fromEntries(new FormData(e.currentTarget));
                            void act(`findings/${f.id}`, {
                              ...form,
                              issue_id: form.issue_id || null,
                              version: f.version,
                            });
                          }}
                        >
                          <select
                            name="disposition"
                            defaultValue={f.disposition}
                            aria-label="Finding disposition"
                          >
                            {['unreviewed', 'expected', 'needs_attention', 'comparison_noise'].map(
                              (d) => (
                                <option key={d} value={d}>
                                  {label(d)}
                                </option>
                              ),
                            )}
                          </select>
                          <input
                            name="reason"
                            aria-label="Disposition reason"
                            placeholder="Reason for this decision"
                            required
                          />
                          <select
                            name="issue_id"
                            aria-label="Linked issue"
                            defaultValue={f.issue_id || ''}
                          >
                            <option value="">No linked issue</option>
                            {data.issues.map((i) => (
                              <option value={i.id} key={i.id}>
                                #{i.number} {i.title}
                              </option>
                            ))}
                          </select>
                          {f.issue_id && (
                            <button type="button" onClick={() => jump(f.issue_id!)}>
                              Open linked issue
                            </button>
                          )}
                          <button disabled={busy}>Save disposition</button>
                          <button
                            type="button"
                            disabled={Boolean(f.issue_id)}
                            onClick={() => {
                              setPage(f.page);
                              if (comparison) setRightId(comparison.after_id);
                              setSourceFinding({ id: f.id, version: f.version });
                              setDraft(f.geometry);
                            }}
                          >
                            Create issue from region
                          </button>
                        </form>
                      )}
                    </section>
                  ))}
                  {!comparison && (
                    <div className="inspector-empty">
                      <Layers size={30} />
                      <p>Select two revisions to analyze differences.</p>
                    </div>
                  )}
                  <p className="fine">
                    AI: {comparison?.coverage.ai?.status || 'disabled'}.{' '}
                    {comparison?.coverage.ai?.error ||
                      'Deterministic evidence remains available independently.'}
                  </p>
                </>
              )}
              {tab === 'review' && (
                <>
                  <h2>Revision-bound approval</h2>
                  <p className="muted">
                    Decisions apply only to the current revision and its recorded checksum.
                  </p>
                  <div className="review-summary">
                    <span>Current revision</span>
                    <strong>
                      V
                      {data.revisions.find((r) => r.id === data.project.current_revision_id)
                        ?.sequence || '—'}
                    </strong>
                    <span>Blocking issues</span>
                    <strong>
                      {
                        data.issues.filter(
                          (i) => i.severity === 'blocking' && i.status !== 'closed',
                        ).length
                      }
                    </strong>
                  </div>
                  {data.project.status === 'approved' ? (
                    <>
                      <div className="notice success">
                        This revision is approved. Earlier approvals remain in history.
                      </div>
                      {(data.permission.reviewer || data.permission.administrator) && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void review('reopen', {
                              note: new FormData(e.currentTarget).get('reason'),
                            });
                          }}
                        >
                          <label>
                            Reason for reopening
                            <input name="reason" required />
                          </label>
                          <button disabled={busy}>Reopen review</button>
                        </form>
                      )}
                    </>
                  ) : (
                    <>
                      {(data.permission.designer || data.permission.reviewer) && (
                        <button
                          className="primary full"
                          disabled={busy || !data.project.current_revision_id || !canEdit}
                          onClick={() => void review('submit')}
                        >
                          {round
                            ? 'Start a new review round'
                            : 'Submit current revision for review'}
                        </button>
                      )}
                      {round && (
                        <>
                          <h3>Required decisions</h3>
                          {data.assignments
                            .filter((a) => a.round_id === round.id)
                            .map((a) => (
                              <div className="reviewer-row" key={a.user_id + a.scope}>
                                <div className="user-avatar">
                                  {data.members
                                    .find((m) => m.user_id === a.user_id)
                                    ?.name.slice(0, 1)}
                                </div>
                                <div>
                                  <strong>
                                    {data.members.find((m) => m.user_id === a.user_id)?.name}
                                  </strong>
                                  <small>
                                    {a.scope === 'qa' ? 'QA / legal' : 'Marketing'} ·{' '}
                                    {a.decision ? label(a.decision) : 'Awaiting decision'}
                                  </small>
                                </div>
                              </div>
                            ))}
                          {data.assignments
                            .filter((a) => a.round_id === round.id && a.user_id === user.id)
                            .map((a) => (
                              <form
                                key={a.scope}
                                className="decision-form"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = Object.fromEntries(new FormData(e.currentTarget));
                                  void review('decision', { ...f, scope: a.scope });
                                }}
                              >
                                <h3>
                                  Your {a.scope === 'qa' ? 'QA / legal' : 'marketing'} decision
                                </h3>
                                <select name="decision" aria-label={`${a.scope} decision`}>
                                  <option value="approve">Approve</option>
                                  <option value="request_changes">Request changes</option>
                                </select>
                                <textarea
                                  name="note"
                                  placeholder="Decision note (required for changes)"
                                  aria-label="Decision note"
                                />
                                <button disabled={busy}>Record decision</button>
                              </form>
                            ))}
                          {data.permission.scopes.includes('qa') && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void review('manual', {
                                  note: new FormData(e.currentTarget).get('note'),
                                });
                              }}
                            >
                              <label>
                                Manual comparison record
                                <textarea
                                  name="note"
                                  required
                                  placeholder="What was compared and why manual review was needed"
                                />
                              </label>
                              <button disabled={busy}>Record manual comparison</button>
                              {round.manual_reason && (
                                <p className="fine">Recorded: {round.manual_reason}</p>
                              )}
                            </form>
                          )}
                          {data.permission.reviewer && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void review('finalize', {
                                  acknowledge_nonblocking:
                                    new FormData(e.currentTarget).get('ack') === 'on',
                                });
                              }}
                            >
                              <label className="check-label">
                                <input type="checkbox" name="ack" /> I acknowledge remaining
                                nonblocking issues.
                              </label>
                              <button className="primary full" disabled={busy}>
                                Finalize approval
                              </button>
                            </form>
                          )}
                        </>
                      )}
                    </>
                  )}
                  <h3>Review history</h3>
                  {data.rounds.map((r) => (
                    <div className="history-row" key={r.id}>
                      <strong>
                        V{data.revisions.find((v) => v.id === r.revision_id)?.sequence}
                      </strong>
                      <span>
                        {r.state}
                        {r.state === 'approved' &&
                        r.revision_id !== data.project.current_revision_id
                          ? ' · superseded by newer artwork'
                          : ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {tab === 'activity' && (
                <>
                  <h2>Activity</h2>
                  {data.jobs
                    .filter((j) => j.state !== 'succeeded')
                    .map((j) => (
                      <div className="error" key={j.id}>
                        <p>
                          {j.kind}: {j.error || j.state}
                        </p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act(`jobs/${j.id}`, {
                              action: ['queued', 'running'].includes(j.state) ? 'cancel' : 'retry',
                            })
                          }
                        >
                          {['queued', 'running'].includes(j.state) ? 'Cancel job' : 'Retry job'}
                        </button>
                      </div>
                    ))}
                  {data.activity.map((a) => (
                    <div className="activity-row" key={a.id}>
                      <span className="mini-dot" />
                      <div>
                        <strong>{label(a.action.replaceAll('.', ' '))}</strong>
                        <p>
                          {data.members.find((m) => m.user_id === a.actor_id)?.name ||
                            'Workspace administrator'}
                        </p>
                        <small>{date(a.created_at)}</small>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      {upload && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
            <button className="modal-close" onClick={() => setUpload(false)} aria-label="Close">
              ×
            </button>
            <p className="eyebrow">THE NEXT VERSION</p>
            <h2 id="upload-title">Upload artwork</h2>
            <p className="muted">
              A new upload creates an immutable revision and starts a fresh review.
            </p>
            <form onSubmit={sendFile}>
              <label className="drop-area">
                <Upload size={28} />
                <strong>Choose your artwork file</strong>
                <span>PDF, PNG or JPEG · up to 100 MB</span>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  required
                />
              </label>
              <label>
                Revision notes
                <textarea name="notes" placeholder="What changed in this revision?" rows={3} />
              </label>
              {error && <p className="error">{error}</p>}
              <button className="primary" disabled={busy}>
                {progress || 'Upload revision'}
              </button>
            </form>
          </section>
        </div>
      )}
      {draft && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="issue-title">
            <button className="modal-close" onClick={() => setDraft(null)} aria-label="Close">
              ×
            </button>
            <p className="eyebrow">
              V{right?.sequence} · PAGE {page}
            </p>
            <h2 id="issue-title">Leave a precise request</h2>
            <form onSubmit={createIssue}>
              <label>
                Issue title
                <input name="title" autoFocus required maxLength={200} />
              </label>
              <label>
                Description
                <textarea name="description" rows={3} />
              </label>
              <div className="form-grid">
                <label>
                  Category
                  <select name="category">
                    {['marketing', 'wording', 'qa', 'layout', 'graphics', 'other'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select name="severity">
                    <option value="blocking">Blocking</option>
                    <option value="nonblocking">Nonblocking</option>
                  </select>
                </label>
                <label>
                  Assignee
                  <select name="assignee">
                    <option value="">Unassigned</option>
                    {data.members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Due date
                  <input type="date" name="due_date" />
                </label>
              </div>
              {error && <p className="error">{error}</p>}
              <button className="primary" disabled={busy}>
                Create issue
              </button>
            </form>
          </section>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop">
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <button className="modal-close" onClick={() => setSettings(false)} aria-label="Close">
              ×
            </button>
            <h2 id="settings-title">Project settings</h2>
            {(data.permission.designer || data.permission.administrator) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  void act('', {
                    ...f,
                    version: data.project.version,
                    archived: f.archived === 'on',
                  });
                }}
              >
                <div className="form-grid">
                  {(['name', 'sku', 'product', 'pack_size', 'market', 'language'] as const).map(
                    (key) => (
                      <label key={key}>
                        {label(key)}
                        <input
                          key={data.project.version + key}
                          name={key}
                          defaultValue={data.project[key]}
                          required={key === 'name'}
                        />
                      </label>
                    ),
                  )}
                </div>
                {data.permission.administrator && (
                  <label className="check-label">
                    <input name="archived" type="checkbox" defaultChecked={data.project.archived} />{' '}
                    Archive project
                  </label>
                )}
                <button disabled={busy}>Save details</button>
              </form>
            )}
            <h3>Project membership</h3>
            {data.members.map((m) => (
              <div className="history-row" key={m.user_id}>
                <strong>{m.name}</strong>
                <span>
                  {[m.designer ? 'Designer' : '', m.reviewer ? 'Reviewer' : '', ...m.scopes]
                    .filter(Boolean)
                    .join(' · ') || 'Viewer'}
                </span>
                {data.permission.administrator && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act('members', {
                        user_id: m.user_id,
                        designer: false,
                        reviewer: false,
                        scopes: [],
                        remove: true,
                        version: data.project.version,
                      })
                    }
                  >
                    Remove access
                  </button>
                )}
              </div>
            ))}
            {data.permission.administrator && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act('members', {
                    user_id: f.get('user_id'),
                    designer: f.get('designer') === 'on',
                    reviewer: f.get('reviewer') === 'on',
                    scopes: f.getAll('scopes'),
                    version: data.project.version,
                  });
                }}
              >
                <label>
                  Member
                  <select name="user_id" required>
                    {orgMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name} · {m.email}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  {['designer', 'reviewer'].map((role) => (
                    <label className="check-label" key={role}>
                      <input type="checkbox" name={role} />
                      {label(role)}
                    </label>
                  ))}
                  <label className="check-label">
                    <input type="checkbox" name="scopes" value="marketing" />
                    Marketing
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="scopes" value="qa" />
                    QA / legal
                  </label>
                </div>
                <p className="fine">
                  Changing membership supersedes any open review round. Submit again to snapshot the
                  new assignments.
                </p>
                <button className="primary" disabled={busy}>
                  Set member capabilities
                </button>
              </form>
            )}
            {error && <p className="error">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
