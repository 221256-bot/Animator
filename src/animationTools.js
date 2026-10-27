import { addOrUpdateKeyframe } from './animation.js';
import { createCharacter } from './character.js';
import {
  applyCharacterAction,
  createCharacterActionPlan,
  createCharacterActionSequencePlan,
  createCharacterPosePlan,
  CHARACTER_POSES,
} from './characterActions.js';
import {
  MAX_DURATION_SECONDS,
  parseProject,
} from './project.js';
import {
  createObjectFromTemplate,
} from './objectTemplates.js';
import {
  evaluateProjectAtFrame,
  worldPointToAttachmentOffset,
} from './sceneEvaluation.js';
import { analyzeSceneQuality } from './sceneQuality.js';
import { analyzeSceneTimelineQuality } from './sceneQuality.js';

const FRAME_RATE = 30;
const MAX_PREVIEW_SAMPLES = 300;
const CHARACTER_TRANSFORM_PROPERTIES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
];
const OBJECT_PROPERTIES = {
  rectangle: [
    ...CHARACTER_TRANSFORM_PROPERTIES,
    'width',
    'height',
    'fill',
    'depthRole',
  ],
  circle: [...CHARACTER_TRANSFORM_PROPERTIES, 'radius', 'fill', 'depthRole'],
  text: [
    ...CHARACTER_TRANSFORM_PROPERTIES,
    'width',
    'fontSize',
    'fill',
    'text',
    'align',
    'depthRole',
  ],
  character: [...CHARACTER_TRANSFORM_PROPERTIES, 'name', 'depthRole'],
  assembly: [...CHARACTER_TRANSFORM_PROPERTIES, 'name', 'depthRole'],
  image: [
    ...CHARACTER_TRANSFORM_PROPERTIES,
    'width',
    'height',
    'name',
    'depthRole',
  ],
};

const COMPONENT_PROPERTIES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
  'width',
  'height',
  'radius',
  'fill',
  'text',
  'fontSize',
  'align',
  'cornerRadius',
];
const COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'x', 'y', 'fill'],
  properties: {
    id: { type: 'string' },
    type: { enum: ['rectangle', 'circle', 'text'] },
    parentId: { type: 'string', nullable: true },
    x: { type: 'number', description: 'Component center/pivot x in parent-local coordinates.' },
    y: { type: 'number', description: 'Component center/pivot y in parent-local coordinates.' },
    rotation: { type: 'number' },
    scaleX: { type: 'number', minimum: 0.01 },
    scaleY: { type: 'number', minimum: 0.01 },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', minimum: 1 },
    height: { type: 'number', minimum: 1 },
    radius: { type: 'number', minimum: 1 },
    cornerRadius: { type: 'number', minimum: 0 },
    fill: {
      type: 'string',
      pattern: '^#[0-9a-fA-F]{6}$',
      description: 'Six-digit hex color such as #3f9b62.',
    },
    text: { type: 'string' },
    fontSize: { type: 'number', minimum: 1 },
    align: { enum: ['left', 'center', 'right'] },
  },
};
const OBJECT_TYPE_SCHEMA = { enum: ['rectangle', 'circle', 'text'] };
export const ANIMATION_TOOL_SCHEMAS = {
  add_image_object: {
    description:
      'Place an imported PNG, WebP, or SVG artwork asset as an independently editable scene object.',
    required: ['id', 'assetId', 'x', 'y'],
    properties: {
      id: { type: 'string' },
      assetId: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number', minimum: 1 },
      height: { type: 'number', minimum: 1 },
      name: { type: 'string' },
      rotation: { type: 'number' },
      scaleX: { type: 'number', minimum: 0.01 },
      scaleY: { type: 'number', minimum: 0.01 },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  add_object: {
    description: 'Create a validated editable primitive scene object.',
    required: ['id', 'type', 'x', 'y', 'fill'],
    properties: {
      id: { type: 'string' },
      type: OBJECT_TYPE_SCHEMA,
      x: {
        type: 'number',
        description:
          'Rectangle and text upper-left x coordinate; circle center x coordinate.',
      },
      y: {
        type: 'number',
        description:
          'Rectangle and text upper-left y coordinate; circle center y coordinate.',
      },
      fill: {
        type: 'string',
        pattern: '^#[0-9a-fA-F]{6}$',
        description: 'Six-digit hex color such as #3f9b62.',
      },
      width: { type: 'number', minimum: 5 },
      height: { type: 'number', minimum: 5 },
      radius: { type: 'number', minimum: 5 },
      text: { type: 'string' },
      fontSize: { type: 'number', minimum: 5 },
      align: { enum: ['left', 'center', 'right'] },
      rotation: { type: 'number' },
    },
  },
  create_assembly: {
    description: 'Create an editable assembly from local-coordinate primitive components.',
    required: ['id', 'name', 'x', 'y', 'components'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      rotation: { type: 'number' },
      scaleX: { type: 'number', minimum: 0.01 },
      scaleY: { type: 'number', minimum: 0.01 },
      components: { type: 'array', items: COMPONENT_SCHEMA },
    },
  },
  create_template: {
    description:
      'Create a complete editable assembly from a registered object template. Use this for named templates such as bicycle, tree, cloud, or bench instead of approximating them with custom parts.',
    required: ['id', 'templateId', 'x', 'y'],
    properties: {
      id: { type: 'string' },
      templateId: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      name: { type: 'string' },
    },
  },
  define_anchor: {
    description: 'Define or update a named local-space attachment anchor on a scene object.',
    required: ['objectId', 'anchorId', 'x', 'y'],
    properties: {
      objectId: { type: 'string' },
      anchorId: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      rotation: { type: 'number' },
    },
  },
  inspect_anchors: {
    description: 'List the explicitly defined attachment anchors on a scene object.',
    required: ['objectId'],
    properties: { objectId: { type: 'string' } },
  },
  attach_object: {
    description: 'Attach a scene object to a named parent anchor; offsets are local to that anchor.',
    required: ['objectId', 'parentId', 'anchorId'],
    properties: {
      objectId: { type: 'string' },
      parentId: { type: 'string' },
      anchorId: { type: 'string' },
      offsetX: { type: 'number' },
      offsetY: { type: 'number' },
      rotationOffset: { type: 'number' },
    },
  },
  detach_object: {
    description: 'Remove an object attachment while preserving its current world transform.',
    required: ['objectId'],
    properties: {
      objectId: { type: 'string' },
      frame: { type: 'integer', minimum: 0 },
    },
  },
  validate_relationships: {
    description: 'Validate all object anchors, attachments, and attachment cycles in the project.',
    required: [],
    properties: {},
  },
  set_component_property: {
    description: 'Set one supported property on an editable assembly component.',
    required: ['assemblyId', 'componentId', 'property', 'value'],
    properties: {
      assemblyId: { type: 'string' },
      componentId: { type: 'string' },
      property: { enum: COMPONENT_PROPERTIES },
      value: {},
    },
  },
  set_component_parent: {
    description: 'Set or remove an assembly component parent relationship.',
    required: ['assemblyId', 'componentId'],
    properties: {
      assemblyId: { type: 'string' },
      componentId: { type: 'string' },
      parentId: { type: 'string', nullable: true },
    },
  },
  group_objects: {
    description: 'Group unanimated primitive scene objects into an editable assembly.',
    required: ['assemblyId', 'name', 'objectIds', 'x', 'y'],
    properties: {
      assemblyId: { type: 'string' },
      name: { type: 'string' },
      objectIds: { type: 'array', items: { type: 'string' } },
      x: { type: 'number' },
      y: { type: 'number' },
    },
  },
  ungroup_assembly: {
    description: 'Ungroup a simple assembly into editable primitive scene objects.',
    required: ['assemblyId'],
    properties: { assemblyId: { type: 'string' } },
  },
  duplicate_object: {
    description: 'Duplicate a scene object or complete editable assembly.',
    required: ['objectId', 'newId'],
    properties: {
      objectId: { type: 'string' },
      newId: { type: 'string' },
    },
  },
  delete_object: {
    description: 'Delete one scene object by ID.',
    required: ['objectId'],
    properties: { objectId: { type: 'string' } },
  },
  reorder_layer: {
    description: 'Move an object to a specified scene layer index.',
    required: ['objectId', 'index'],
    properties: {
      objectId: { type: 'string' },
      index: { type: 'integer', minimum: 0 },
    },
  },
  add_character: {
    description: 'Add a validated editable character to the scene.',
    required: ['id', 'x', 'y', 'name'],
    properties: {
      id: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      name: { type: 'string' },
    },
  },
  apply_character_action: {
    description: 'Apply an action as editable character-part keyframes.',
    required: ['characterId', 'action', 'startFrame', 'durationFrames'],
    properties: {
      characterId: { type: 'string' },
      action: { enum: ['idle', 'wave', 'walk'] },
      startFrame: { type: 'integer', minimum: 0 },
      durationFrames: { type: 'integer', minimum: 1 },
      loop: { type: 'boolean' },
      replaceExisting: { type: 'boolean' },
    },
  },
  apply_character_pose: {
    description:
      'Create editable joint-local keyframes for a reusable character pose.',
    required: ['characterId', 'pose', 'startFrame', 'durationFrames'],
    properties: {
      characterId: { type: 'string' },
      pose: { enum: CHARACTER_POSES },
      startFrame: { type: 'integer', minimum: 0 },
      durationFrames: { type: 'integer', minimum: 1 },
    },
  },
  apply_character_sequence: {
    description: 'Schedule actions in order on adjacent timeline frames.',
    required: ['characterId', 'startFrame', 'actions'],
    properties: {
      characterId: { type: 'string' },
      startFrame: { type: 'integer', minimum: 0 },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'durationFrames'],
          properties: {
            action: { type: 'string', enum: ['idle', 'wave', 'walk'] },
            durationFrames: { type: 'integer', minimum: 1 },
            loop: { type: 'boolean' },
            replaceExisting: { type: 'boolean' },
          },
        },
      },
    },
  },
  set_character_transform: {
    description: 'Set supported root transform properties on a character.',
    required: ['characterId', 'properties'],
    properties: {
      characterId: { type: 'string' },
      properties: { type: 'object' },
    },
  },
  set_object_property: {
    description: 'Set one supported property on a scene object.',
    required: ['objectId', 'property', 'value'],
    properties: {
      objectId: { type: 'string' },
      property: { type: 'string' },
      value: {},
    },
  },
  set_keyframe: {
    description:
      'Create or update a scene object keyframe. For an assembly component, pass the assembly ID as objectId and the component ID as componentId; a component ID passed alone as objectId is also resolved to its owning assembly.',
    required: ['objectId', 'property', 'frame', 'value'],
    properties: {
      objectId: { type: 'string' },
      partId: { type: 'string' },
      componentId: { type: 'string' },
      property: {
        enum: ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'],
        description:
          'The object property to animate. A requested movement must have different start and end values.',
      },
      frame: { type: 'integer', minimum: 0 },
      value: { type: 'number' },
      easing: {
        enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'],
        description: 'Use ease-in-out for smooth travel when requested.',
      },
    },
  },
  set_scene_duration: {
    description: 'Set scene duration in seconds without truncating keyframes.',
    required: ['durationSeconds'],
    properties: {
      durationSeconds: { type: 'number', minimum: 1, maximum: 600 },
    },
  },
  preview_animation: {
    description: 'Evaluate display-only scene copies over a frame range.',
    required: ['startFrame', 'endFrame', 'stepFrames'],
    properties: {
      startFrame: { type: 'integer', minimum: 0 },
      endFrame: { type: 'integer', minimum: 0 },
      stepFrames: { type: 'integer', minimum: 1 },
    },
  },
  validate_project: {
    description: 'Validate and normalize the complete project model.',
    required: [],
    properties: {},
  },
  analyze_scene_quality: {
    description:
      'Analyze scene geometry at a frame or across the animated timeline, including stage bounds, overlap candidates, declared layer roles, attachments, and component connections.',
    required: [],
    properties: {
      frame: { type: 'integer', minimum: 0 },
      timeline: { type: 'boolean' },
      overlapThreshold: { type: 'number', minimum: 0, maximum: 1 },
      includeOverlapCandidates: { type: 'boolean' },
      attachmentDistanceMultiplier: { type: 'number', minimum: 0.1, maximum: 20 },
      characterConnectionTolerance: { type: 'number', minimum: 0, maximum: 20 },
      assemblyConnectionTolerance: { type: 'number', minimum: 0, maximum: 20 },
      intermediateSteps: { type: 'integer', minimum: 0, maximum: 10 },
      maxFrames: { type: 'integer', minimum: 2, maximum: 600 },
      maxTranslationChangePerFrame: { type: 'number', minimum: 1 },
      maxRotationChangePerFrame: { type: 'number', minimum: 1 },
    },
  },
};

for (const schema of Object.values(ANIMATION_TOOL_SCHEMAS)) {
  schema.type = 'object';
  schema.additionalProperties = false;
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function validateSchemaValue(value, schema, label) {
  if (schema.type === 'object') {
    requireRecord(value, label);
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        throw new Error(`${label} is missing required "${required}".`);
      }
    }
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = schema.properties?.[key];
      if (!propertySchema) {
        if (schema.additionalProperties === false) {
          throw new Error(`${label} contains unsupported "${key}".`);
        }
        continue;
      }
      validateSchemaValue(propertyValue, propertySchema, `${label} ${key}`);
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    value.forEach((item, index) =>
      validateSchemaValue(item, schema.items, `${label} item ${index + 1}`),
    );
    return;
  }
  if (schema.nullable && value === null) return;
  if (
    schema.type === 'string' &&
    typeof value !== 'string'
  ) {
    throw new Error(`${label} must be a string.`);
  }
  if (
    schema.pattern &&
    (typeof value !== 'string' || !new RegExp(schema.pattern).test(value))
  ) {
    throw new Error(`${label} must match ${schema.description ?? schema.pattern}.`);
  }
  if (
    schema.type === 'number' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (
    schema.type === 'integer' &&
    (!Number.isInteger(value) || !Number.isFinite(value))
  ) {
    throw new Error(`${label} must be an integer.`);
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${label} must be one of: ${schema.enum.join(', ')}.`);
  }
  if (
    typeof value === 'number' &&
    schema.minimum !== undefined &&
    value < schema.minimum
  ) {
    throw new Error(`${label} must be greater than or equal to ${schema.minimum}.`);
  }
  if (
    typeof value === 'number' &&
    schema.maximum !== undefined &&
    value > schema.maximum
  ) {
    throw new Error(`${label} must be less than or equal to ${schema.maximum}.`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function normalizeProject(project) {
  return parseProject(JSON.stringify(project));
}

function requireSceneFrame(project, frame, label) {
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  if (frame > Math.round(project.durationSeconds * FRAME_RATE)) {
    throw new Error(`${label} exceeds the scene duration.`);
  }
}

function rotatePoint(x, y, rotation) {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function findObject(project, id, expectedType) {
  requireString(id, expectedType === 'character' ? 'Character ID' : 'Object ID');
  const object = project.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`No scene object exists with ID "${id}".`);
  if (expectedType && object.type !== expectedType) {
    throw new Error(`Object "${id}" must be a ${expectedType}.`);
  }
  return object;
}

function findAsset(project, id) {
  requireString(id, 'Artwork asset ID');
  const asset = project.assets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`No imported artwork asset exists with ID "${id}".`);
  return asset;
}

function validateChangedProject(project) {
  return normalizeProject(project);
}

function assertNoKeyframesBeyond(project, durationSeconds) {
  const lastFrame = Math.round(durationSeconds * FRAME_RATE);
  for (const object of project.objects) {
    const targets = [
      object,
      ...(object.type === 'character'
        ? object.parts
        : object.type === 'assembly'
          ? object.components
          : []),
    ];
    for (const target of targets) {
      for (const keyframes of Object.values(target.keyframes ?? {})) {
        if (keyframes.some((keyframe) => keyframe.frame > lastFrame)) {
          throw new Error(
            `Duration cannot be shortened below the keyframes on "${target.id}".`,
          );
        }
      }
    }
  }
}

function runTool(project, toolName, args) {
  if (toolName === 'validate_project') {
    return { project, result: { valid: true, objectCount: project.objects.length } };
  }

  if (toolName === 'analyze_scene_quality') {
    const qualityOptions = {
      overlapThreshold: args.overlapThreshold ?? 0.65,
      includeOverlapCandidates: args.includeOverlapCandidates ?? true,
      attachmentDistanceMultiplier:
        args.attachmentDistanceMultiplier ?? 4,
      characterConnectionTolerance:
        args.characterConnectionTolerance ?? 1,
      assemblyConnectionTolerance:
        args.assemblyConnectionTolerance ?? 5,
    };
    if (args.timeline) {
      return {
        project,
        result: analyzeSceneTimelineQuality(project, {
          ...qualityOptions,
          intermediateSteps: args.intermediateSteps ?? 2,
          maxFrames: args.maxFrames ?? 600,
          maxTranslationChangePerFrame:
            args.maxTranslationChangePerFrame ?? 60,
          maxRotationChangePerFrame:
            args.maxRotationChangePerFrame ?? 90,
        }),
      };
    }
    const frame = args.frame ?? 0;
    requireSceneFrame(project, frame, 'Quality analysis frame');
    return {
      project,
      result: analyzeSceneQuality(project, frame, qualityOptions),
    };
  }

  if (toolName === 'add_image_object') {
    const asset = findAsset(project, args.assetId);
    const naturalScale = Math.min(
      1,
      480 / Math.max(asset.width, asset.height),
    );
    const imageObject = {
      id: args.id,
      type: 'image',
      assetId: asset.id,
      name: args.name ?? asset.name,
      x: args.x,
      y: args.y,
      width: args.width ?? Math.max(1, Math.round(asset.width * naturalScale)),
      height: args.height ?? Math.max(1, Math.round(asset.height * naturalScale)),
      rotation: args.rotation ?? 0,
      ...(args.scaleX === undefined ? {} : { scaleX: args.scaleX }),
      ...(args.scaleY === undefined ? {} : { scaleY: args.scaleY }),
      ...(args.opacity === undefined ? {} : { opacity: args.opacity }),
    };
    const updatedProject = validateChangedProject({
      ...project,
      objects: [...project.objects, imageObject],
    });
    return {
      project: updatedProject,
      result: { objectId: imageObject.id, assetId: asset.id },
    };
  }

  if (toolName === 'add_object') {
    const object = {
      id: args.id,
      type: args.type,
      x: args.x,
      y: args.y,
      rotation: args.rotation ?? 0,
      fill: args.fill,
      ...(args.type === 'rectangle'
        ? { width: args.width ?? 180, height: args.height ?? 100 }
        : args.type === 'circle'
          ? { radius: args.radius ?? 48 }
          : {
              text: args.text ?? 'Text',
              width: args.width ?? 220,
              fontSize: args.fontSize ?? 36,
              align: args.align ?? 'left',
            }),
    };
    const updatedProject = validateChangedProject({
      ...project,
      objects: [...project.objects, object],
    });
    return {
      project: updatedProject,
      result: { objectId: object.id, type: object.type },
    };
  }

  if (toolName === 'create_assembly') {
    const assembly = validateChangedProject({
      ...project,
      objects: [
        ...project.objects,
        {
          id: args.id,
          type: 'assembly',
          name: args.name,
          x: args.x,
          y: args.y,
          rotation: args.rotation ?? 0,
          scaleX: args.scaleX ?? 1,
          scaleY: args.scaleY ?? 1,
          opacity: 1,
          components: args.components,
        },
      ],
    });
    return {
      project: assembly,
      result: {
        assemblyId: args.id,
        componentCount: assembly.objects.at(-1).components.length,
      },
    };
  }

  if (toolName === 'create_template') {
    const template = createObjectFromTemplate(
      args.templateId,
      args.id,
      args.x,
      args.y,
      args.name,
    );
    const updatedProject = validateChangedProject({
      ...project,
      objects: [...project.objects, template],
    });
    return {
      project: updatedProject,
      result: {
        assemblyId: template.id,
        templateId: args.templateId,
        componentCount: template.components.length,
      },
    };
  }

  if (toolName === 'define_anchor') {
    requireRecord(args, 'Tool arguments');
    const object = findObject(project, args.objectId);
    const anchorId = requireString(args.anchorId, 'Anchor ID');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(anchorId)) {
      throw new Error(
        'Anchor ID must contain only letters, digits, underscores, or hyphens.',
      );
    }
    const anchor = {
      id: anchorId,
      x: requireFiniteNumber(args.x, 'Anchor x position'),
      y: requireFiniteNumber(args.y, 'Anchor y position'),
      rotation:
        args.rotation === undefined
          ? 0
          : requireFiniteNumber(args.rotation, 'Anchor rotation'),
    };
    const anchors = [
      ...(object.anchors ?? []).filter((item) => item.id !== anchorId),
      anchor,
    ];
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((candidate) =>
        candidate.id === object.id ? { ...candidate, anchors } : candidate,
      ),
    });
    return {
      project: updatedProject,
      result: { objectId: object.id, anchor },
    };
  }

  if (toolName === 'inspect_anchors') {
    const object = findObject(project, args.objectId);
    return {
      project,
      result: { objectId: object.id, anchors: object.anchors ?? [] },
    };
  }

  if (toolName === 'attach_object') {
    requireRecord(args, 'Tool arguments');
    const child = findObject(project, args.objectId);
    const parent = findObject(project, args.parentId);
    if (child.id === parent.id) {
      throw new Error('An object cannot be attached to itself.');
    }
    if (child.attachment) {
      throw new Error(`Object "${child.id}" is already attached.`);
    }
    const animatedRootTransforms = ['x', 'y', 'rotation', 'scaleX', 'scaleY'].filter(
      (property) => child.keyframes?.[property]?.length,
    );
    if (animatedRootTransforms.length) {
      throw new Error(
        `Cannot attach "${child.id}" while it has root transform keyframes (${animatedRootTransforms.join(', ')}); remove or bake those keys first.`,
      );
    }
    const anchor = parent.anchors?.find((item) => item.id === args.anchorId);
    if (!anchor) {
      throw new Error(
        `Object "${parent.id}" has no anchor "${args.anchorId}". Define the anchor before attaching objects.`,
      );
    }
    const hasOffsetX = args.offsetX !== undefined;
    const hasOffsetY = args.offsetY !== undefined;
    if (hasOffsetX !== hasOffsetY) {
      throw new Error('offsetX and offsetY must be provided together.');
    }
    const evaluated = evaluateProjectAtFrame(project, 0);
    const childWorld = evaluated.find((item) => item.id === child.id);
    const parentWorld = evaluated.find((item) => item.id === parent.id);
    const localPosition = worldPointToAttachmentOffset(
      parentWorld,
      anchor,
      childWorld,
    );
    const offsetX = hasOffsetX
      ? requireFiniteNumber(args.offsetX, 'Attachment horizontal offset')
      : localPosition.x;
    const offsetY = hasOffsetY
      ? requireFiniteNumber(args.offsetY, 'Attachment vertical offset')
      : localPosition.y;
    const rotationOffset =
      args.rotationOffset === undefined
        ? childWorld.rotation - parentWorld.rotation - anchor.rotation
        : requireFiniteNumber(args.rotationOffset, 'Attachment rotation offset');
    const scaleX = (childWorld.scaleX ?? 1) / (parentWorld.scaleX ?? 1);
    const scaleY = (childWorld.scaleY ?? 1) / (parentWorld.scaleY ?? 1);
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === child.id
          ? {
              ...object,
              x: offsetX,
              y: offsetY,
              rotation: rotationOffset,
              scaleX,
              scaleY,
              attachment: {
                parentId: parent.id,
                anchorId: anchor.id,
              },
            }
          : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        objectId: child.id,
        parentId: parent.id,
        anchorId: anchor.id,
        offsetX,
        offsetY,
        rotationOffset,
      },
    };
  }

  if (toolName === 'detach_object') {
    requireRecord(args, 'Tool arguments');
    const object = findObject(project, args.objectId);
    if (!object.attachment) {
      throw new Error(`Object "${object.id}" is not attached.`);
    }
    const frame = args.frame ?? 0;
    requireSceneFrame(project, frame, 'Detach frame');
    const animatedProperties = ['x', 'y', 'rotation', 'scaleX', 'scaleY'].filter(
      (property) => object.keyframes?.[property]?.length,
    );
    if (animatedProperties.length) {
      throw new Error(
        `Cannot detach "${object.id}" while it has root transform keyframes (${animatedProperties.join(', ')}); remove or bake those keyframes first.`,
      );
    }
    const worldObject = evaluateProjectAtFrame(project, frame).find(
      (candidate) => candidate.id === object.id,
    );
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((candidate) => {
        if (candidate.id !== object.id) return candidate;
        const { attachment, ...detached } = candidate;
        return {
          ...detached,
          x: worldObject.x,
          y: worldObject.y,
          rotation: worldObject.rotation,
          scaleX: worldObject.scaleX,
          scaleY: worldObject.scaleY,
        };
      }),
    });
    return {
      project: updatedProject,
      result: { objectId: object.id, detachedAtFrame: frame },
    };
  }

  if (toolName === 'validate_relationships') {
    const normalized = validateChangedProject(project);
    return {
      project: normalized,
      result: {
        valid: true,
        attachmentCount: normalized.objects.filter((object) => object.attachment).length,
        anchorCount: normalized.objects.reduce(
          (count, object) => count + (object.anchors?.length ?? 0),
          0,
        ),
      },
    };
  }

  if (toolName === 'set_component_property') {
    const assembly = findObject(project, args.assemblyId, 'assembly');
    requireString(args.componentId, 'Component ID');
    const component = assembly.components.find(
      (item) => item.id === args.componentId,
    );
    if (!component) {
      throw new Error(`Assembly has no component "${args.componentId}".`);
    }
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === assembly.id
          ? {
              ...object,
              components: object.components.map((item) =>
                item.id === component.id
                  ? { ...item, [args.property]: args.value }
                  : item,
              ),
            }
          : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        assemblyId: assembly.id,
        componentId: component.id,
        property: args.property,
        value: args.value,
      },
    };
  }

  if (toolName === 'set_component_parent') {
    const assembly = findObject(project, args.assemblyId, 'assembly');
    const component = assembly.components.find(
      (item) => item.id === args.componentId,
    );
    if (!component) {
      throw new Error(`Assembly has no component "${args.componentId}".`);
    }
    if (args.parentId === args.componentId) {
      throw new Error('A component cannot parent itself.');
    }
    if (
      args.parentId !== undefined &&
      !assembly.components.some((item) => item.id === args.parentId)
    ) {
      throw new Error(`Assembly has no parent component "${args.parentId}".`);
    }
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === assembly.id
          ? {
              ...object,
              components: object.components.map((item) =>
                item.id === component.id
                  ? { ...item, parentId: args.parentId ?? null }
                  : item,
              ),
            }
          : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        assemblyId: assembly.id,
        componentId: component.id,
        parentId: args.parentId ?? null,
      },
    };
  }

  if (toolName === 'group_objects') {
    const objectIds = args.objectIds;
    if (!Array.isArray(objectIds) || objectIds.length < 2) {
      throw new Error('Grouping requires at least two scene object IDs.');
    }
    if (new Set(objectIds).size !== objectIds.length) {
      throw new Error('Grouping object IDs must be unique.');
    }
    const selected = objectIds.map((id) => findObject(project, id));
    if (selected.some((object) => !['rectangle', 'circle', 'text'].includes(object.type))) {
      throw new Error('Only primitive objects can be grouped into an assembly.');
    }
    if (selected.some((object) => object.keyframes)) {
      throw new Error('Animated objects must be unanimated before grouping.');
    }
    const components = selected.map((object) => {
      const rotation = object.rotation ?? 0;
      const scaleX = object.scaleX ?? 1;
      const scaleY = object.scaleY ?? 1;
      const common = {
        id: object.id,
        parentId: null,
        type: object.type,
        rotation,
        scaleX,
        scaleY,
        opacity: object.opacity ?? 1,
        fill: object.fill,
      };
      if (object.type === 'rectangle') {
        const center = rotatePoint(
          (object.width * scaleX) / 2,
          (object.height * scaleY) / 2,
          rotation,
        );
        return {
          ...common,
          x: object.x + center.x - args.x,
          y: object.y + center.y - args.y,
          width: object.width,
          height: object.height,
        };
      }
      if (object.type === 'circle') {
        return {
          ...common,
          x: object.x - args.x,
          y: object.y - args.y,
          radius: object.radius,
        };
      }
      const center = rotatePoint(
        (object.width * scaleX) / 2,
        (object.fontSize * scaleY * 0.65),
        rotation,
      );
      return {
        ...common,
        x: object.x + center.x - args.x,
        y: object.y + center.y - args.y,
        text: object.text,
        width: object.width,
        fontSize: object.fontSize,
        align: object.align,
      };
    });
    const firstIndex = Math.min(
      ...selected.map((object) =>
        project.objects.findIndex((item) => item.id === object.id),
      ),
    );
    const remaining = project.objects.filter(
      (object) => !objectIds.includes(object.id),
    );
    remaining.splice(
      Math.min(firstIndex, remaining.length),
      0,
      {
        id: args.assemblyId,
        type: 'assembly',
        name: args.name,
        x: args.x,
        y: args.y,
        rotation: 0,
        components,
      },
    );
    const updatedProject = validateChangedProject({
      ...project,
      objects: remaining,
    });
    return {
      project: updatedProject,
      result: { assemblyId: args.assemblyId, componentCount: components.length },
    };
  }

  if (toolName === 'ungroup_assembly') {
    const assembly = findObject(project, args.assemblyId, 'assembly');
    if (
      assembly.rotation !== 0 ||
      (assembly.scaleX ?? 1) !== 1 ||
      (assembly.scaleY ?? 1) !== 1 ||
      assembly.keyframes
    ) {
      throw new Error(
        'Ungrouping currently requires an unanimated assembly with zero rotation and unit scale.',
      );
    }
    if (
      assembly.components.some(
        (component) => component.parentId !== null || component.keyframes,
      )
    ) {
      throw new Error(
        'Ungrouping currently requires unanimated, unparented components.',
      );
    }
    const objects = assembly.components.map((component) => {
      const common = {
        id: component.id,
        type: component.type,
        rotation: component.rotation ?? 0,
        scaleX: component.scaleX ?? 1,
        scaleY: component.scaleY ?? 1,
        opacity: (assembly.opacity ?? 1) * (component.opacity ?? 1),
        fill: component.fill,
      };
      if (component.type === 'rectangle') {
        const offset = rotatePoint(
          (component.width * common.scaleX) / 2,
          (component.height * common.scaleY) / 2,
          common.rotation,
        );
        return {
          ...common,
          x: assembly.x + component.x - offset.x,
          y: assembly.y + component.y - offset.y,
          width: component.width,
          height: component.height,
        };
      }
      if (component.type === 'circle') {
        return {
          ...common,
          x: assembly.x + component.x,
          y: assembly.y + component.y,
          radius: component.radius,
        };
      }
      const offset = rotatePoint(
        (component.width * common.scaleX) / 2,
        component.fontSize * common.scaleY * 0.65,
        common.rotation,
      );
      return {
        ...common,
        x: assembly.x + component.x - offset.x,
        y: assembly.y + component.y - offset.y,
        text: component.text,
        width: component.width,
        fontSize: component.fontSize,
        align: component.align,
      };
    });
    const index = project.objects.findIndex((object) => object.id === assembly.id);
    const remaining = project.objects.filter((object) => object.id !== assembly.id);
    remaining.splice(index, 0, ...objects);
    const updatedProject = validateChangedProject({
      ...project,
      objects: remaining,
    });
    return {
      project: updatedProject,
      result: { assemblyId: assembly.id, objectCount: objects.length },
    };
  }

  if (toolName === 'duplicate_object') {
    const object = findObject(project, args.objectId);
    let copy = structuredClone(object);
    copy.id = args.newId;
    if (object.type === 'character') {
      const replacements = new Map(
        object.parts.map((part) => [
          part.id,
          `${args.newId}_${part.id.slice(object.id.length + 1)}`,
        ]),
      );
      copy.parts = copy.parts.map((part) => ({
        ...part,
        id: replacements.get(part.id),
        parentId: part.parentId === null ? null : replacements.get(part.parentId),
      }));
    }
    if (object.type === 'assembly') {
      const replacements = new Map(
        object.components.map((component, index) => [
          component.id,
          `${args.newId}_component_${index + 1}`,
        ]),
      );
      copy.components = copy.components.map((component) => ({
        ...component,
        id: replacements.get(component.id),
        parentId:
          component.parentId === null ? null : replacements.get(component.parentId),
      }));
    }
    copy.x += 24;
    copy.y += 24;
    const updatedProject = validateChangedProject({
      ...project,
      objects: [...project.objects, copy],
    });
    return {
      project: updatedProject,
      result: { objectId: object.id, duplicateId: copy.id },
    };
  }

  if (toolName === 'delete_object') {
    const object = findObject(project, args.objectId);
    const attachedObjects = project.objects.filter(
      (candidate) => candidate.attachment?.parentId === object.id,
    );
    if (attachedObjects.length) {
      throw new Error(
        `Cannot delete "${object.id}" while objects are attached to it: ${attachedObjects.map((item) => item.id).join(', ')}. Detach them first.`,
      );
    }
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.filter((candidate) => candidate.id !== object.id),
    });
    return {
      project: updatedProject,
      result: { deletedObjectId: object.id },
    };
  }

  if (toolName === 'reorder_layer') {
    const object = findObject(project, args.objectId);
    if (args.index >= project.objects.length) {
      throw new Error('Layer index must be within the scene object list.');
    }
    const objects = project.objects.filter((candidate) => candidate.id !== object.id);
    objects.splice(args.index, 0, object);
    return {
      project: { ...project, objects },
      result: { objectId: object.id, index: args.index },
    };
  }

  if (toolName === 'add_character') {
    requireRecord(args, 'Tool arguments');
    const id = requireString(args.id, 'Character ID');
    const name = requireString(args.name, 'Character name');
    const character = createCharacter(
      id,
      requireFiniteNumber(args.x, 'Character x position'),
      requireFiniteNumber(args.y, 'Character y position'),
      name,
    );
    const updatedProject = validateChangedProject({
      ...project,
      objects: [...project.objects, character],
    });
    return {
      project: updatedProject,
      result: { characterId: id, partCount: character.parts.length },
    };
  }

  if (toolName === 'apply_character_action') {
    requireRecord(args, 'Tool arguments');
    const character = findObject(project, args.characterId, 'character');
    if (typeof args.action !== 'string') {
      throw new Error('Action must be a string.');
    }
    const durationFrames = args.durationFrames;
    const startFrame = args.startFrame;
    requireSceneFrame(project, startFrame, 'Action start frame');
    if (!Number.isInteger(durationFrames) || durationFrames < 1) {
      throw new Error('Action duration must be at least one frame.');
    }
    requireSceneFrame(project, startFrame + durationFrames, 'Action end frame');
    if (args.loop !== undefined && typeof args.loop !== 'boolean') {
      throw new Error('Action loop must be a boolean.');
    }
    if (
      args.replaceExisting !== undefined &&
      typeof args.replaceExisting !== 'boolean'
    ) {
      throw new Error('replaceExisting must be a boolean.');
    }
    const plan = createCharacterActionPlan(
      character,
      args.action,
      startFrame,
      durationFrames,
      args.loop ?? false,
    );
    const applied = applyCharacterAction(character, plan, {
      replaceExisting: args.replaceExisting ?? false,
    });
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === character.id ? applied.character : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        characterId: character.id,
        action: args.action,
        startFrame,
        endFrame: startFrame + durationFrames,
        keyframeCount: plan.length,
        replacedKeyframes: applied.replacedKeyframes,
      },
    };
  }

  if (toolName === 'apply_character_pose') {
    const character = findObject(project, args.characterId, 'character');
    requireSceneFrame(project, args.startFrame, 'Pose start frame');
    requireSceneFrame(
      project,
      args.startFrame + args.durationFrames,
      'Pose end frame',
    );
    const plan = createCharacterPosePlan(
      character,
      args.pose,
      args.startFrame,
      args.durationFrames,
    );
    const updatedCharacter = {
      ...character,
      parts: character.parts.map((part) => {
        const keys = plan.filter((keyframe) => keyframe.partId === part.id);
        if (keys.length === 0) return part;
        const keyframes = { ...part.keyframes };
        for (const keyframe of keys) {
          keyframes.rotation = addOrUpdateKeyframe(
            { keyframes },
            'rotation',
            keyframe.frame,
            keyframe.value,
            'linear',
          ).keyframes.rotation;
        }
        return { ...part, keyframes };
      }),
    };
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === character.id ? updatedCharacter : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        characterId: character.id,
        pose: args.pose,
        startFrame: args.startFrame,
        endFrame: args.startFrame + args.durationFrames,
        keyframeCount: plan.length,
      },
    };
  }

  if (toolName === 'apply_character_sequence') {
    requireRecord(args, 'Tool arguments');
    const character = findObject(project, args.characterId, 'character');
    requireSceneFrame(project, args.startFrame, 'Sequence start frame');
    if (!Array.isArray(args.actions)) {
      throw new Error('Sequence actions must be an array.');
    }
    const sequence = createCharacterActionSequencePlan(
      character,
      args.actions,
      args.startFrame,
    );
    requireSceneFrame(project, sequence.endFrame, 'Sequence end frame');
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === character.id ? sequence.character : object,
      ),
    });
    return {
      project: updatedProject,
      result: {
        characterId: character.id,
        startFrame: sequence.startFrame,
        endFrame: sequence.endFrame,
        steps: sequence.steps,
        keyframeCount: sequence.keyframeCount,
        replacedKeyframes: sequence.replacedKeyframes,
      },
    };
  }

  if (toolName === 'set_character_transform') {
    requireRecord(args, 'Tool arguments');
    const character = findObject(project, args.characterId, 'character');
    const properties = requireRecord(args.properties, 'Transform properties');
    const entries = Object.entries(properties);
    if (entries.length === 0) {
      throw new Error('At least one character transform property is required.');
    }
    for (const [property, value] of entries) {
      if (!CHARACTER_TRANSFORM_PROPERTIES.includes(property)) {
        throw new Error(`Unsupported character transform property "${property}".`);
      }
      requireFiniteNumber(value, `Character ${property}`);
    }
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((object) =>
        object.id === character.id
          ? { ...object, ...properties }
          : object,
      ),
    });
    return {
      project: updatedProject,
      result: { characterId: character.id, properties },
    };
  }

  if (toolName === 'set_object_property') {
    requireRecord(args, 'Tool arguments');
    const object = findObject(project, args.objectId);
    const property = requireString(args.property, 'Property name');
    if (!OBJECT_PROPERTIES[object.type].includes(property)) {
      throw new Error(
        `Property "${property}" is not supported for ${object.type} objects.`,
      );
    }
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((candidate) =>
        candidate.id === object.id
          ? { ...candidate, [property]: args.value }
          : candidate,
      ),
    });
    return {
      project: updatedProject,
      result: { objectId: object.id, property, value: args.value },
    };
  }

  if (toolName === 'set_keyframe') {
    requireRecord(args, 'Tool arguments');
    let object = project.objects.find((candidate) => candidate.id === args.objectId);
    let inferredComponentId;
    if (!object && args.partId === undefined && args.componentId === undefined) {
      object = project.objects.find(
        (candidate) =>
          (candidate.type === 'assembly' || candidate.type === 'character') &&
          (candidate.components ?? candidate.parts ?? []).some(
            (component) => component.id === args.objectId,
          ),
      );
      if (object) inferredComponentId = args.objectId;
    }
    if (!object) object = findObject(project, args.objectId);
    requireSceneFrame(project, args.frame, 'Keyframe frame');
    let target = object;
    if (args.partId !== undefined && args.componentId !== undefined) {
      throw new Error('Provide either partId or componentId, not both.');
    }
    const targetId = args.componentId ?? args.partId ?? inferredComponentId;
    if (targetId !== undefined) {
      if (object.type !== 'character' && object.type !== 'assembly') {
        throw new Error('Only characters and assemblies have editable components.');
      }
      const targets =
        object.type === 'character' ? object.parts : object.components;
      target = targets.find((part) => part.id === targetId);
      if (!target) {
        throw new Error(`Object has no component "${targetId}".`);
      }
    }
    if (typeof args.property !== 'string') {
      throw new Error('Keyframe property must be a string.');
    }
    const updatedTarget = addOrUpdateKeyframe(
      target,
      args.property,
      args.frame,
      args.value,
      args.easing,
    );
    const updatedObject =
      target === object
        ? updatedTarget
        : {
            ...object,
              ...(object.type === 'character'
                ? {
                    parts: object.parts.map((part) =>
                      part.id === target.id ? updatedTarget : part,
                    ),
                  }
                : {
                    components: object.components.map((part) =>
                      part.id === target.id ? updatedTarget : part,
                    ),
                  }),
            };
    const updatedProject = validateChangedProject({
      ...project,
      objects: project.objects.map((candidate) =>
        candidate.id === object.id ? updatedObject : candidate,
      ),
    });
    return {
      project: updatedProject,
      result: {
        objectId: object.id,
        ...(targetId === undefined ? {} : { componentId: targetId }),
        property: args.property,
        frame: args.frame,
        value: args.value,
      },
    };
  }

  if (toolName === 'set_scene_duration') {
    requireRecord(args, 'Tool arguments');
    const durationSeconds = requireFiniteNumber(
      args.durationSeconds,
      'Scene duration',
    );
    if (durationSeconds < 1 || durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error(
        `Scene duration must be between 1 and ${MAX_DURATION_SECONDS} seconds.`,
      );
    }
    assertNoKeyframesBeyond(project, durationSeconds);
    const updatedProject = validateChangedProject({
      ...project,
      durationSeconds,
    });
    return {
      project: updatedProject,
      result: { durationSeconds },
    };
  }

  if (toolName === 'preview_animation') {
    requireRecord(args, 'Tool arguments');
    const { startFrame, endFrame, stepFrames } = args;
    requireSceneFrame(project, startFrame, 'Preview start frame');
    requireSceneFrame(project, endFrame, 'Preview end frame');
    if (endFrame < startFrame) {
      throw new Error('Preview end frame must not precede the start frame.');
    }
    if (!Number.isInteger(stepFrames) || stepFrames < 1) {
      throw new Error('Preview step must be at least one frame.');
    }
    const sampleCount = Math.ceil((endFrame - startFrame) / stepFrames) + 1;
    if (sampleCount > MAX_PREVIEW_SAMPLES) {
      throw new Error(
        `Preview range exceeds the limit of ${MAX_PREVIEW_SAMPLES} samples.`,
      );
    }
    const samples = [];
    for (let frame = startFrame; frame <= endFrame; frame += stepFrames) {
      samples.push({
        frame,
        objects: evaluateProjectAtFrame(project, frame),
      });
    }
    if (
      samples.length &&
      samples[samples.length - 1].frame !== endFrame &&
      samples.length < MAX_PREVIEW_SAMPLES
    ) {
      samples.push({
        frame: endFrame,
        objects: evaluateProjectAtFrame(project, endFrame),
      });
    }
    return {
      project,
      result: { samples },
    };
  }

  throw new Error(`Unknown animation tool "${toolName}".`);
}

export function executeAnimationTool(projectInput, toolName, args = {}) {
  const tool = typeof toolName === 'string' ? toolName : '';
  try {
    if (!ANIMATION_TOOL_SCHEMAS[tool]) {
      return {
        ok: false,
        tool,
        error: {
          code: 'unknown_tool',
          message: `Unknown animation tool "${tool}".`,
        },
      };
    }
    validateSchemaValue(args, ANIMATION_TOOL_SCHEMAS[tool], 'Tool arguments');
    const project = normalizeProject(projectInput);
    const execution = runTool(project, tool, args);
    return {
      ok: true,
      tool,
      project: execution.project,
      result: execution.result,
    };
  } catch (error) {
    return {
      ok: false,
      tool,
      error: {
        code: 'invalid_tool_call',
        message:
          error instanceof Error ? error.message : 'Animation tool failed.',
      },
    };
  }
}
