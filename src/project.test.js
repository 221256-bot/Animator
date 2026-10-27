import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProject } from './project.js';
import { createCharacter } from './character.js';

const baseProject = {
  version: 1,
  width: 1280,
  height: 720,
  objects: [
    {
      id: 'rectangle-1',
      type: 'rectangle',
      x: 100,
      y: 200,
      width: 120,
      height: 80,
      rotation: 0,
      fill: '#ff0000',
      keyframes: {
        x: [
          { frame: 60, value: 600, easing: 'ease-out' },
          { frame: 0, value: 100 },
        ],
      },
    },
  ],
};

test('project loading preserves and orders keyframes by frame', () => {
  const project = parseProject(JSON.stringify(baseProject));

  assert.deepEqual(project.objects[0].keyframes.x, [
    { frame: 0, value: 100 },
    { frame: 60, value: 600, easing: 'ease-out' },
  ]);
});

test('project loading rejects duplicate keyframes at the same frame', () => {
  const project = structuredClone(baseProject);
  project.objects[0].keyframes.x.push({ frame: 0, value: 250 });

  assert.throws(
    () => parseProject(JSON.stringify(project)),
    /duplicate x keyframes at frame 0/i,
  );
});

test('project loading rejects unsupported easing values', () => {
  const project = structuredClone(baseProject);
  project.objects[0].keyframes.x[0].easing = 'bounce';

  assert.throws(
    () => parseProject(JSON.stringify(project)),
    /unsupported easing type/i,
  );
});

test('character creation builds a stable parent-linked body hierarchy', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  const parts = new Map(character.parts.map((part) => [part.id, part]));

  assert.equal(character.type, 'character');
  assert.equal(parts.get('character-1_torso').parentId, null);
  assert.equal(parts.get('character-1_head').parentId, 'character-1_torso');
  assert.equal(
    parts.get('character-1_left-lower-arm').parentId,
    'character-1_left-upper-arm',
  );
  assert.equal(
    parts.get('character-1_left-hand').parentId,
    'character-1_left-lower-arm',
  );
  assert.equal(parts.size, 17);
});

test('project loading preserves character hierarchy and root animation data', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  character.scaleX = 1.5;
  character.scaleY = 0.75;
  character.opacity = 0.8;
  character.keyframes = {
    x: [
      { frame: 0, value: 400 },
      { frame: 30, value: 600, easing: 'ease-in-out' },
    ],
  };
  const project = parseProject(
    JSON.stringify({ ...baseProject, objects: [character] }),
  );

  assert.deepEqual(project.objects[0].parts, character.parts);
  assert.deepEqual(project.objects[0].keyframes, character.keyframes);
  assert.equal(project.objects[0].scaleX, 1.5);
  assert.equal(project.objects[0].scaleY, 0.75);
  assert.equal(project.objects[0].opacity, 0.8);
});

test('project loading preserves optional scale and opacity on scene objects', () => {
  const object = {
    ...baseProject.objects[0],
    scaleX: 1.25,
    scaleY: 0.8,
    opacity: 0.4,
  };
  const project = parseProject(
    JSON.stringify({ ...baseProject, objects: [object] }),
  );

  assert.equal(project.objects[0].scaleX, 1.25);
  assert.equal(project.objects[0].scaleY, 0.8);
  assert.equal(project.objects[0].opacity, 0.4);
});

test('project duration defaults for old projects and persists configured values', () => {
  const legacyProject = parseProject(JSON.stringify(baseProject));
  const project = parseProject(
    JSON.stringify({ ...baseProject, durationSeconds: 12.5 }),
  );

  assert.equal(legacyProject.durationSeconds, 10);
  assert.equal(project.durationSeconds, 12.5);
});

test('legacy projects load with an empty asset library', () => {
  const project = parseProject(JSON.stringify(baseProject));

  assert.deepEqual(project.assets, []);
});

test('embedded artwork and editable image objects round-trip through project save/load', () => {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30"/></svg>',
  ).toString('base64')}`;
  const artwork = {
    id: 'asset-tree',
    name: 'tree.svg',
    mimeType: 'image/svg+xml',
    dataUrl,
    width: 20,
    height: 30,
  };
  const imageObject = {
    id: 'image-tree',
    type: 'image',
    assetId: artwork.id,
    name: artwork.name,
    x: 200,
    y: 100,
    width: 40,
    height: 60,
    rotation: 15,
    opacity: 0.7,
  };
  const restored = parseProject(
    JSON.stringify({
      ...baseProject,
      objects: [imageObject],
      assets: [artwork],
    }),
  );

  assert.deepEqual(restored.assets, [artwork]);
  assert.deepEqual(restored.objects[0], imageObject);
});

test('image objects require an existing artwork asset and unique resource IDs', () => {
  const imageObject = {
    id: 'image-tree',
    type: 'image',
    assetId: 'missing-asset',
    x: 0,
    y: 0,
    width: 20,
    height: 30,
  };

  assert.throws(
    () =>
      parseProject(
        JSON.stringify({ ...baseProject, objects: [imageObject] }),
      ),
    /unknown artwork asset/i,
  );
});

test('project loading rejects invalid animation durations', () => {
  const project = structuredClone(baseProject);
  project.durationSeconds = 601;

  assert.throws(
    () => parseProject(JSON.stringify(project)),
    /duration/i,
  );
});

test('project loading validates opacity and scale keyframe values', () => {
  const invalidOpacity = structuredClone(baseProject);
  invalidOpacity.objects[0].keyframes = {
    opacity: [{ frame: 0, value: 1.5 }],
  };
  const invalidScale = structuredClone(baseProject);
  invalidScale.objects[0].keyframes = {
    scaleX: [{ frame: 0, value: 0 }],
  };

  assert.throws(
    () => parseProject(JSON.stringify(invalidOpacity)),
    /opacity must be between 0 and 1/i,
  );
  assert.throws(
    () => parseProject(JSON.stringify(invalidScale)),
    /scale must be at least 0\.01/i,
  );
});

test('project loading rejects characters with invalid hierarchy references', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  character.parts[1].parentId = 'missing-part';

  assert.throws(
    () => parseProject(JSON.stringify({ ...baseProject, objects: [character] })),
    /unknown parent ID/i,
  );
});

test('project loading rejects character hierarchy cycles', () => {
  const character = createCharacter('character-1', 400, 300, 'Character 1');
  character.parts[0].parentId = 'character-1_head';

  assert.throws(
    () => parseProject(JSON.stringify({ ...baseProject, objects: [character] })),
    /exactly one root|parent cycles/i,
  );
});

test('project loading preserves editable assembly components and local keyframes', () => {
  const assembly = {
    id: 'house-1',
    type: 'assembly',
    name: 'House',
    x: 600,
    y: 360,
    rotation: 0,
    components: [
      {
        id: 'house-1_walls',
        type: 'rectangle',
        parentId: null,
        x: 0,
        y: 0,
        width: 120,
        height: 90,
        fill: '#ffaa00',
      },
      {
        id: 'house-1_door',
        type: 'rectangle',
        parentId: 'house-1_walls',
        x: 0,
        y: 20,
        width: 24,
        height: 50,
        fill: '#663322',
        keyframes: {
          rotation: [{ frame: 0, value: 0 }],
        },
      },
    ],
  };
  const project = parseProject(
    JSON.stringify({ ...baseProject, objects: [assembly] }),
  );
  const restored = parseProject(JSON.stringify(project));

  assert.deepEqual(restored.objects[0], project.objects[0]);
  assert.equal(restored.objects[0].components[1].parentId, 'house-1_walls');
  assert.equal(restored.objects[0].components[1].keyframes.rotation[0].value, 0);
});

test('project loading rejects invalid assembly component references and cycles', () => {
  const assembly = {
    id: 'assembly-1',
    type: 'assembly',
    name: 'Invalid',
    x: 0,
    y: 0,
    components: [
      {
        id: 'assembly-1_a',
        type: 'circle',
        parentId: 'assembly-1_b',
        x: 0,
        y: 0,
        radius: 10,
        fill: '#ffffff',
      },
      {
        id: 'assembly-1_b',
        type: 'circle',
        parentId: 'assembly-1_a',
        x: 0,
        y: 0,
        radius: 10,
        fill: '#ffffff',
      },
    ],
  };
  assert.throws(
    () => parseProject(JSON.stringify({ ...baseProject, objects: [assembly] })),
    /parent cycles/i,
  );

  assembly.components[0].parentId = 'not-in-assembly';
  assembly.components[1].parentId = null;
  assert.throws(
    () => parseProject(JSON.stringify({ ...baseProject, objects: [assembly] })),
    /unknown parent ID/i,
  );
});

test('project loading preserves anchors and attachments across save and reload', () => {
  const assembly = {
    id: 'bike-1',
    type: 'assembly',
    name: 'Bike',
    x: 400,
    y: 300,
    anchors: [{ id: 'seat', x: -42, y: -42, rotation: 0 }],
    components: [
      {
        id: 'bike-1_wheel',
        type: 'circle',
        parentId: null,
        x: -65,
        y: 22,
        radius: 38,
        fill: '#333333',
      },
    ],
  };
  const character = createCharacter('boy-1', 358, 258, 'Boy');
  character.attachment = {
    parentId: 'bike-1',
    anchorId: 'seat',
  };
  const project = parseProject(
    JSON.stringify({ ...baseProject, objects: [assembly, character] }),
  );
  const restored = parseProject(JSON.stringify(project));

  assert.deepEqual(restored.objects, project.objects);
  assert.deepEqual(restored.objects[0].anchors, assembly.anchors);
  assert.equal(restored.objects[1].attachment.parentId, 'bike-1');
});

test('project loading rejects attachment references and cycles', () => {
  const assembly = {
    id: 'assembly-1',
    type: 'assembly',
    name: 'Parent',
    x: 0,
    y: 0,
    anchors: [{ id: 'seat', x: 0, y: 0 }],
    components: [
      {
        id: 'assembly-1_part',
        type: 'circle',
        parentId: null,
        x: 0,
        y: 0,
        radius: 10,
        fill: '#ffffff',
      },
    ],
  };
  const child = {
    ...baseProject.objects[0],
    id: 'child-1',
    attachment: {
      parentId: 'assembly-1',
      anchorId: 'missing',
    },
  };
  assert.throws(
    () =>
      parseProject(
        JSON.stringify({ ...baseProject, objects: [assembly, child] }),
      ),
    /unknown anchor/i,
  );

  const anchoredChild = {
    ...child,
    attachment: {
      ...child.attachment,
      anchorId: 'seat',
    },
    anchors: [{ id: 'origin', x: 0, y: 0 }],
  };
  assembly.attachment = {
    parentId: 'child-1',
    anchorId: 'origin',
  };
  assert.throws(
    () =>
      parseProject(
        JSON.stringify({
          ...baseProject,
          objects: [assembly, anchoredChild],
        }),
      ),
    /must not contain cycles/i,
  );
});
