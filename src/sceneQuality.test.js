import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacter } from './character.js';
import { executeAnimationTool } from './animationTools.js';
import { createProject, parseProject } from './project.js';
import { analyzeSceneQuality } from './sceneQuality.js';
import { createObjectFromTemplate } from './objectTemplates.js';

test('generated character rig has connected parent-child geometry', () => {
  const project = createProject(
    [createCharacter('character-1', 500, 400, 'Character')],
    'Quality test',
  );
  const quality = analyzeSceneQuality(project);

  assert.equal(quality.valid, true, JSON.stringify(quality.warnings));
  assert.equal(quality.rigJointCount, 16);
  assert.equal(quality.warningCount, 0);
});

test('scene quality identifies disconnected parts and out-of-stage objects', () => {
  const character = createCharacter('character-1', 500, 400, 'Character');
  const head = character.parts.find((part) => part.id.endsWith('_head'));
  head.shapeOffsetX = 200;
  const project = createProject(
    [
      character,
      {
        id: 'rectangle-1',
        type: 'rectangle',
        x: 1270,
        y: 40,
        width: 30,
        height: 20,
        fill: '#ff0000',
      },
    ],
    'Quality test',
  );

  const result = executeAnimationTool(project, 'analyze_scene_quality');
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.result.valid, false);
  assert.ok(
    result.result.warnings.some(
      (warning) => warning.code === 'disconnected_character_part',
    ),
  );
  assert.ok(
    result.result.warnings.some(
      (warning) => warning.code === 'object_outside_stage',
    ),
  );
  assert.equal(
    result.project.objects[0].parts.find((part) => part.id.endsWith('_head'))
      .shapeOffsetX,
    200,
  );
});

test('scene quality includes imported artwork in stage-bound checks', () => {
  const asset = {
    id: 'asset-1',
    name: 'art.svg',
    mimeType: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"/>',
    ).toString('base64')}`,
    width: 30,
    height: 20,
  };
  const project = createProject(
    [
      {
        id: 'image-1',
        type: 'image',
        assetId: asset.id,
        x: 1270,
        y: 40,
        width: 30,
        height: 20,
      },
    ],
    'Quality test',
    10,
    [asset],
  );

  const quality = analyzeSceneQuality(project);

  assert.ok(
    quality.warnings.some(
      (warning) => warning.code === 'object_outside_stage',
    ),
  );
});

test('character joint offsets persist through project serialization', () => {
  const project = createProject(
    [createCharacter('character-1', 500, 400, 'Character')],
    'Quality test',
  );
  const restored = parseProject(JSON.stringify(project));
  const head = restored.objects[0].parts.find((part) =>
    part.id.endsWith('_head'),
  );

  assert.equal(head.shapeOffsetY, -35);
  assert.equal(analyzeSceneQuality(restored).valid, true);
});

test('scene quality evaluates animated transforms at the requested frame', () => {
  const project = createProject(
    [
      {
        id: 'rectangle-1',
        type: 'rectangle',
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        fill: '#ff0000',
      },
    ],
    'Quality test',
  );
  const startingKey = executeAnimationTool(project, 'set_keyframe', {
    objectId: 'rectangle-1',
    property: 'x',
    frame: 0,
    value: 10,
  });
  assert.equal(startingKey.ok, true, startingKey.error?.message);
  const keyed = executeAnimationTool(startingKey.project, 'set_keyframe', {
    objectId: 'rectangle-1',
    property: 'x',
    frame: 30,
    value: 1270,
  });
  assert.equal(keyed.ok, true, keyed.error?.message);

  const initial = executeAnimationTool(
    keyed.project,
    'analyze_scene_quality',
  );
  const animated = executeAnimationTool(
    keyed.project,
    'analyze_scene_quality',
    { frame: 30 },
  );

  assert.equal(initial.result.valid, true);
  assert.equal(animated.result.frame, 30);
  assert.ok(
    animated.result.warnings.some(
      (warning) => warning.code === 'object_outside_stage',
    ),
  );
});

test('scene quality reports substantial overlap and declared layer-order defects', () => {
  const project = createProject(
    [
      {
        id: 'foreground-1',
        type: 'rectangle',
        x: 200,
        y: 100,
        width: 100,
        height: 100,
        fill: '#ff0000',
        depthRole: 'foreground',
      },
      {
        id: 'background-1',
        type: 'rectangle',
        x: 210,
        y: 110,
        width: 100,
        height: 100,
        fill: '#00ff00',
        depthRole: 'background',
      },
    ],
    'Layer check',
  );
  const result = analyzeSceneQuality(project);

  assert.ok(
    result.warnings.some(
      (warning) => warning.code === 'object_overlap_candidate',
    ),
  );
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === 'depth_role_layer_order',
    ),
  );
});

test('assembly connection warnings and declared layer roles survive project round trips', () => {
  const assembly = createObjectFromTemplate('tree', 'tree-1', 400, 300);
  assembly.components.find((component) => component.id.endsWith('_canopy')).x = 500;
  assembly.depthRole = 'midground';
  const project = createProject([assembly], 'Assembly quality');
  const restored = parseProject(JSON.stringify(project));
  const result = analyzeSceneQuality(restored);

  assert.equal(restored.objects[0].depthRole, 'midground');
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === 'disconnected_assembly_component',
    ),
  );
});

test('timeline quality samples keyframes and reports fast transform jumps', () => {
  const project = createProject(
    [
      {
        id: 'moving-box',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 30,
        height: 30,
        fill: '#ff0000',
        keyframes: {
          x: [
            { frame: 0, value: 100 },
            { frame: 1, value: 300 },
          ],
        },
      },
    ],
    'Timeline check',
  );
  const result = executeAnimationTool(project, 'analyze_scene_quality', {
    timeline: true,
  });

  assert.equal(result.ok, true, result.error?.message);
  assert.ok(result.result.framesAnalyzed.includes(1));
  assert.ok(
    result.result.warnings.some(
      (warning) => warning.code === 'abrupt_transform_change',
    ),
  );
});

test('scene quality analyzer handles unrelated registered templates without prompt-specific rules', () => {
  const roomCharacter = createCharacter('room-character', 280, 300, 'Room character');
  roomCharacter.anchors = [{ id: 'hand', x: 20, y: -15 }];
  const heldObject = {
    id: 'room-prop',
    type: 'circle',
    x: 300,
    y: 285,
    radius: 12,
    fill: '#ff0000',
    attachment: { parentId: 'room-character', anchorId: 'hand' },
  };
  const car = {
    id: 'car',
    type: 'assembly',
    name: 'Editable car',
    x: 500,
    y: 470,
    components: [
      {
        id: 'car-body',
        type: 'rectangle',
        parentId: null,
        x: 0,
        y: 0,
        width: 160,
        height: 40,
        fill: '#3366cc',
      },
      {
        id: 'car-wheel-left',
        type: 'circle',
        parentId: 'car-body',
        x: -50,
        y: 25,
        radius: 22,
        fill: '#333333',
      },
      {
        id: 'car-wheel-right',
        type: 'circle',
        parentId: 'car-body',
        x: 50,
        y: 25,
        radius: 22,
        fill: '#333333',
      },
    ],
    keyframes: {
      x: [
        { frame: 0, value: 500 },
        { frame: 120, value: 700 },
      ],
    },
  };
  const scenes = [
    createProject(
      [
        createObjectFromTemplate('tree', 'park-tree', 160, 400),
        createObjectFromTemplate('cloud', 'park-cloud', 400, 120),
        createObjectFromTemplate('house', 'park-house', 800, 360),
      ],
      'Park',
    ),
    createProject(
      [
        createObjectFromTemplate('table', 'room-table', 300, 420),
        createObjectFromTemplate('chair', 'room-chair', 300, 480),
        roomCharacter,
        heldObject,
      ],
      'Interacting room',
    ),
    createProject(
      [
        {
          id: 'road',
          type: 'rectangle',
          x: 0,
          y: 510,
          width: 1280,
          height: 100,
          fill: '#555555',
        },
        car,
      ],
      'Moving vehicle',
    ),
  ];

  for (const scene of scenes) {
    assert.doesNotThrow(() => analyzeSceneQuality(scene));
    assert.ok(analyzeSceneQuality(scene).objectCount > 0);
  }
});

test('park and bicycle regression preserves an attached rider, riding pose, and editable motion after reload', () => {
  let project = createProject([], 'Park rider regression', 8);
  const run = (tool, args) => {
    const result = executeAnimationTool(project, tool, args);
    assert.equal(result.ok, true, result.error?.message);
    project = result.project;
    return result;
  };
  run('create_template', {
    id: 'bike',
    templateId: 'bicycle',
    x: 350,
    y: 480,
  });
  run('create_template', {
    id: 'park-tree',
    templateId: 'tree',
    x: 150,
    y: 430,
  });
  run('create_template', {
    id: 'park-house',
    templateId: 'house',
    x: 1000,
    y: 380,
  });
  run('add_object', {
    id: 'park-road',
    type: 'rectangle',
    x: 0,
    y: 530,
    width: 1280,
    height: 100,
    fill: '#555555',
  });
  run('add_character', {
    id: 'rider',
    x: 350,
    y: 420,
    name: 'Rider',
  });
  run('attach_object', {
    objectId: 'rider',
    parentId: 'bike',
    anchorId: 'seat',
  });
  run('apply_character_pose', {
    characterId: 'rider',
    pose: 'riding',
    startFrame: 0,
    durationFrames: 240,
  });
  run('set_keyframe', {
    objectId: 'bike',
    property: 'x',
    frame: 0,
    value: 350,
  });
  run('set_keyframe', {
    objectId: 'bike',
    property: 'x',
    frame: 240,
    value: 800,
  });
  for (const wheel of ['rear_wheel', 'front_wheel']) {
    run('set_keyframe', {
      objectId: 'bike',
      componentId: `bike_${wheel}`,
      property: 'rotation',
      frame: 0,
      value: 0,
    });
    run('set_keyframe', {
      objectId: 'bike',
      componentId: `bike_${wheel}`,
      property: 'rotation',
      frame: 240,
      value: 720,
    });
  }

  const restored = parseProject(JSON.stringify(project));
  const start = executeAnimationTool(restored, 'preview_animation', {
    startFrame: 0,
    endFrame: 240,
    stepFrames: 240,
  });
  assert.equal(start.ok, true, start.error?.message);
  const frames = start.result.samples;
  const startRider = frames[0].objects.find((object) => object.id === 'rider');
  const endRider = frames[1].objects.find((object) => object.id === 'rider');
  const endBike = frames[1].objects.find((object) => object.id === 'bike');
  const ridingLeg = endRider.parts.find((part) =>
    part.id.endsWith('_left-upper-leg'),
  );

  assert.equal(endRider.x - startRider.x, 450);
  assert.equal(ridingLeg.rotation, -58);
  assert.equal(
    endBike.components.find((component) => component.id === 'bike_rear_wheel')
      .rotation,
    720,
  );
  const quality = analyzeSceneQuality(restored, 240);
  assert.equal(quality.valid, true, JSON.stringify(quality.warnings));
});
