import { ProofWorkspace } from '@/components/proof-workspace';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProofWorkspace projectId={id} />;
}
