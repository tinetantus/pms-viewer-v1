import type { Geometry } from '../domain';
export type Point = { x: number; y: number };
export function rotatePoint(p: Point, rotation: number): Point {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return p;
  }
}
export function rotateGeometry(g: Geometry, rotation: number): Geometry {
  const points = [
    { x: g.x, y: g.y },
    { x: g.x + g.width, y: g.y },
    { x: g.x, y: g.y + g.height },
    { x: g.x + g.width, y: g.y + g.height },
  ].map((p) => rotatePoint(p, rotation));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    ...g,
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function rectangle(a: Point, b: Point): Geometry {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
    kind: 'rectangle',
  };
}
