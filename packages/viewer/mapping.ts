import { geometry, type Geometry } from '../domain';
export type MappingTransform = {
  before: number;
  after: number;
  confidence: number;
  normalized_dx?: number;
  normalized_dy?: number;
};
export function proposeAnchor(source: Geometry, transform: MappingTransform): Geometry | null {
  if (
    transform.confidence < 0.7 ||
    !Number.isFinite(transform.normalized_dx) ||
    !Number.isFinite(transform.normalized_dy)
  )
    return null;
  const result = geometry.safeParse({
    ...source,
    x: source.x + transform.normalized_dx!,
    y: source.y + transform.normalized_dy!,
  });
  return result.success ? result.data : null;
}
