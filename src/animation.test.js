import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addOrUpdateKeyframe,
  applyEasing,
  evaluateObjectAtFrame,
  evaluateProperty,
  interpolateValue,
  moveKeyframe,
  removeKeyframe,
  updateKeyframeEasing,
} from './animation.js';

test('interpolation returns exact and linearly interpolated values', () => {
  const keyframes = [
    { frame: 0, value: 100 },
    { frame: 60, value: 400 },
  ];

  assert.equal(interpolateValue(keyframes, 0), 100);
  assert.equal(interpolateValue(keyframes, 30), 250);
  assert.equal(interpolateValue(keyframes, 60), 400);
});

test('interpolation holds endpoint values outside the keyed range', () => {
  const keyframes = [
    { frame: 10, value: 20 },
    { frame: 40, value: 80 },
  ];

  assert.equal(interpolateValue(keyframes, 0), 20);
  assert.equal(interpolateValue(keyframes, 50), 80);
});

test('empty channels preserve their base value', () => {
  assert.equal(interpolateValue([], 10), undefined);
  assert.equal(evaluateProperty(42, [], 10), 42);
});

test('duplicate-frame input does not divide by zero', () => {
  assert.equal(
    interpolateValue(
      [
        { frame: 0, value: 100 },
        { frame: 0, value: 300 },
      ],
      0,
    ),
    100,
  );
});

test('easing functions transform normalized progress and preserve boundaries', () => {
  assert.equal(applyEasing(0, 'ease-in'), 0);
  assert.equal(applyEasing(1, 'ease-out'), 1);
  assert.equal(applyEasing(0.5, 'linear'), 0.5);
  assert.equal(applyEasing(0.5, 'ease-in'), 0.25);
  assert.equal(applyEasing(0.5, 'ease-out'), 0.75);
  assert.equal(applyEasing(0.5, 'ease-in-out'), 0.5);
  assert.equal(applyEasing(-1, 'linear'), 0);
  assert.equal(applyEasing(2, 'linear'), 1);
});

test('easing metadata applies to the segment after its keyframe', () => {
  const object = {
    x: 10,
    keyframes: {
      x: [
        { frame: 0, value: 0, easing: 'ease-in' },
        { frame: 60, value: 100 },
      ],
    },
  };

  assert.equal(evaluateObjectAtFrame(object, 30).x, 25);
  assert.equal(object.keyframes.x[0].easing, 'ease-in');
});

test('adding a keyframe updates the same frame instead of duplicating it', () => {
  const object = {
    id: 'rectangle-1',
    type: 'rectangle',
    x: 100,
    y: 200,
    keyframes: { x: [{ frame: 0, value: 100 }] },
  };

  const updated = addOrUpdateKeyframe(object, 'x', 0, 150);
  assert.deepEqual(updated.keyframes.x, [{ frame: 0, value: 150 }]);
  assert.equal(object.keyframes.x[0].value, 100);
});

test('keyframe removal deletes empty channels without mutating source data', () => {
  const object = {
    keyframes: {
      x: [{ frame: 0, value: 20 }],
      y: [{ frame: 0, value: 30 }],
    },
  };
  const updated = removeKeyframe(object, 'x', 0);

  assert.deepEqual(updated.keyframes, { y: [{ frame: 0, value: 30 }] });
  assert.equal(object.keyframes.x.length, 1);
});

test('moving a keyframe keeps it unique and rejects occupied frames', () => {
  const object = {
    keyframes: {
      x: [
        { frame: 0, value: 10 },
        { frame: 30, value: 20 },
      ],
    },
  };
  const moved = moveKeyframe(object, 'x', 0, 15);
  assert.deepEqual(moved.keyframes.x, [
    { frame: 15, value: 10 },
    { frame: 30, value: 20 },
  ]);
  assert.equal(moveKeyframe(moved, 'x', 15, 30), moved);
  assert.equal(object.keyframes.x[0].frame, 0);
});

test('changing easing preserves keyframe values and other channels', () => {
  const object = {
    keyframes: {
      x: [{ frame: 0, value: 10 }],
      y: [{ frame: 0, value: 20 }],
    },
  };
  const updated = updateKeyframeEasing(object, 'x', 0, 'ease-out');

  assert.deepEqual(updated.keyframes.x, [
    { frame: 0, value: 10, easing: 'ease-out' },
  ]);
  assert.deepEqual(updated.keyframes.y, [{ frame: 0, value: 20 }]);
});

test('object evaluation interpolates a display copy without mutating saved data', () => {
  const object = {
    id: 'rectangle-1',
    x: 12,
    y: 20,
    keyframes: {
      x: [
        { frame: 0, value: 100 },
        { frame: 60, value: 400 },
      ],
      rotation: [
        { frame: 0, value: 0 },
        { frame: 60, value: 180 },
      ],
      scaleX: [
        { frame: 0, value: 1 },
        { frame: 60, value: 3 },
      ],
      opacity: [
        { frame: 0, value: 1 },
        { frame: 60, value: 0 },
      ],
    },
  };

  const evaluated = evaluateObjectAtFrame(object, 30);
  assert.equal(evaluated.x, 250);
  assert.equal(evaluated.rotation, 90);
  assert.equal(evaluated.scaleX, 2);
  assert.equal(evaluated.opacity, 0.5);
  assert.equal(object.x, 12);
  assert.equal(object.keyframes.x[0].value, 100);
  assert.equal(object.keyframes.x[1].value, 400);
  assert.notEqual(evaluated, object);
});
