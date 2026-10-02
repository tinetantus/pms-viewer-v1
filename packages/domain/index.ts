import { z } from 'zod';

export const id = z.string().uuid();
export const geometry = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
    kind: z.enum(['rectangle', 'pin']).default('rectangle'),
  })
  .refine(
    (v) => v.x + v.width <= 1.000001 && v.y + v.height <= 1.000001,
    'Region must stay within page',
  );
export type Geometry = z.infer<typeof geometry>;
export const projectInput = z.object({
  name: z.string().trim().min(1).max(180),
  sku: z.string().max(100).default(''),
  product: z.string().max(180).default(''),
  pack_size: z.string().max(100).default(''),
  market: z.string().max(100).default(''),
  language: z.string().max(100).default(''),
});
export const issueInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(''),
  category: z.enum(['marketing', 'wording', 'qa', 'layout', 'graphics', 'other']),
  severity: z.enum(['blocking', 'nonblocking']),
  assignee: id.nullable().default(null),
  due_date: z.iso.date().nullable().default(null),
  finding_id: id.optional(),
  finding_version: z.number().int().optional(),
  revision_id: id,
  page: z.number().int().min(1),
  geometry,
});
export type Principal = {
  id: string;
  name: string;
  email: string;
  organization_id: string;
  role: 'administrator' | 'designer' | 'reviewer' | 'viewer';
};
export type PageInfo = {
  width: number;
  height: number;
  rotation: number;
  user_unit: number;
  text_characters: number;
  annotations: number;
  thumbnail: string;
  text?: string;
  crop?: number[];
};
export type Revision = {
  id: string;
  project_id: string;
  sequence: number;
  sha256: string;
  mime: string;
  byte_size: number;
  filename: string;
  notes: string;
  state: string;
  pages: PageInfo[];
  error: string | null;
  uploaded_by: string;
  created_at: string;
  object_key: string;
};
export type Project = {
  id: string;
  name: string;
  sku: string;
  product: string;
  pack_size: string;
  market: string;
  language: string;
  status: string;
  archived: boolean;
  version: number;
  current_revision_id: string | null;
  created_at: string;
  updated_at: string;
  open_issues?: number;
  thumbnail?: string | null;
  current_sequence?: number | null;
  reviewers?: { user_id: string; name: string }[];
};
export type Issue = {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  category: string;
  severity: string;
  assignee: string | null;
  original_revision_id: string;
  fix_revision_id: string | null;
  verified_revision_id: string | null;
  fixed_by: string | null;
  version: number;
  created_by: string;
  created_at: string;
};
export type Anchor = {
  id: string;
  issue_id: string;
  revision_id: string;
  page: number;
  geometry: Geometry;
  state: string;
  confidence?: number | null;
  source_anchor_id?: string | null;
};
export type Finding = {
  id: string;
  issue_id: string | null;
  comparison_id: string;
  page: number;
  geometry: Geometry;
  kind: string;
  evidence: {
    description: string;
    before_crop?: string;
    after_crop?: string;
    changed_pixels?: number;
    ai?: import('./ai').AiSuggestion;
  };
  disposition: string;
  reason: string | null;
  version: number;
};
export type Comparison = {
  id: string;
  before_id: string;
  after_id: string;
  state: string;
  error: string | null;
  coverage: {
    pages?: number;
    compared?: number;
    note?: string;
    page_map?: { before: number; after: number }[];
    ai?: { status: string; error?: string };
  };
  config: { exclusions?: { page: number; geometry: Geometry }[] };
};
export type Assignment = {
  round_id: string;
  user_id: string;
  scope: string;
  decision: string | null;
  note: string | null;
};
export type Round = {
  id: string;
  revision_id: string;
  sha256: string;
  state: string;
  manual_reason: string | null;
  manual_by: string | null;
};
export type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  designer: boolean;
  reviewer: boolean;
  scopes: string[];
};
export type Workspace = {
  project: Project;
  revisions: Revision[];
  issues: Issue[];
  anchors: Anchor[];
  comments: { id: string; issue_id: string; author_id: string; body: string; created_at: string }[];
  comparisons: Comparison[];
  findings: Finding[];
  rounds: Round[];
  assignments: Assignment[];
  members: Member[];
  activity: { id: string; action: string; actor_id: string; created_at: string }[];
  jobs: { id: string; state: string; progress: number; error: string | null; kind: string }[];
  permission: { designer: boolean; reviewer: boolean; administrator: boolean; scopes: string[] };
};

export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new Problem(status, message);
}
export function checkVersion(current: number, expected: number) {
  requireThat(current === expected, 409, 'This record changed. Reload and try again.');
}
