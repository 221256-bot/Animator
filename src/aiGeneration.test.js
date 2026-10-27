import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAnimationPlan } from './aiGeneration.js';
import { createCharacter } from './character.js';
import { createProject, parseProject } from './project.js';

function projectWithCharacter(durationSeconds = 10) {
  return createProject(
    [createCharacter('character-1', 400, 300, 'Character 1')],
    'AI test',
    durationSeconds,
  );
}

function plan(operations, unsupportedCapabilities = []) {
  return {
    summary: 'Test animation plan',
    unsupportedCapabilities,
    operations,
  };
}

test('multi-step plans execute against one working project copy', async () => {
  const original = createProject([], 'AI test');
  const result = await executeAnimationPlan(
    original,
    plan([
      {
        tool: 'add_character',
        args: { id: 'character-1', x: 400, y: 300, name: 'Actor' },
      },
      {
        tool: 'apply_character_sequence',
        dependsOn: [0],
        args: {
          characterId: 'character-1',
          startFrame: 0,
          actions: [
            { action: 'wave', durationFrames: 60 },
            { action: 'walk', durationFrames: 60, loop: true },
          ],
        },
      },
    ]),
  );

  assert.equal(original.objects.length, 0);
  assert.equal(
    result.project.objects[0].parts.some(
      (part) => part.keyframes?.rotation?.length > 0,
    ),
    true,
  );
  assert.equal(result.results.length, 2);
  assert.equal(result.project.objects[0].id, 'character-1');
});

test('acceptance scene builds park, road, attached character, and coordinated keyframes', async () => {
  const original = createProject([], '7.3 acceptance', 10);
  const result = await executeAnimationPlan(
    original,
    {
      summary:
        'Build an editable park road scene with an attached waving character and coordinated bicycle motion.',
      unsupportedCapabilities: [
        'The character is attached to the bicycle seat but remains in the rig’s standing pose.',
        'Wheel spin is keyframed with bicycle travel, not physically coupled to distance.',
      ],
      operations: [
        {
          tool: 'set_scene_duration',
          args: { durationSeconds: 8 },
        },
        {
          tool: 'add_object',
          args: {
            id: 'acceptance-grass',
            type: 'rectangle',
            x: 0,
            y: 460,
            width: 1280,
            height: 260,
            fill: '#83c977',
          },
        },
        {
          tool: 'add_object',
          args: {
            id: 'acceptance-road',
            type: 'rectangle',
            x: 0,
            y: 560,
            width: 1280,
            height: 100,
            fill: '#555b66',
          },
        },
        {
          tool: 'create_template',
          args: {
            id: 'acceptance-tree-left',
            templateId: 'tree',
            x: 130,
            y: 430,
          },
        },
        {
          tool: 'create_template',
          args: {
            id: 'acceptance-tree-right',
            templateId: 'tree',
            x: 1120,
            y: 420,
          },
        },
        {
          tool: 'create_template',
          args: {
            id: 'acceptance-bike',
            templateId: 'bicycle',
            x: 350,
            y: 500,
          },
        },
        {
          tool: 'add_character',
          args: {
            id: 'acceptance-character',
            x: 308,
            y: 458,
            name: 'Cartoon character',
          },
        },
        {
          tool: 'attach_object',
          dependsOn: [5, 6],
          args: {
            objectId: 'acceptance-character',
            parentId: 'acceptance-bike',
            anchorId: 'seat',
          },
        },
        {
          tool: 'set_keyframe',
          dependsOn: [5],
          args: {
            objectId: 'acceptance-bike',
            property: 'x',
            frame: 0,
            value: 350,
          },
        },
        {
          tool: 'set_keyframe',
          dependsOn: [5],
          args: {
            objectId: 'acceptance-bike',
            property: 'x',
            frame: 240,
            value: 930,
          },
        },
        ...['rear_wheel', 'front_wheel'].flatMap((wheel) => [
          {
            tool: 'set_keyframe',
            dependsOn: [5],
            args: {
              objectId: 'acceptance-bike',
              componentId: `acceptance-bike_${wheel}`,
              property: 'rotation',
              frame: 0,
              value: 0,
            },
          },
          {
            tool: 'set_keyframe',
            dependsOn: [5],
            args: {
              objectId: 'acceptance-bike',
              componentId: `acceptance-bike_${wheel}`,
              property: 'rotation',
              frame: 240,
              value: 720,
            },
          },
        ]),
        {
          tool: 'apply_character_action',
          dependsOn: [6, 7],
          args: {
            characterId: 'acceptance-character',
            action: 'wave',
            startFrame: 0,
            durationFrames: 240,
          },
        },
        {
          tool: 'validate_relationships',
          args: {},
        },
        {
          tool: 'validate_project',
          args: {},
        },
      ],
    },
  );
  const samples = await executeAnimationPlan(
    result.project,
    {
      summary: 'Sample final scene during coordinated movement.',
      unsupportedCapabilities: [],
      operations: [
        {
          tool: 'preview_animation',
          args: { startFrame: 0, endFrame: 240, stepFrames: 120 },
        },
      ],
    },
  );
  const startFrameBoy = samples.results[0].result.samples[0].objects.find(
    (object) => object.id === 'acceptance-character',
  );
  const middleFrameBoy = samples.results[0].result.samples[1].objects.find(
    (object) => object.id === 'acceptance-character',
  );
  const endFrameBike = samples.results[0].result.samples[2].objects.find(
    (object) => object.id === 'acceptance-bike',
  );
  const endRearWheel = endFrameBike.components.find(
    (component) => component.id === 'acceptance-bike_rear_wheel',
  );

  assert.equal(result.project.durationSeconds, 8);
  assert.equal(result.project.objects.length, 6);
  assert.equal(startFrameBoy.x, 308);
  assert.equal(middleFrameBoy.x, 598);
  assert.equal(endRearWheel.rotation, 720);
  assert.equal(result.unsupportedCapabilities.length, 2);
  assert.equal(result.project.objects[5].attachment.parentId, 'acceptance-bike');
  const restored = parseProject(JSON.stringify(result.project));
  assert.deepEqual(restored.objects, result.project.objects);
  assert.ok(
    restored.objects[5].parts.some(
      (part) => part.keyframes?.rotation?.length,
    ),
  );
});

test('plan execution adds dependency edges for resources created earlier', async () => {
  const original = createProject([], 'Dependency validation');
  const before = structuredClone(original);
  const result = await executeAnimationPlan(
    original,
    plan([
      {
        tool: 'add_character',
        args: { id: 'new-character', x: 100, y: 100, name: 'Actor' },
      },
      {
        tool: 'apply_character_action',
        args: {
          characterId: 'new-character',
          action: 'wave',
          startFrame: 0,
          durationFrames: 30,
        },
      },
    ]),
  );
  assert.deepEqual(result.plan.operations[1].dependsOn, [0]);
  assert.equal(result.project.objects[0].id, 'new-character');
  assert.deepEqual(original, before);
});

test('pose operations receive inferred character-creation dependencies', async () => {
  const original = createProject([], 'Pose dependency');
  const result = await executeAnimationPlan(
    original,
    plan([
      {
        tool: 'add_character',
        args: { id: 'pose-actor', x: 200, y: 300, name: 'Actor' },
      },
      {
        tool: 'apply_character_pose',
        args: {
          characterId: 'pose-actor',
          pose: 'sitting',
          startFrame: 0,
          durationFrames: 30,
        },
      },
    ]),
  );
  assert.deepEqual(result.plan.operations[1].dependsOn, [0]);
  assert.ok(
    result.project.objects[0].parts.some(
      (part) => part.keyframes?.rotation?.length,
    ),
  );
});

test('plans still reject references to resources that do not exist', async () => {
  const original = createProject([], 'Invalid reference');
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([
        {
          tool: 'set_object_property',
          args: { objectId: 'missing-object', property: 'fill', value: '#ff0000' },
        },
      ]),
    ),
    /No scene object exists with ID "missing-object"/i,
  );
});

test('unsupported capability disclosures are returned without being faked', async () => {
  const original = createProject([], 'AI test');
  const result = await executeAnimationPlan(
    original,
    plan(
      [
        {
          tool: 'add_character',
          args: { id: 'character-1', x: 400, y: 300, name: 'Actor' },
        },
      ],
      ['Bicycle creation and character attachment are not supported.'],
    ),
  );

  assert.equal(result.project.objects.length, 1);
  assert.match(result.unsupportedCapabilities[0], /bicycle/i);
});

test('invalid tools and arguments fail before any project can be committed', async () => {
  const original = projectWithCharacter();
  const before = structuredClone(original);
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([
        {
          tool: 'set_character_transform',
          args: {
            characterId: 'character-1',
            properties: { x: 500 },
          },
        },
        {
          tool: 'set_character_transform',
          args: {
            characterId: 'character-1',
            properties: { opacity: 4 },
          },
        },
      ]),
    ),
    /Operation 2 .* opacity/i,
  );
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([{ tool: 'run_javascript', args: { code: 'bad' } }]),
    ),
    /unsupported tool/i,
  );
  assert.deepEqual(original, before);
});

test('scene overflow rolls back the whole animation plan', async () => {
  const original = projectWithCharacter(2);
  const before = structuredClone(original);
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([
        {
          tool: 'set_character_transform',
          args: { characterId: 'character-1', properties: { x: 800 } },
        },
        {
          tool: 'apply_character_action',
          args: {
            characterId: 'character-1',
            action: 'wave',
            startFrame: 0,
            durationFrames: 61,
          },
        },
      ]),
    ),
    /Operation 2 .* duration/i,
  );
  assert.deepEqual(original, before);
});

test('failed attachment plans roll back all created scene objects', async () => {
  const original = createProject([], 'Attachment rollback');
  const before = structuredClone(original);
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([
        {
          tool: 'create_template',
          args: {
            id: 'bike-1',
            templateId: 'bicycle',
            x: 400,
            y: 300,
          },
        },
        {
          tool: 'add_character',
          args: { id: 'boy-1', x: 430, y: 270, name: 'Boy' },
        },
        {
          tool: 'attach_object',
          dependsOn: [0, 1],
          args: {
            objectId: 'boy-1',
            parentId: 'bike-1',
            anchorId: 'missing-anchor',
          },
        },
      ]),
    ),
    /Operation 3 .* no anchor/i,
  );
  assert.deepEqual(original, before);
});

test('cancelled plans stop between operations and keep input untouched', async () => {
  const original = projectWithCharacter();
  const before = structuredClone(original);
  const controller = new AbortController();
  await assert.rejects(
    executeAnimationPlan(
      original,
      plan([
        {
          tool: 'set_character_transform',
          args: { characterId: 'character-1', properties: { x: 500 } },
        },
        {
          tool: 'set_character_transform',
          args: { characterId: 'character-1', properties: { y: 500 } },
        },
      ]),
      {
        signal: controller.signal,
        yieldControl: async () => controller.abort(),
      },
    ),
    /cancelled/i,
  );
  assert.deepEqual(original, before);
});

test('malformed plan envelopes are rejected', async () => {
  await assert.rejects(
    executeAnimationPlan(
      createProject([], 'AI test'),
      {
        summary: 'Bad plan',
        unsupportedCapabilities: [],
        operations: [],
        arbitraryCode: 'no',
      },
    ),
    /unsupported fields/i,
  );
});
