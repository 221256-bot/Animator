import {
  ANIMATABLE_PROPERTIES,
  EASING_TYPES,
} from './animation.js';
import {
  MAX_PROJECT_ASSETS,
  MAX_TOTAL_ARTWORK_BYTES,
  SUPPORTED_ARTWORK_TYPES,
  validateAssetSource,
} from './assetPipeline.js';

export const PROJECT_VERSION = 1;
export const PROJECT_WIDTH = 1280;
export const PROJECT_HEIGHT = 720;
export const DEFAULT_DURATION_SECONDS = 10;
export const MAX_DURATION_SECONDS = 600;
export const AUTOSAVE_KEY = 'animator-editor-project-v1';

const MAX_OBJECTS = 10000;
const MAX_CHARACTER_PARTS = 1000;
const MAX_ASSEMBLY_COMPONENTS = 1000;
const MAX_ANCHORS = 100;
const MAX_TEXT_LENGTH = 10000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNumber(value, label, minimum = -Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number${minimum > -Infinity ? ` greater than or equal to ${minimum}` : ''}.`);
  }
  return value;
}

function normalizeKeyframes(value, label) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${label} keyframes must be an object.`);

  const keyframes = {};
  for (const [property, frames] of Object.entries(value)) {
    if (!ANIMATABLE_PROPERTIES.includes(property)) {
      throw new Error(`${label} has an unsupported keyframe property "${property}".`);
    }
    if (!Array.isArray(frames)) {
      throw new Error(`${label} ${property} keyframes must be an array.`);
    }

    const seenFrames = new Set();
    keyframes[property] = frames
      .map((keyframe, frameIndex) => {
        const frameLabel = `${label} ${property} keyframe ${frameIndex + 1}`;
        if (!isRecord(keyframe)) {
          throw new Error(`${frameLabel} must be an object.`);
        }
        if (!Number.isInteger(keyframe.frame) || keyframe.frame < 0) {
          throw new Error(`${frameLabel} frame must be a non-negative integer.`);
        }
        if (seenFrames.has(keyframe.frame)) {
          throw new Error(`${label} has duplicate ${property} keyframes at frame ${keyframe.frame}.`);
        }
        seenFrames.add(keyframe.frame);
        const value = requireNumber(keyframe.value, `${frameLabel} value`);
        if (
          (property === 'scaleX' || property === 'scaleY') &&
          value < 0.01
        ) {
          throw new Error(`${frameLabel} scale must be at least 0.01.`);
        }
        if (
          property === 'opacity' &&
          (value < 0 || value > 1)
        ) {
          throw new Error(`${frameLabel} opacity must be between 0 and 1.`);
        }
        if (
          keyframe.easing !== undefined &&
          !EASING_TYPES.includes(keyframe.easing)
        ) {
          throw new Error(`${frameLabel} has an unsupported easing type.`);
        }

        return {
          frame: keyframe.frame,
          value,
          ...(keyframe.easing === undefined
            ? {}
            : { easing: keyframe.easing }),
        };
      })
      .sort((first, second) => first.frame - second.frame);
  }

  return keyframes;
}

function normalizeCharacter(value, label, ids, common) {
  if (typeof value.name !== 'string' || value.name.length > 100) {
    throw new Error(`${label} name must be a string of at most 100 characters.`);
  }
  if (
    !Array.isArray(value.parts) ||
    value.parts.length === 0 ||
    value.parts.length > MAX_CHARACTER_PARTS
  ) {
    throw new Error(
      `${label} parts must be an array of 1 to ${MAX_CHARACTER_PARTS} body parts.`,
    );
  }

  const partIds = new Set();
  const parts = value.parts.map((part, index) => {
    const partLabel = `${label} part ${index + 1}`;
    if (!isRecord(part)) throw new Error(`${partLabel} must be an object.`);
    if (typeof part.id !== 'string' || !ID_PATTERN.test(part.id)) {
      throw new Error(`${partLabel} has an invalid ID.`);
    }
    if (ids.has(part.id) || partIds.has(part.id)) {
      throw new Error(`Duplicate object or character part ID "${part.id}".`);
    }
    ids.add(part.id);
    partIds.add(part.id);
    if (!['ellipse', 'roundedRect'].includes(part.shape)) {
      throw new Error(`${partLabel} has an unsupported shape.`);
    }
    if (part.parentId !== null && typeof part.parentId !== 'string') {
      throw new Error(`${partLabel} parent ID must be a string or null.`);
    }
    if (part.parentId !== null && !ID_PATTERN.test(part.parentId)) {
      throw new Error(`${partLabel} has an invalid parent ID.`);
    }
    if (typeof part.fill !== 'string' || !COLOR_PATTERN.test(part.fill)) {
      throw new Error(`${partLabel} must have a valid six-digit hex fill color.`);
    }

    const width = requireNumber(part.width, `${partLabel} width`, 1);
    const height = requireNumber(part.height, `${partLabel} height`, 1);
    const cornerRadius =
      part.cornerRadius === undefined
        ? part.shape === 'roundedRect'
          ? Math.min(width, height) / 2
          : 0
        : requireNumber(part.cornerRadius, `${partLabel} corner radius`, 0);
    if (cornerRadius > Math.min(width, height) / 2) {
      throw new Error(`${partLabel} corner radius is too large.`);
    }
    const keyframes = normalizeKeyframes(part.keyframes, partLabel);

    return {
      id: part.id,
      parentId: part.parentId,
      shape: part.shape,
      x: requireNumber(part.x, `${partLabel} local x position`),
      y: requireNumber(part.y, `${partLabel} local y position`),
      ...(part.shapeOffsetX === undefined
        ? {}
        : {
            shapeOffsetX: requireNumber(
              part.shapeOffsetX,
              `${partLabel} shape horizontal offset`,
            ),
          }),
      ...(part.shapeOffsetY === undefined
        ? {}
        : {
            shapeOffsetY: requireNumber(
              part.shapeOffsetY,
              `${partLabel} shape vertical offset`,
            ),
          }),
      width,
      height,
      rotation:
        part.rotation === undefined
          ? 0
          : requireNumber(part.rotation, `${partLabel} rotation`),
      fill: part.fill,
      cornerRadius,
      ...(keyframes && Object.keys(keyframes).length > 0 ? { keyframes } : {}),
    };
  });

  const partsById = new Map(parts.map((part) => [part.id, part]));
  const roots = parts.filter((part) => part.parentId === null);
  if (roots.length !== 1) {
    throw new Error(`${label} must have exactly one root body part.`);
  }
  for (const part of parts) {
    if (part.parentId !== null && !partsById.has(part.parentId)) {
      throw new Error(`${label} part "${part.id}" has an unknown parent ID.`);
    }

    const visited = new Set([part.id]);
    let ancestorId = part.parentId;
    while (ancestorId !== null) {
      if (visited.has(ancestorId)) {
        throw new Error(`${label} parts must not contain parent cycles.`);
      }
      visited.add(ancestorId);
      ancestorId = partsById.get(ancestorId)?.parentId;
    }
  }

  return {
    ...common,
    type: 'character',
    name: value.name,
    parts,
  };
}

function normalizeAssembly(value, label, ids, common) {
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) {
    throw new Error(`${label} name must be a non-empty string of at most 100 characters.`);
  }
  if (
    !Array.isArray(value.components) ||
    value.components.length === 0 ||
    value.components.length > MAX_ASSEMBLY_COMPONENTS
  ) {
    throw new Error(
      `${label} components must be an array of 1 to ${MAX_ASSEMBLY_COMPONENTS} components.`,
    );
  }

  const components = value.components.map((component, index) => {
    const componentLabel = `${label} component ${index + 1}`;
    if (!isRecord(component)) {
      throw new Error(`${componentLabel} must be an object.`);
    }
    if (typeof component.id !== 'string' || !ID_PATTERN.test(component.id)) {
      throw new Error(`${componentLabel} has an invalid ID.`);
    }
    if (ids.has(component.id)) {
      throw new Error(`Duplicate object or component ID "${component.id}".`);
    }
    ids.add(component.id);
    if (!['rectangle', 'circle', 'text'].includes(component.type)) {
      throw new Error(`${componentLabel} has an unsupported type.`);
    }
    if (
      component.parentId !== undefined &&
      component.parentId !== null &&
      (typeof component.parentId !== 'string' ||
        !ID_PATTERN.test(component.parentId))
    ) {
      throw new Error(`${componentLabel} parent ID must be a valid ID or null.`);
    }
    if (typeof component.fill !== 'string' || !COLOR_PATTERN.test(component.fill)) {
      throw new Error(`${componentLabel} must have a valid six-digit hex fill color.`);
    }

    const normalized = {
      id: component.id,
      type: component.type,
      parentId: component.parentId ?? null,
      x: requireNumber(component.x, `${componentLabel} local x position`),
      y: requireNumber(component.y, `${componentLabel} local y position`),
      rotation:
        component.rotation === undefined
          ? 0
          : requireNumber(component.rotation, `${componentLabel} rotation`),
      scaleX:
        component.scaleX === undefined
          ? 1
          : requireNumber(component.scaleX, `${componentLabel} horizontal scale`, 0.01),
      scaleY:
        component.scaleY === undefined
          ? 1
          : requireNumber(component.scaleY, `${componentLabel} vertical scale`, 0.01),
      opacity:
        component.opacity === undefined
          ? 1
          : requireNumber(component.opacity, `${componentLabel} opacity`, 0),
      fill: component.fill,
    };
    if (normalized.opacity > 1) {
      throw new Error(`${componentLabel} opacity must be less than or equal to 1.`);
    }

    if (component.type === 'rectangle') {
      normalized.width = requireNumber(
        component.width,
        `${componentLabel} width`,
        1,
      );
      normalized.height = requireNumber(
        component.height,
        `${componentLabel} height`,
        1,
      );
      normalized.cornerRadius =
        component.cornerRadius === undefined
          ? 0
          : requireNumber(
              component.cornerRadius,
              `${componentLabel} corner radius`,
              0,
            );
      if (
        normalized.cornerRadius >
        Math.min(normalized.width, normalized.height) / 2
      ) {
        throw new Error(`${componentLabel} corner radius is too large.`);
      }
    } else if (component.type === 'circle') {
      normalized.radius = requireNumber(
        component.radius,
        `${componentLabel} radius`,
        1,
      );
    } else {
      if (
        typeof component.text !== 'string' ||
        component.text.length > MAX_TEXT_LENGTH
      ) {
        throw new Error(
          `${componentLabel} text must be a string of at most ${MAX_TEXT_LENGTH} characters.`,
        );
      }
      if (!['left', 'center', 'right'].includes(component.align ?? 'left')) {
        throw new Error(`${componentLabel} text alignment must be left, center, or right.`);
      }
      normalized.text = component.text;
      normalized.width = requireNumber(
        component.width,
        `${componentLabel} width`,
        1,
      );
      normalized.fontSize = requireNumber(
        component.fontSize,
        `${componentLabel} font size`,
        1,
      );
      normalized.align = component.align ?? 'left';
    }

    const keyframes = normalizeKeyframes(
      component.keyframes,
      componentLabel,
    );
    if (keyframes && Object.keys(keyframes).length > 0) {
      normalized.keyframes = keyframes;
    }
    return normalized;
  });

  const componentsById = new Map(components.map((item) => [item.id, item]));
  for (const component of components) {
    if (component.parentId !== null && !componentsById.has(component.parentId)) {
      throw new Error(
        `${label} component "${component.id}" has an unknown parent ID.`,
      );
    }
    const visited = new Set([component.id]);
    let ancestorId = component.parentId;
    while (ancestorId !== null) {
      if (visited.has(ancestorId)) {
        throw new Error(`${label} components must not contain parent cycles.`);
      }
      visited.add(ancestorId);
      ancestorId = componentsById.get(ancestorId)?.parentId ?? null;
    }
  }

  return {
    ...common,
    type: 'assembly',
    name: value.name.trim(),
    components,
  };
}

function normalizeAnchors(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ANCHORS) {
    throw new Error(`${label} anchors must be an array of at most ${MAX_ANCHORS} items.`);
  }
  const seen = new Set();
  return value.map((anchor, index) => {
    const anchorLabel = `${label} anchor ${index + 1}`;
    if (!isRecord(anchor)) throw new Error(`${anchorLabel} must be an object.`);
    if (typeof anchor.id !== 'string' || !ID_PATTERN.test(anchor.id)) {
      throw new Error(`${anchorLabel} has an invalid ID.`);
    }
    if (seen.has(anchor.id)) {
      throw new Error(`${label} has duplicate anchor ID "${anchor.id}".`);
    }
    seen.add(anchor.id);
    return {
      id: anchor.id,
      x: requireNumber(anchor.x, `${anchorLabel} x position`),
      y: requireNumber(anchor.y, `${anchorLabel} y position`),
      rotation:
        anchor.rotation === undefined
          ? 0
          : requireNumber(anchor.rotation, `${anchorLabel} rotation`),
    };
  });
}

function normalizeAssets(value, ids) {
  const assets = value ?? [];
  if (!Array.isArray(assets) || assets.length > MAX_PROJECT_ASSETS) {
    throw new Error(
      `Project artwork assets must be an array of at most ${MAX_PROJECT_ASSETS} items.`,
    );
  }
  let totalBytes = 0;
  return assets.map((asset, index) => {
    const label = `Artwork asset ${index + 1}`;
    if (!isRecord(asset)) throw new Error(`${label} must be an object.`);
    if (typeof asset.id !== 'string' || !ID_PATTERN.test(asset.id)) {
      throw new Error(`${label} has an invalid ID.`);
    }
    if (ids.has(asset.id)) {
      throw new Error(`Duplicate project resource ID "${asset.id}".`);
    }
    ids.add(asset.id);
    if (
      typeof asset.name !== 'string' ||
      !asset.name.trim() ||
      asset.name.length > 160
    ) {
      throw new Error(`${label} name must be between 1 and 160 characters.`);
    }
    if (!Object.values(SUPPORTED_ARTWORK_TYPES).includes(asset.mimeType)) {
      throw new Error(`${label} has an unsupported artwork format.`);
    }
    const bytes = validateAssetSource(asset.dataUrl, asset.mimeType);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ARTWORK_BYTES) {
      throw new Error('Project artwork assets cannot exceed 8 MB combined.');
    }
    return {
      id: asset.id,
      name: asset.name.trim(),
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
      width: requireNumber(asset.width, `${label} width`, 1),
      height: requireNumber(asset.height, `${label} height`, 1),
    };
  });
}

function normalizeObject(value, index, ids, assetsById) {
  const label = `Object ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    throw new Error(`${label} has an invalid ID.`);
  }
  if (ids.has(value.id)) throw new Error(`Duplicate object ID "${value.id}".`);
  ids.add(value.id);

  if (!['rectangle', 'circle', 'text', 'image', 'character', 'assembly'].includes(value.type)) {
    throw new Error(`${label} has an unsupported type.`);
  }

  const common = {
    id: value.id,
    type: value.type,
    x: requireNumber(value.x, `${label} x position`),
    y: requireNumber(value.y, `${label} y position`),
    rotation:
      value.rotation === undefined
        ? 0
        : requireNumber(value.rotation, `${label} rotation`),
  };
  if (value.depthRole !== undefined) {
    if (!['background', 'midground', 'foreground'].includes(value.depthRole)) {
      throw new Error(`${label} depth role must be background, midground, or foreground.`);
    }
    common.depthRole = value.depthRole;
  }
  if (value.scaleX !== undefined) {
    common.scaleX = requireNumber(value.scaleX, `${label} horizontal scale`, 0.01);
  }
  if (value.scaleY !== undefined) {
    common.scaleY = requireNumber(value.scaleY, `${label} vertical scale`, 0.01);
  }
  if (value.opacity !== undefined) {
    common.opacity = requireNumber(value.opacity, `${label} opacity`, 0);
    if (common.opacity > 1) {
      throw new Error(`${label} opacity must be less than or equal to 1.`);
    }
  }
  const keyframes = normalizeKeyframes(value.keyframes, label);
  if (keyframes && Object.keys(keyframes).length > 0) {
    common.keyframes = keyframes;
  }
  const anchors = normalizeAnchors(value.anchors, label);
  if (anchors) common.anchors = anchors;
  if (value.attachment !== undefined) {
    if (!isRecord(value.attachment)) {
      throw new Error(`${label} attachment must be an object.`);
    }
    common.attachment = {
      parentId: requireId(value.attachment.parentId, `${label} attachment parent ID`),
      anchorId: requireId(value.attachment.anchorId, `${label} attachment anchor ID`),
    };
    if (common.attachment.parentId === value.id) {
      throw new Error(`${label} cannot be attached to itself.`);
    }
  }

  if (value.type === 'character') {
    return normalizeCharacter(value, label, ids, common);
  }
  if (value.type === 'assembly') {
    return normalizeAssembly(value, label, ids, common);
  }
  if (value.type === 'rectangle') {
    if (typeof value.fill !== 'string' || !COLOR_PATTERN.test(value.fill)) {
      throw new Error(`${label} must have a valid six-digit hex fill color.`);
    }
    common.fill = value.fill;
    return {
      ...common,
      width: requireNumber(value.width, `${label} width`, 5),
      height: requireNumber(value.height, `${label} height`, 5),
    };
  }

  if (value.type === 'circle') {
    if (typeof value.fill !== 'string' || !COLOR_PATTERN.test(value.fill)) {
      throw new Error(`${label} must have a valid six-digit hex fill color.`);
    }
    common.fill = value.fill;
    return {
      ...common,
      radius: requireNumber(value.radius, `${label} radius`, 5),
    };
  }

  if (value.type === 'image') {
    if (typeof value.assetId !== 'string' || !assetsById.has(value.assetId)) {
      throw new Error(`${label} references an unknown artwork asset.`);
    }
    const name =
      value.name === undefined
        ? assetsById.get(value.assetId).name
        : value.name;
    if (typeof name !== 'string' || name.length > 160) {
      throw new Error(`${label} artwork name must be at most 160 characters.`);
    }
    return {
      ...common,
      type: 'image',
      assetId: value.assetId,
      name,
      width: requireNumber(value.width, `${label} width`, 1),
      height: requireNumber(value.height, `${label} height`, 1),
    };
  }

  if (typeof value.fill !== 'string' || !COLOR_PATTERN.test(value.fill)) {
    throw new Error(`${label} must have a valid six-digit hex fill color.`);
  }
  common.fill = value.fill;
  if (typeof value.text !== 'string' || value.text.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} text must be a string of at most ${MAX_TEXT_LENGTH} characters.`);
  }

  if (!['left', 'center', 'right'].includes(value.align)) {
    throw new Error(`${label} text alignment must be left, center, or right.`);
  }

  return {
    ...common,
    text: value.text,
    width: requireNumber(value.width, `${label} width`, 10),
    fontSize: requireNumber(value.fontSize, `${label} font size`, 5),
    align: value.align,
  };
}

export function createProject(
  objects,
  name = 'Untitled project',
  durationSeconds = DEFAULT_DURATION_SECONDS,
  assets = [],
) {
  requireNumber(durationSeconds, 'Project duration', 1);
  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error(
      `Project duration must be less than or equal to ${MAX_DURATION_SECONDS} seconds.`,
    );
  }
  return {
    version: PROJECT_VERSION,
    name,
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    durationSeconds,
    objects,
    assets,
  };
}

export function parseProject(contents) {
  let project;
  try {
    project = JSON.parse(contents);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  if (!isRecord(project)) throw new Error('The project file must contain a JSON object.');
  if (project.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version. Expected version ${PROJECT_VERSION}.`);
  }
  if (project.width !== PROJECT_WIDTH || project.height !== PROJECT_HEIGHT) {
    throw new Error(`The project stage must be ${PROJECT_WIDTH} × ${PROJECT_HEIGHT}.`);
  }
  if (project.name !== undefined && typeof project.name !== 'string') {
    throw new Error('Project name must be a string.');
  }
  const durationSeconds =
    project.durationSeconds === undefined
      ? DEFAULT_DURATION_SECONDS
      : requireNumber(project.durationSeconds, 'Project duration', 1);
  if (durationSeconds > MAX_DURATION_SECONDS) {
    throw new Error(
      `Project duration must be less than or equal to ${MAX_DURATION_SECONDS} seconds.`,
    );
  }
  if (!Array.isArray(project.objects) || project.objects.length > MAX_OBJECTS) {
    throw new Error(`Project objects must be an array of at most ${MAX_OBJECTS} items.`);
  }

  const ids = new Set();
  const assets = normalizeAssets(project.assets, ids);
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const objects = project.objects.map((object, index) =>
    normalizeObject(object, index, ids, assetsById),
  );
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    if (!object.attachment) continue;
    const parent = objectsById.get(object.attachment.parentId);
    if (!parent) {
      throw new Error(
        `Object "${object.id}" attachment references unknown parent "${object.attachment.parentId}".`,
      );
    }
    if (!parent.anchors?.some((anchor) => anchor.id === object.attachment.anchorId)) {
      throw new Error(
        `Object "${object.id}" attachment references unknown anchor "${object.attachment.anchorId}" on "${parent.id}".`,
      );
    }
  }
  for (const object of objects) {
    const visited = new Set([object.id]);
    let parentId = object.attachment?.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        throw new Error('Project attachments must not contain cycles.');
      }
      visited.add(parentId);
      parentId = objectsById.get(parentId)?.attachment?.parentId;
    }
  }
  return {
    version: PROJECT_VERSION,
    name: project.name?.trim() || 'Untitled project',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    durationSeconds,
    objects,
    assets,
  };
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid ID.`);
  }
  return value;
}
