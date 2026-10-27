import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacter } from './character.js';
import {
  applyCharacterAction,
  createCharacterActionPlan,
  createCharacterActionSequencePlan,
} from './characterActions.js';
import { evaluateObjectAtFrame } from './animation.js';
import { parseProject } from './project.js';

function getPart(character, suffix) {
  return character.parts.find((part) => part.id.endsWith(`_${suffix}`));
}

test('wave creates timed joint keyframes without rotating the character root', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const plan = createCharacterActionPlan(character, 'wave', 30, 60);
  const { character: animated } = applyCharacterAction(character, plan);
  const upperArm = getPart(animated, 'right-upper-arm');
  const lowerArm = getPart(animated, 'right-lower-arm');
  const hand = getPart(animated, 'right-hand');

  assert.equal(animated.rotation, 0);
  assert.deepEqual(
    upperArm.keyframes.rotation.map(({ frame }) => frame),
    [0, 30, 40, 90],
  );
  assert.equal(
    upperArm.keyframes.rotation.find(({ frame }) => frame === 40).value,
    -87,
  );
  assert.equal(lowerArm.keyframes.rotation.length, 8);
  assert.equal(hand.keyframes.rotation.length, 8);
  assert.equal(evaluateObjectAtFrame(upperArm, 0).rotation, 8);
  assert.equal(evaluateObjectAtFrame(upperArm, 40).rotation, -87);
  assert.equal(character.parts.find((part) => part.id === upperArm.id).keyframes, undefined);
});

test('walk repeats a seamless arm and leg cycle over the requested duration', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const plan = createCharacterActionPlan(character, 'walk', 15, 75, true);
  const { character: animated } = applyCharacterAction(character, plan);
  const leftLeg = getPart(animated, 'left-upper-leg');
  const rightArm = getPart(animated, 'right-upper-arm');
  const torso = getPart(animated, 'torso');

  assert.deepEqual(
    leftLeg.keyframes.rotation.map(({ frame }) => frame),
    [0, 15, 21, 28, 33, 40, 46, 53, 58, 65, 71, 78, 83, 90],
  );
  assert.equal(
    leftLeg.keyframes.rotation.find(({ frame }) => frame === 15).value,
    0,
  );
  assert.equal(leftLeg.keyframes.rotation.at(-1).value, 0);
  assert.equal(
    rightArm.keyframes.rotation.find(({ frame }) => frame === 15).value,
    8,
  );
  assert.equal(torso.keyframes.y[0].frame, 0);
  assert.equal(torso.keyframes.y[1].frame, 15);
  assert.equal(torso.keyframes.y.at(-1).frame, 90);
  assert.equal(animated.parts.length, 17);
});

test('idle eases from the evaluated pose to neutral without a frame-zero jump', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const arm = getPart(character, 'right-upper-arm');
  arm.keyframes = {
    rotation: [
      { frame: 0, value: 0 },
      { frame: 30, value: 24 },
    ],
  };
  const plan = createCharacterActionPlan(character, 'idle', 30, 45);
  const { character: animated } = applyCharacterAction(character, plan);
  const animatedArm = getPart(animated, 'right-upper-arm');
  const torso = getPart(animated, 'torso');

  assert.equal(animated.rotation, 0);
  assert.equal(
    animatedArm.keyframes.rotation.find(({ frame }) => frame === 30).value,
    24,
  );
  assert.equal(animatedArm.keyframes.rotation.at(-1).frame, 75);
  assert.equal(evaluateObjectAtFrame(animatedArm, 30).rotation, 24);
  assert.equal(evaluateObjectAtFrame(animatedArm, 75).rotation, 8);
  assert.equal(torso.keyframes.y.at(-1).value, 0);
});

test('generated action keyframes survive project save and reload', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const plan = createCharacterActionPlan(character, 'wave', 30, 60);
  const { character: animated } = applyCharacterAction(character, plan);
  const project = parseProject(
    JSON.stringify({
      version: 1,
      name: 'Wave test',
      width: 1280,
      height: 720,
      objects: [animated],
    }),
  );

  assert.deepEqual(
    getPart(project.objects[0], 'right-hand').keyframes.rotation,
    getPart(animated, 'right-hand').keyframes.rotation,
  );
});

test('non-looping action scales its keyframes to its duration and start frame', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const plan = createCharacterActionPlan(character, 'wave', 45, 30, false);
  const upperArm = plan.filter(
    (keyframe) => keyframe.partId.endsWith('_right-upper-arm'),
  );

  assert.deepEqual(
    upperArm.map(({ frame }) => frame),
    [0, 45, 50, 75],
  );
});

test('wave starts from the already animated pose at its configured start frame', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const arm = getPart(character, 'right-upper-arm');
  arm.keyframes = {
    rotation: [
      { frame: 0, value: 8 },
      { frame: 30, value: 38 },
    ],
  };
  const plan = createCharacterActionPlan(character, 'wave', 30, 60);
  const firstArmKey = plan.find(
    (keyframe) =>
      keyframe.partId === arm.id &&
      keyframe.property === 'rotation' &&
      keyframe.frame === 30,
  );

  assert.equal(firstArmKey.value, 38);
});

test('sequences calculate adjacent start and end frames and preserve boundary poses', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const sequence = createCharacterActionSequencePlan(
    character,
    [
      { action: 'wave', durationFrames: 60 },
      { action: 'walk', durationFrames: 60, loop: true },
      { action: 'idle', durationFrames: 30 },
    ],
    30,
  );
  const upperArm = getPart(sequence.character, 'right-upper-arm');
  const hand = getPart(sequence.character, 'right-hand');

  assert.deepEqual(
    sequence.steps.map(({ startFrame, endFrame }) => [startFrame, endFrame]),
    [[30, 90], [90, 150], [150, 180]],
  );
  assert.equal(sequence.endFrame, 180);
  assert.equal(sequence.steps.length, 3);
  assert.equal(
    upperArm.keyframes.rotation.find(({ frame }) => frame === 90).value,
    8,
  );
  assert.equal(
    hand.keyframes.rotation.find(({ frame }) => frame === 90).value,
    0,
  );
  assert.equal(
    evaluateObjectAtFrame(upperArm, 90).rotation,
    8,
  );
  assert.equal(
    evaluateObjectAtFrame(upperArm, 150).rotation,
    8,
  );
  assert.equal(
    evaluateObjectAtFrame(upperArm, 180).rotation,
    8,
  );
});

test('sequence failure leaves its source character unchanged on overlap', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const upperArm = getPart(character, 'right-upper-arm');
  upperArm.keyframes = { rotation: [{ frame: 45, value: 42 }] };
  const original = structuredClone(character);

  assert.throws(
    () =>
      createCharacterActionSequencePlan(
        character,
        [
          { action: 'wave', durationFrames: 60 },
          { action: 'walk', durationFrames: 60 },
        ],
        30,
      ),
    /overlaps/i,
  );
  assert.deepEqual(character, original);
});

test('sequence validation rejects empty lists and invalid durations', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  assert.throws(
    () => createCharacterActionSequencePlan(character, [], 0),
    /between 1 and 100/i,
  );
  assert.throws(
    () =>
      createCharacterActionSequencePlan(
        character,
        [{ action: 'wave', durationFrames: 0 }],
        0,
      ),
    /duration/i,
  );
});

test('actions preserve existing keys outside the range and reject overlaps by default', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const arm = getPart(character, 'right-upper-arm');
  arm.keyframes = {
    rotation: [
      { frame: 0, value: 8 },
      { frame: 50, value: 99 },
      { frame: 100, value: 10 },
    ],
  };
  const plan = createCharacterActionPlan(character, 'wave', 30, 60);

  assert.throws(
    () => applyCharacterAction(character, plan),
    /overlaps 1 existing joint keyframe/i,
  );

  const { character: replaced, replacedKeyframes } = applyCharacterAction(
    character,
    plan,
    { replaceExisting: true },
  );
  const updatedArm = getPart(replaced, 'right-upper-arm');

  assert.equal(replacedKeyframes, 1);
  assert.deepEqual(
    updatedArm.keyframes.rotation.map(({ frame }) => frame),
    [0, 30, 40, 90, 100],
  );
  assert.equal(updatedArm.keyframes.rotation[0].value, 8);
  assert.equal(updatedArm.keyframes.rotation.at(-1).value, 10);
});

test('action plans validate character, duration, start frame, and rig parts', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');

  assert.throws(
    () => createCharacterActionPlan(null, 'wave', 0, 30),
    /select a character/i,
  );
  assert.throws(
    () => createCharacterActionPlan(character, 'wave', -1, 30),
    /start frame/i,
  );
  assert.throws(
    () => createCharacterActionPlan(character, 'wave', 0, 0),
    /duration/i,
  );
  assert.throws(
    () => createCharacterActionPlan(character, 'run', 0, 30),
    /unsupported character action/i,
  );
  character.parts = character.parts.filter(
    (part) => !part.id.endsWith('_right-hand'),
  );
  assert.throws(
    () => createCharacterActionPlan(character, 'wave', 0, 30),
    /missing required rig part/i,
  );
});
