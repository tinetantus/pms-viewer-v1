import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeAnchor } from '../packages/viewer/mapping';
const source = { kind: 'rectangle' as const, x: 0.2, y: 0.3, width: 0.4, height: 0.1 };
test('mapping is a bounded suggestion only at adequate alignment confidence', () => {
  const transform = {
    before: 1,
    after: 2,
    confidence: 0.9,
    normalized_dx: 0.01,
    normalized_dy: -0.02,
  };
  const proposed = proposeAnchor(source, transform)!;
  assert.ok(Math.abs(proposed.x - 0.21) < 1e-10);
  assert.ok(Math.abs(proposed.y - 0.28) < 1e-10);
  assert.equal(source.x, 0.2);
  assert.equal(proposeAnchor(source, { ...transform, confidence: 0.3 }), null);
  assert.equal(proposeAnchor(source, { ...transform, normalized_dx: 0.9 }), null);
  assert.equal(proposeAnchor(source, { before: 1, after: 2, confidence: 0.99 }), null);
});
