import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, parseProject } from './project.js';
import { createCharacter } from './character.js';
import { executeAnimationTool } from './animationTools.js';
import { getObjectTemplateRegistry } from './objectTemplates.js';

function projectWithCharacter() {
  return createProject(
    [createCharacter('character-1', 400, 300, 'Character 1')],
    'Tool test',
    10,
  );
}

function run(project, tool, args) {
  const result = executeAnimationTool(project, tool, args);
  assert.equal(result.ok, true, result.error?.message);
  return result;
}

test('tool APIs add characters and apply transforms immutably', () => {
  const original = createProject([], 'Tools');
  const added = run(original, 'add_character', {
    id: 'character-1',
    x: 500,
    y: 300,
    name: 'Actor',
  });

  const moved = run(added.project, 'set_character_transform', {
    characterId: 'character-1',
    properties: { x: 700, rotation: 15, scaleX: 1.2 },
  });

  assert.equal(original.objects.length, 0);
  assert.equal(added.result.partCount, 17);
  assert.equal(added.project.objects[0].x, 500);
  assert.equal(moved.project.objects[0].x, 700);
  assert.equal(moved.project.objects[0].rotation, 15);
  assert.equal(moved.project.objects[0].scaleX, 1.2);
});

test('image tool places an imported asset as an editable scene object', () => {
  const asset = {
    id: 'art-1',
    name: 'cloud.svg',
    mimeType: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><circle cx="50" cy="50" r="40"/></svg>',
    ).toString('base64')}`,
    width: 200,
    height: 100,
  };
  const original = createProject([], 'Asset tool test', 10, [asset]);
  const added = run(original, 'add_image_object', {
    id: 'image-1',
    assetId: asset.id,
    x: 300,
    y: 240,
  });
  const resized = run(added.project, 'set_object_property', {
    objectId: 'image-1',
    property: 'width',
    value: 320,
  });

  assert.deepEqual(added.result, {
    objectId: 'image-1',
    assetId: 'art-1',
  });
  assert.equal(added.project.objects[0].type, 'image');
  assert.equal(added.project.objects[0].width, 200);
  assert.equal(resized.project.objects[0].width, 320);
  assert.equal(original.objects.length, 0);
});

test('image tool rejects references to artwork that is not imported', () => {
  const result = executeAnimationTool(createProject([]), 'add_image_object', {
    id: 'image-1',
    assetId: 'missing',
    x: 0,
    y: 0,
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /no imported artwork asset/i);
});

test('tool APIs set supported object properties and create part keyframes', () => {
  const rectangle = {
    id: 'rect-1',
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 40,
    height: 30,
    fill: '#ff0000',
  };
  const original = createProject(
    [rectangle, createCharacter('character-1', 400, 300, 'Character 1')],
  );
  const changed = run(original, 'set_object_property', {
    objectId: 'rect-1',
    property: 'fill',
    value: '#00ff00',
  });
  const character = run(changed.project, 'set_keyframe', {
    objectId: 'character-1',
    partId: 'character-1_right-upper-arm',
    property: 'rotation',
    frame: 15,
    value: -35,
    easing: 'ease-in-out',
  });

  assert.equal(original.objects[0].fill, '#ff0000');
  assert.equal(character.project.objects[0].fill, '#00ff00');
  assert.deepEqual(
    character.project.objects[1].parts.find((part) =>
      part.id.endsWith('_right-upper-arm'),
    ).keyframes.rotation,
    [{ frame: 15, value: -35, easing: 'ease-in-out' }],
  );
});

test('action and sequence tools return scheduled generated keyframes', () => {
  const original = projectWithCharacter();
  const sequence = run(original, 'apply_character_sequence', {
    characterId: 'character-1',
    startFrame: 30,
    actions: [
      { action: 'wave', durationFrames: 60 },
      { action: 'walk', durationFrames: 60, loop: true },
      { action: 'idle', durationFrames: 30 },
    ],
  });
  const character = sequence.project.objects[0];

  assert.deepEqual(
    sequence.result.steps.map(({ action, startFrame, endFrame }) => [
      action,
      startFrame,
      endFrame,
    ]),
    [
      ['wave', 30, 90],
      ['walk', 90, 150],
      ['idle', 150, 180],
    ],
  );
  assert.ok(
    character.parts.find((part) => part.id.endsWith('_right-hand'))
      .keyframes.rotation.length > 0,
  );

  const nextAction = run(sequence.project, 'apply_character_action', {
    characterId: 'character-1',
    action: 'wave',
    startFrame: 180,
    durationFrames: 60,
  });
  assert.equal(nextAction.result.endFrame, 240);
});

test('named character poses create editable persistent joint keyframes', () => {
  const original = projectWithCharacter();
  const posed = run(original, 'apply_character_pose', {
    characterId: 'character-1',
    pose: 'riding',
    startFrame: 0,
    durationFrames: 30,
  });
  const upperLeg = posed.project.objects[0].parts.find((part) =>
    part.id.endsWith('_left-upper-leg'),
  );
  const restored = parseProject(JSON.stringify(posed.project));
  const restoredLeg = restored.objects[0].parts.find((part) =>
    part.id.endsWith('_left-upper-leg'),
  );

  assert.equal(posed.result.pose, 'riding');
  assert.equal(upperLeg.keyframes.rotation.at(-1).value, -58);
  assert.deepEqual(restoredLeg.keyframes, upperLeg.keyframes);
  assert.equal(original.objects[0].parts[11].keyframes, undefined);
});

test('sequence tools reject scene overflow and malformed actions atomically', () => {
  const original = projectWithCharacter();
  const shortProject = {
    ...original,
    durationSeconds: 2,
  };
  const before = structuredClone(shortProject);
  const overflow = executeAnimationTool(
    shortProject,
    'apply_character_sequence',
    {
      characterId: 'character-1',
      startFrame: 0,
      actions: [
        { action: 'wave', durationFrames: 60 },
        { action: 'walk', durationFrames: 60 },
      ],
    },
  );
  const malformed = executeAnimationTool(
    original,
    'apply_character_sequence',
    {
      characterId: 'character-1',
      startFrame: 0,
      actions: [{ action: 'wave', durationFrames: 30, extra: true }],
    },
  );

  assert.equal(overflow.ok, false);
  assert.match(overflow.error.message, /duration/i);
  assert.deepEqual(shortProject, before);
  assert.equal(malformed.ok, false);
  assert.match(malformed.error.message, /unsupported "extra"/i);
});

test('failed tool calls return structured errors without changing input', () => {
  const original = projectWithCharacter();
  const before = structuredClone(original);
  const invalidTransform = executeAnimationTool(
    original,
    'set_character_transform',
    {
      characterId: 'character-1',
      properties: { x: 500, opacity: 2 },
    },
  );
  const unknownProperty = executeAnimationTool(
    original,
    'set_object_property',
    { objectId: 'character-1', property: 'parts', value: [] },
  );
  const unknownCharacter = executeAnimationTool(
    original,
    'apply_character_action',
    {
      characterId: 'missing',
      action: 'wave',
      startFrame: 0,
      durationFrames: 30,
    },
  );

  assert.equal(invalidTransform.ok, false);
  assert.equal(invalidTransform.error.code, 'invalid_tool_call');
  assert.match(invalidTransform.error.message, /opacity/i);
  assert.equal(unknownProperty.ok, false);
  assert.match(unknownProperty.error.message, /not supported/i);
  assert.equal(unknownCharacter.ok, false);
  assert.match(unknownCharacter.error.message, /no scene object/i);
  assert.deepEqual(original, before);
});

test('duration changes are persisted and cannot truncate existing keyframes', () => {
  const original = createProject([], 'Tools');
  const extended = run(original, 'set_scene_duration', {
    durationSeconds: 12.5,
  });

  assert.equal(extended.project.durationSeconds, 12.5);
  assert.equal(
    parseProject(JSON.stringify(extended.project)).durationSeconds,
    12.5,
  );

  const keyed = run(projectWithCharacter(), 'apply_character_action', {
    characterId: 'character-1',
    action: 'wave',
    startFrame: 0,
    durationFrames: 60,
  }).project;
  const shortened = executeAnimationTool(keyed, 'set_scene_duration', {
    durationSeconds: 1,
  });
  const keyedBefore = structuredClone(keyed);
  assert.equal(shortened.ok, false);
  assert.deepEqual(keyed, keyedBefore);
});

test('preview returns evaluated copies and project validation normalizes input', () => {
  const project = run(projectWithCharacter(), 'apply_character_action', {
    characterId: 'character-1',
    action: 'wave',
    startFrame: 0,
    durationFrames: 60,
  }).project;
  const character = project.objects[0];
  const arm = character.parts.find((part) =>
    part.id.endsWith('_right-upper-arm'),
  );
  const preview = run(project, 'preview_animation', {
    startFrame: 0,
    endFrame: 60,
    stepFrames: 30,
  });
  const previewCharacter = preview.result.samples[1].objects[0];
  const previewArm = previewCharacter.parts.find((part) =>
    part.id.endsWith('_right-upper-arm'),
  );
  const validation = run(project, 'validate_project', {});

  assert.equal(preview.result.samples.length, 3);
  assert.equal(previewArm.rotation, -49);
  assert.notEqual(previewCharacter, character);
  assert.equal(arm.rotation, 8);
  assert.equal(validation.result.valid, true);
  assert.deepEqual(validation.project, parseProject(JSON.stringify(project)));
});

test('tool validation rejects unknown tools, invalid frames, and oversized previews', () => {
  const project = projectWithCharacter();
  const unknownTool = executeAnimationTool(project, 'delete_everything', {});
  const invalidFrame = executeAnimationTool(project, 'set_keyframe', {
    objectId: 'character-1',
    property: 'x',
    frame: 301,
    value: 0,
  });
  const oversizedPreview = executeAnimationTool(project, 'preview_animation', {
    startFrame: 0,
    endFrame: 300,
    stepFrames: 1,
  });

  assert.equal(unknownTool.error.code, 'unknown_tool');
  assert.match(invalidFrame.error.message, /duration/i);
  assert.match(oversizedPreview.error.message, /300 samples/i);
});

test('templates create editable park, room, and vehicle assemblies', () => {
  const original = createProject([], 'Scene categories');
  const categories = [
    ['tree', 'tree-1'],
    ['tree', 'tree-2'],
    ['cloud', 'cloud-1'],
    ['house', 'house-1'],
    ['bench', 'bench-1'],
    ['table', 'table-1'],
    ['chair', 'chair-1'],
    ['bicycle', 'bicycle-1'],
  ];
  const result = categories.reduce(
    (current, [templateId, id], index) => {
      const execution = run(current, 'create_template', {
        templateId,
        id,
        x: 100 + index * 100,
        y: 300,
      });
      return execution.project;
    },
    original,
  );
  const byId = new Map(result.objects.map((object) => [object.id, object]));

  assert.deepEqual(
    getObjectTemplateRegistry().map(({ id }) => id),
    ['tree', 'cloud', 'house', 'bench', 'table', 'chair', 'bicycle'],
  );
  const treeMetadata = getObjectTemplateRegistry().find(
    ({ id }) => id === 'tree',
  );
  assert.deepEqual(
    treeMetadata.components.find(({ id }) => id === 'trunk'),
    {
      id: 'trunk',
      parentId: null,
      type: 'rectangle',
      x: 0,
      y: 42,
      rotation: 0,
      width: 28,
      height: 100,
    },
  );
  assert.equal(byId.get('house-1').components.length, 6);
  assert.equal(byId.get('table-1').type, 'assembly');
  assert.equal(byId.get('bicycle-1').components.length, 19);
  assert.ok(byId.get('bicycle-1').components.some((part) => part.type === 'circle'));
  assert.equal(original.objects.length, 0);
});

test('assemblies support component edits, parent relationships, and keyframes', () => {
  let project = createProject([], 'Assembly tools');
  project = run(project, 'create_template', {
    templateId: 'tree',
    id: 'tree-1',
    x: 300,
    y: 400,
  }).project;
  const tree = project.objects[0];
  const trunkId = 'tree-1_trunk';
  const canopyId = 'tree-1_canopy';
  project = run(project, 'set_component_parent', {
    assemblyId: tree.id,
    componentId: canopyId,
    parentId: trunkId,
  }).project;
  project = run(project, 'set_component_property', {
    assemblyId: tree.id,
    componentId: trunkId,
    property: 'width',
    value: 36,
  }).project;
  project = run(project, 'set_keyframe', {
    objectId: tree.id,
    componentId: canopyId,
    property: 'rotation',
    frame: 30,
    value: 15,
  }).project;

  assert.equal(
    project.objects[0].components.find((part) => part.id === canopyId).parentId,
    trunkId,
  );
  assert.equal(
    project.objects[0].components.find((part) => part.id === trunkId).width,
    36,
  );
  assert.equal(
    project.objects[0].components.find((part) => part.id === canopyId)
      .keyframes.rotation[0].value,
    15,
  );
});

test('grouping, ungrouping, duplication, deletion, and layer order validate', () => {
  const original = createProject(
    [
      {
        id: 'rect-a',
        type: 'rectangle',
        x: 100,
        y: 120,
        width: 60,
        height: 40,
        rotation: 30,
        scaleX: 1.2,
        scaleY: 0.8,
        fill: '#ff0000',
      },
      {
        id: 'circle-a',
        type: 'circle',
        x: 220,
        y: 180,
        radius: 30,
        fill: '#00ff00',
      },
      {
        id: 'rect-b',
        type: 'rectangle',
        x: 340,
        y: 250,
        width: 60,
        height: 40,
        fill: '#0000ff',
      },
    ],
    'Group test',
  );
  const grouped = run(original, 'group_objects', {
    assemblyId: 'group-1',
    name: 'Grouped shapes',
    objectIds: ['rect-a', 'circle-a'],
    x: 150,
    y: 160,
  }).project;
  const restored = run(grouped, 'ungroup_assembly', {
    assemblyId: 'group-1',
  }).project;
  const duplicated = run(grouped, 'duplicate_object', {
    objectId: 'group-1',
    newId: 'group-copy',
  }).project;
  const reordered = run(duplicated, 'reorder_layer', {
    objectId: 'rect-b',
    index: 0,
  }).project;
  const deleted = run(reordered, 'delete_object', {
    objectId: 'group-copy',
  }).project;

  assert.equal(grouped.objects.length, 2);
  assert.equal(restored.objects.length, 3);
  assert.equal(restored.objects[0].id, 'rect-a');
  assert.equal(restored.objects[0].x, 100);
  assert.ok(Math.abs(restored.objects[0].y - 120) < 1e-9);
  assert.equal(restored.objects[0].rotation, 30);
  assert.equal(restored.objects[0].scaleX, 1.2);
  assert.equal(duplicated.objects.length, 3);
  assert.equal(duplicated.objects[2].components[0].id.startsWith('group-copy_'), true);
  assert.equal(reordered.objects[0].id, 'rect-b');
  assert.equal(deleted.objects.some((object) => object.id === 'group-copy'), false);
});

test('assembly tools reject unknown components and invalid parent cycles atomically', () => {
  const original = run(createProject([], 'Invalid assembly'), 'create_template', {
    templateId: 'house',
    id: 'house-1',
    x: 200,
    y: 300,
  }).project;
  const before = structuredClone(original);
  const missing = executeAnimationTool(original, 'set_component_property', {
    assemblyId: 'house-1',
    componentId: 'missing-part',
    property: 'fill',
    value: '#ffffff',
  });
  const initiallyParented = run(original, 'set_component_parent', {
    assemblyId: 'house-1',
    componentId: 'house-1_door',
    parentId: 'house-1_walls',
  }).project;
  const cyclic = executeAnimationTool(initiallyParented, 'set_component_parent', {
    assemblyId: 'house-1',
    componentId: 'house-1_walls',
    parentId: 'house-1_door',
  });
  const invalidTemplate = executeAnimationTool(original, 'create_template', {
    templateId: 'not-a-template',
    id: 'bad-template',
    x: 0,
    y: 0,
  });

  assert.equal(missing.ok, false);
  assert.match(missing.error.message, /no component/i);
  assert.equal(cyclic.ok, false);
  assert.match(cyclic.error.message, /cycle/i);
  assert.equal(invalidTemplate.ok, false);
  assert.match(invalidTemplate.error.message, /unknown object template/i);
  assert.deepEqual(original, before);
});

test('scene category plans can construct park, room, vehicle, and interaction compositions', async () => {
  const { executeAnimationPlan } = await import('./aiGeneration.js');
  const start = createProject([], 'Category integration tests');
  const scenarios = [
    {
      name: 'park',
      operations: [
        ['create_template', { id: 'park-tree-1', templateId: 'tree', x: 140, y: 470 }],
        ['create_template', { id: 'park-tree-2', templateId: 'tree', x: 300, y: 450 }],
        ['create_template', { id: 'park-cloud', templateId: 'cloud', x: 180, y: 120 }],
        ['create_template', { id: 'park-house', templateId: 'house', x: 680, y: 430 }],
        ['create_template', { id: 'park-bench', templateId: 'bench', x: 460, y: 490 }],
      ],
    },
    {
      name: 'room',
      operations: [
        ['create_template', { id: 'room-table', templateId: 'table', x: 600, y: 400 }],
        ['create_template', { id: 'room-chair', templateId: 'chair', x: 500, y: 470 }],
      ],
    },
    {
      name: 'vehicle',
      operations: [
        ['create_template', { id: 'vehicle-bike', templateId: 'bicycle', x: 640, y: 400 }],
      ],
    },
    {
      name: 'character interaction',
      operations: [
        ['create_template', { id: 'interaction-bike', templateId: 'bicycle', x: 710, y: 430 }],
        ['add_character', { id: 'interaction-boy', x: 540, y: 400, name: 'Boy' }],
      ],
    },
  ];

  for (const scenario of scenarios) {
    const operations = scenario.operations.map(([tool, args]) => ({
      tool,
      args,
    }));
    if (scenario.name === 'character interaction') {
      operations.push({
        tool: 'apply_character_action',
        args: {
          characterId: 'interaction-boy',
          action: 'wave',
          startFrame: 0,
          durationFrames: 30,
        },
        dependsOn: [1],
      });
    }
    const result = await executeAnimationPlan(
      start,
      {
        summary: `Test ${scenario.name} composition`,
        unsupportedCapabilities: [],
        operations,
      },
    );
    assert.ok(result.project.objects.length >= scenario.operations.length);
  }
});

test('bicycle components support persistent wheel and crank keyframes', () => {
  const created = run(createProject([], 'Bicycle'), 'create_template', {
    id: 'bike-1',
    templateId: 'bicycle',
    x: 400,
    y: 300,
  });
  const wheelStart = run(created.project, 'set_keyframe', {
    objectId: 'bike-1',
    componentId: 'bike-1_rear_wheel',
    property: 'rotation',
    frame: 0,
    value: 0,
  });
  const wheel = run(wheelStart.project, 'set_keyframe', {
    objectId: 'bike-1',
    componentId: 'bike-1_rear_wheel',
    property: 'rotation',
    frame: 30,
    value: 360,
  });
  const crankStart = run(wheel.project, 'set_keyframe', {
    objectId: 'bike-1',
    componentId: 'bike-1_pedal_crank',
    property: 'rotation',
    frame: 0,
    value: 0,
  });
  const crank = run(crankStart.project, 'set_keyframe', {
    objectId: 'bike-1',
    componentId: 'bike-1_pedal_crank',
    property: 'rotation',
    frame: 30,
    value: 360,
  });
  const preview = run(crank.project, 'preview_animation', {
    startFrame: 15,
    endFrame: 15,
    stepFrames: 1,
  });
  const displayed = preview.result.samples[0].objects[0];
  const component = (suffix) =>
    displayed.components.find((item) => item.id === `bike-1_${suffix}`);

  assert.equal(crank.project.objects[0].anchors[0].id, 'seat');
  assert.equal(component('rear_wheel').rotation, 180);
  assert.equal(component('pedal_crank').rotation, 180);
  assert.equal(component('pedal_left').parentId, 'bike-1_pedal_crank');
  assert.equal(component('pedal_right').parentId, 'bike-1_pedal_crank');
  assert.equal(
    parseProject(JSON.stringify(crank.project)).objects[0].components
      .find((item) => item.id === 'bike-1_rear_wheel')
      .keyframes.rotation[1].value,
    360,
  );
});

test('attachments follow animated parent transforms and preserve their initial pose', () => {
  const bike = run(createProject([], 'Attachment'), 'create_template', {
    id: 'bike-1',
    templateId: 'bicycle',
    x: 400,
    y: 300,
  });
  const boy = run(bike.project, 'add_character', {
    id: 'boy-1',
    x: 430,
    y: 270,
    name: 'Boy',
  });
  const attached = run(boy.project, 'attach_object', {
    objectId: 'boy-1',
    parentId: 'bike-1',
    anchorId: 'seat',
  });
  const startX = run(attached.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'x',
    frame: 0,
    value: 400,
  });
  const moved = run(startX.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'x',
    frame: 30,
    value: 700,
  });
  const startRotation = run(moved.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'rotation',
    frame: 0,
    value: 0,
  });
  const rotated = run(startRotation.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'rotation',
    frame: 30,
    value: 90,
  });
  const startScale = run(rotated.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'scaleX',
    frame: 0,
    value: 1,
  });
  const scaled = run(startScale.project, 'set_keyframe', {
    objectId: 'bike-1',
    property: 'scaleX',
    frame: 30,
    value: 2,
  });
  const preview = run(scaled.project, 'preview_animation', {
    startFrame: 0,
    endFrame: 30,
    stepFrames: 30,
  });
  const frameZeroBoy = preview.result.samples[0].objects.find(
    (object) => object.id === 'boy-1',
  );
  const movedBoy = preview.result.samples[1].objects.find(
    (object) => object.id === 'boy-1',
  );

  assert.equal(frameZeroBoy.x, 430);
  assert.equal(frameZeroBoy.y, 270);
  assert.ok(Math.abs(movedBoy.x - 730) < 0.0001);
  assert.ok(Math.abs(movedBoy.y - 360) < 0.0001);
  assert.equal(movedBoy.rotation, 90);
  assert.ok(Math.abs(movedBoy.scaleX - 2) < 0.0001);
  assert.equal(
    run(scaled.project, 'validate_relationships', {}).result.valid,
    true,
  );
});

test('attachments reject invalid anchors, cycles, unsafe deletion, and unsafe detaching', () => {
  const bike = run(createProject([], 'Relationships'), 'create_template', {
    id: 'bike-1',
    templateId: 'bicycle',
    x: 400,
    y: 300,
  });
  const boy = run(bike.project, 'add_character', {
    id: 'boy-1',
    x: 430,
    y: 270,
    name: 'Boy',
  });
  const noAnchor = executeAnimationTool(boy.project, 'attach_object', {
    objectId: 'boy-1',
    parentId: 'bike-1',
    anchorId: 'hand',
  });
  const attached = run(boy.project, 'attach_object', {
    objectId: 'boy-1',
    parentId: 'bike-1',
    anchorId: 'seat',
  });
  const deleteParent = executeAnimationTool(attached.project, 'delete_object', {
    objectId: 'bike-1',
  });
  const movingBoy = run(attached.project, 'set_keyframe', {
    objectId: 'boy-1',
    property: 'x',
    frame: 10,
    value: 5,
  });
  const detachAnimated = executeAnimationTool(
    movingBoy.project,
    'detach_object',
    { objectId: 'boy-1', frame: 10 },
  );
  const withAnchor = run(attached.project, 'define_anchor', {
    objectId: 'boy-1',
    anchorId: 'origin',
    x: 0,
    y: 0,
  });
  const cycle = executeAnimationTool(withAnchor.project, 'attach_object', {
    objectId: 'bike-1',
    parentId: 'boy-1',
    anchorId: 'origin',
  });
  const detached = run(attached.project, 'detach_object', {
    objectId: 'boy-1',
  });

  assert.equal(noAnchor.ok, false);
  assert.match(noAnchor.error.message, /no anchor/i);
  assert.equal(deleteParent.ok, false);
  assert.match(deleteParent.error.message, /detach them first/i);
  assert.equal(detachAnimated.ok, false);
  assert.match(detachAnimated.error.message, /keyframes/i);
  assert.equal(cycle.ok, false);
  assert.match(cycle.error.message, /cycles/i);
  assert.equal(detached.project.objects[1].attachment, undefined);
  assert.equal(detached.project.objects[1].x, 430);
  assert.equal(detached.project.objects[1].y, 270);
});
