import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatePoint, rotateGeometry, rectangle } from '../packages/viewer/geometry';
import { geometry } from '../packages/domain';

test('normalized anchors survive every rotation and return to original coordinates', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const original = { x: 0.23, y: 0.61 };
    const restored = rotatePoint(rotatePoint(original, rotation), 360 - rotation);
    assert.ok(Math.abs(restored.x - original.x) < 1e-10);
    assert.ok(Math.abs(restored.y - original.y) < 1e-10);
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.15, kind: 'rectangle' as const };
    const back = rotateGeometry(rotateGeometry(rect, rotation), 360 - rotation);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      assert.ok(Math.abs(back[key] - rect[key]) < 1e-10);
  }
});
test('reverse drag remains bounded and out-of-page anchors are rejected', () => {
  assert.deepEqual(rectangle({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.3 }), {
    x: 0.2,
    y: 0.3,
    width: 0.6000000000000001,
    height: 0.6000000000000001,
    kind: 'rectangle',
  });
  assert.equal(geometry.safeParse({ x: 0.9, y: 0, width: 0.3, height: 0.2 }).success, false);
});
