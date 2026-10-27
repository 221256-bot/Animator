import { evaluateProjectAtFrame } from './sceneEvaluation.js';

function transformMatrix(x, y, rotation, scaleX, scaleY) {
  const radians = (rotation * Math.PI) / 180;
  return {
    a: Math.cos(radians) * scaleX,
    b: Math.sin(radians) * scaleX,
    c: -Math.sin(radians) * scaleY,
    d: Math.cos(radians) * scaleY,
    e: x,
    f: y,
  };
}

function compose(parent, local) {
  const localMatrix = transformMatrix(
    local.x,
    local.y,
    local.rotation ?? 0,
    local.scaleX ?? 1,
    local.scaleY ?? 1,
  );
  return {
    a: parent.a * localMatrix.a + parent.c * localMatrix.b,
    b: parent.b * localMatrix.a + parent.d * localMatrix.b,
    c: parent.a * localMatrix.c + parent.c * localMatrix.d,
    d: parent.b * localMatrix.c + parent.d * localMatrix.d,
    e: parent.a * localMatrix.e + parent.c * localMatrix.f + parent.e,
    f: parent.b * localMatrix.e + parent.d * localMatrix.f + parent.f,
  };
}

function boundsForEllipse(matrix, width, height, offsetX = 0, offsetY = 0) {
  const centerX = matrix.a * offsetX + matrix.c * offsetY + matrix.e;
  const centerY = matrix.b * offsetX + matrix.d * offsetY + matrix.f;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const extentX = Math.hypot(matrix.a * radiusX, matrix.c * radiusY);
  const extentY = Math.hypot(matrix.b * radiusX, matrix.d * radiusY);
  return {
    left: centerX - extentX,
    right: centerX + extentX,
    top: centerY - extentY,
    bottom: centerY + extentY,
  };
}

function boundsForShape(matrix, width, height, offsetX = 0, offsetY = 0) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    [offsetX - halfWidth, offsetY - halfHeight],
    [offsetX + halfWidth, offsetY - halfHeight],
    [offsetX + halfWidth, offsetY + halfHeight],
    [offsetX - halfWidth, offsetY + halfHeight],
  ].map(([x, y]) => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }));
  return {
    left: Math.min(...corners.map((point) => point.x)),
    right: Math.max(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

function boundsForObject(object) {
  if (object.type === 'rectangle') {
    return boundsForShape(
      transformMatrix(
        object.x,
        object.y,
        object.rotation ?? 0,
        object.scaleX ?? 1,
        object.scaleY ?? 1,
      ),
      object.width,
      object.height,
      object.width / 2,
      object.height / 2,
    );
  }
  if (object.type === 'image') {
    return boundsForShape(
      transformMatrix(
        object.x,
        object.y,
        object.rotation ?? 0,
        object.scaleX ?? 1,
        object.scaleY ?? 1,
      ),
      object.width,
      object.height,
      object.width / 2,
      object.height / 2,
    );
  }
  if (object.type === 'circle') {
    return boundsForEllipse(
      transformMatrix(
        object.x,
        object.y,
        object.rotation ?? 0,
        object.scaleX ?? 1,
        object.scaleY ?? 1,
      ),
      object.radius * 2,
      object.radius * 2,
    );
  }
  if (object.type === 'text') {
    return boundsForShape(
      transformMatrix(
        object.x,
        object.y,
        object.rotation ?? 0,
        object.scaleX ?? 1,
        object.scaleY ?? 1,
      ),
      object.width,
      object.fontSize,
      object.width / 2,
      object.fontSize / 2,
    );
  }
  const descendants =
    object.type === 'character'
      ? getCharacterPartBounds(object)
      : getAssemblyComponentBounds(object);
  if (!descendants.length) return null;
  return {
    left: Math.min(...descendants.map((item) => item.bounds.left)),
    right: Math.max(...descendants.map((item) => item.bounds.right)),
    top: Math.min(...descendants.map((item) => item.bounds.top)),
    bottom: Math.max(...descendants.map((item) => item.bounds.bottom)),
  };
}

function getCharacterPartBounds(character) {
  const transforms = new Map();
  const bounds = [];
  function visit(part) {
    const parentTransform = part.parentId
      ? transforms.get(part.parentId)
      : transformMatrix(
          character.x,
          character.y,
          character.rotation ?? 0,
          character.scaleX ?? 1,
          character.scaleY ?? 1,
        );
    const transform = compose(parentTransform, part);
    transforms.set(part.id, transform);
    const shapeBounds =
      part.shape === 'ellipse' ? boundsForEllipse : boundsForShape;
    bounds.push({
      id: part.id,
      parentId: part.parentId,
      bounds: shapeBounds(
        transform,
        part.width,
        part.height,
        part.shapeOffsetX ?? 0,
        part.shapeOffsetY ?? 0,
      ),
    });
    for (const child of character.parts.filter((item) => item.parentId === part.id)) {
      visit(child);
    }
  }
  for (const root of character.parts.filter((part) => part.parentId === null)) {
    visit(root);
  }
  return bounds;
}

function getAssemblyComponentBounds(assembly) {
  const transforms = new Map();
  const bounds = [];
  function visit(component) {
    const parentTransform = component.parentId
      ? transforms.get(component.parentId)
      : transformMatrix(
          assembly.x,
          assembly.y,
          assembly.rotation ?? 0,
          assembly.scaleX ?? 1,
          assembly.scaleY ?? 1,
        );
    const transform = compose(parentTransform, component);
    transforms.set(component.id, transform);
    const width =
      component.type === 'circle'
        ? component.radius * 2
        : component.width;
    const height =
      component.type === 'circle'
        ? component.radius * 2
        : component.type === 'text'
          ? component.fontSize * 1.3
          : component.height;
    const shapeBounds =
      component.type === 'circle' ? boundsForEllipse : boundsForShape;
    bounds.push({
      id: component.id,
      parentId: component.parentId,
      bounds: shapeBounds(transform, width, height),
    });
    for (const child of assembly.components.filter(
      (item) => item.parentId === component.id,
    )) {
      visit(child);
    }
  }
  for (const root of assembly.components.filter(
    (component) => component.parentId === null,
  )) {
    visit(root);
  }
  return bounds;
}

function boxesOverlap(first, second, tolerance = 1) {
  return (
    first.left <= second.right + tolerance &&
    first.right >= second.left - tolerance &&
    first.top <= second.bottom + tolerance &&
    first.bottom >= second.top - tolerance
  );
}

function intersectionRatio(first, second) {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  const intersection = width * height;
  const smallerArea = Math.min(
    (first.right - first.left) * (first.bottom - first.top),
    (second.right - second.left) * (second.bottom - second.top),
  );
  return smallerArea > 0 ? intersection / smallerArea : 0;
}

function isContained(first, second) {
  return (
    (first.left <= second.left &&
      first.top <= second.top &&
      first.right >= second.right &&
      first.bottom >= second.bottom) ||
    (second.left <= first.left &&
      second.top <= first.top &&
      second.right >= first.right &&
      second.bottom >= first.bottom)
  );
}

export function analyzeSceneQuality(
  project,
  frame = 0,
  {
    overlapThreshold = 0.65,
    includeOverlapCandidates = true,
    attachmentDistanceMultiplier = 4,
    characterConnectionTolerance = 1,
    assemblyConnectionTolerance = 5,
  } = {},
) {
  const warnings = [];
  let rigJointCount = 0;
  const evaluatedObjects = evaluateProjectAtFrame(project, frame);
  const objectBounds = new Map();
  for (const object of evaluatedObjects) {
    const bounds = boundsForObject(object);
    if (bounds) objectBounds.set(object.id, bounds);
    if (bounds) {
      const outsideEdges = [];
      if (bounds.left < 0) outsideEdges.push('left');
      if (bounds.top < 0) outsideEdges.push('top');
      if (bounds.right > project.width) outsideEdges.push('right');
      if (bounds.bottom > project.height) outsideEdges.push('bottom');
      if (outsideEdges.length) {
        warnings.push({
          code: 'object_outside_stage',
          objectId: object.id,
          message: `"${object.name ?? object.id}" extends beyond the ${outsideEdges.join(', ')} edge of the stage.`,
        });
      }
    }
    if (object.type !== 'character') continue;
    const parts = getCharacterPartBounds(object);
    const partsById = new Map(parts.map((part) => [part.id, part]));
    for (const part of parts) {
      if (!part.parentId) continue;
      rigJointCount += 1;
      const parent = partsById.get(part.parentId);
      if (
        parent &&
        !boxesOverlap(
          part.bounds,
          parent.bounds,
          characterConnectionTolerance,
        )
      ) {
        warnings.push({
          code: 'disconnected_character_part',
          objectId: object.id,
          partId: part.id,
          parentId: part.parentId,
          message: `Character part "${part.id}" does not touch parent part "${part.parentId}".`,
        });
      }
    }
  }
  for (const object of evaluatedObjects) {
    if (object.type !== 'assembly') continue;
    const descendants = getAssemblyComponentBounds(object);
    const descendantsById = new Map(
      descendants.map((item) => [item.id, item]),
    );
    for (const item of descendants) {
      if (!item.parentId) continue;
      const parent = descendantsById.get(item.parentId);
      if (
        parent &&
        !boxesOverlap(
          item.bounds,
          parent.bounds,
          assemblyConnectionTolerance,
        )
      ) {
        warnings.push({
          code: 'disconnected_assembly_component',
          objectId: object.id,
          componentId: item.id,
          parentId: item.parentId,
          message: `Component "${item.id}" does not touch parent component "${item.parentId}".`,
        });
      }
    }
  }

  const layerRoles = { background: 0, midground: 1, foreground: 2 };
  const layerOrder = new Map(evaluatedObjects.map((object, index) => [object.id, index]));
  const evaluatedById = new Map(evaluatedObjects.map((object) => [object.id, object]));
  for (let firstIndex = 0; firstIndex < evaluatedObjects.length; firstIndex += 1) {
    const first = evaluatedObjects[firstIndex];
    const firstBounds = objectBounds.get(first.id);
    if (!firstBounds) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < evaluatedObjects.length; secondIndex += 1) {
      const second = evaluatedObjects[secondIndex];
      const secondBounds = objectBounds.get(second.id);
      if (!secondBounds) continue;
      if (
        (first.depthRole in layerRoles &&
          second.depthRole in layerRoles &&
          layerRoles[first.depthRole] < layerRoles[second.depthRole] &&
          layerOrder.get(first.id) > layerOrder.get(second.id)) ||
        (first.depthRole in layerRoles &&
          second.depthRole in layerRoles &&
          layerRoles[second.depthRole] < layerRoles[first.depthRole] &&
          layerOrder.get(second.id) > layerOrder.get(first.id))
      ) {
        const background =
          layerRoles[first.depthRole] < layerRoles[second.depthRole] ? first : second;
        const foreground = background === first ? second : first;
        warnings.push({
          code: 'depth_role_layer_order',
          objectId: background.id,
          relatedObjectId: foreground.id,
          message: `Background object "${background.id}" is layered in front of ${foreground.depthRole} object "${foreground.id}".`,
        });
      }
      if (
        includeOverlapCandidates &&
        first.attachment?.parentId !== second.id &&
        second.attachment?.parentId !== first.id &&
        boxesOverlap(firstBounds, secondBounds) &&
        !isContained(firstBounds, secondBounds) &&
        intersectionRatio(firstBounds, secondBounds) >= overlapThreshold
      ) {
        warnings.push({
          code: 'object_overlap_candidate',
          objectId: first.id,
          relatedObjectId: second.id,
          message: `"${first.name ?? first.id}" and "${second.name ?? second.id}" overlap substantially; verify that this is intentional.`,
        });
      }
    }

    if (first.attachment) {
      const parentBounds = objectBounds.get(first.attachment.parentId);
      const parent = evaluatedById.get(first.attachment.parentId);
      if (parentBounds) {
        const scale = Math.max(
          parentBounds.right - parentBounds.left,
          parentBounds.bottom - parentBounds.top,
          1,
        );
        const anchor = parent?.anchors?.find(
          (candidate) => candidate.id === first.attachment.anchorId,
        );
        if (anchor) {
          const radians = ((parent.rotation ?? 0) * Math.PI) / 180;
          const anchorX =
            (anchor.x * (parent.scaleX ?? 1)) * Math.cos(radians) -
            (anchor.y * (parent.scaleY ?? 1)) * Math.sin(radians) +
            parent.x;
          const anchorY =
            (anchor.x * (parent.scaleX ?? 1)) * Math.sin(radians) +
            (anchor.y * (parent.scaleY ?? 1)) * Math.cos(radians) +
            parent.y;
          const delta = Math.hypot(first.x - anchorX, first.y - anchorY);
          if (delta > scale * attachmentDistanceMultiplier) {
            warnings.push({
              code: 'attachment_offset_outlier',
              objectId: first.id,
              relatedObjectId: first.attachment.parentId,
              message: `Attached object "${first.id}" is unusually far from anchor "${first.attachment.anchorId}"; check its relative placement.`,
            });
          }
        }
      }
    }
  }
  return {
    valid: warnings.length === 0,
    frame,
    objectCount: project.objects.length,
    rigJointCount,
    warningCount: warnings.length,
    warnings,
  };
}

function collectAnimationFrames(project, intermediateSteps) {
  const endFrame = Math.round(project.durationSeconds * 30);
  const frames = new Set([0, endFrame]);
  for (const object of project.objects) {
    const targets = [
      object,
      ...(object.parts ?? []),
      ...(object.components ?? []),
    ];
    for (const target of targets) {
      for (const keyframes of Object.values(target.keyframes ?? {})) {
        for (const keyframe of keyframes) {
          frames.add(keyframe.frame);
        }
      }
    }
  }
  const keyframes = [...frames].sort((first, second) => first - second);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const start = keyframes[index];
    const end = keyframes[index + 1];
    for (let step = 1; step <= intermediateSteps; step += 1) {
      frames.add(Math.round(start + ((end - start) * step) / (intermediateSteps + 1)));
    }
  }
  return [...frames].sort((first, second) => first - second);
}

export function analyzeSceneTimelineQuality(
  project,
  {
    intermediateSteps = 2,
    maxFrames = 600,
    maxTranslationChangePerFrame = 60,
    maxRotationChangePerFrame = 90,
    ...options
  } = {},
) {
  maxFrames = Math.max(2, maxFrames);
  const frames = collectAnimationFrames(project, intermediateSteps);
  const sampledFrames =
    frames.length > maxFrames
      ? frames
          .filter(
            (_, index) =>
              index % Math.ceil(frames.length / maxFrames) === 0,
          )
          .slice(0, maxFrames)
      : frames;
  const endFrame = Math.round(project.durationSeconds * 30);
  if (!sampledFrames.includes(0)) sampledFrames.unshift(0);
  if (!sampledFrames.includes(endFrame)) {
    if (sampledFrames.length >= maxFrames) sampledFrames.pop();
    sampledFrames.push(endFrame);
  }
  const warningMap = new Map();
  for (const frame of sampledFrames) {
    const analysis = analyzeSceneQuality(project, frame, options);
    for (const warning of analysis.warnings) {
      const key = `${warning.code}:${warning.objectId}:${warning.relatedObjectId ?? warning.partId ?? ''}`;
      const existing = warningMap.get(key);
      if (existing) existing.frames.push(frame);
      else warningMap.set(key, { ...warning, frames: [frame] });
    }
  }
  for (const object of project.objects) {
    const targets = [
      { id: object.id, keyframes: object.keyframes },
      ...(object.parts ?? []),
      ...(object.components ?? []),
    ];
    for (const target of targets) {
      for (const [property, keys] of Object.entries(target.keyframes ?? {})) {
        for (let index = 1; index < keys.length; index += 1) {
          const previous = keys[index - 1];
          const current = keys[index];
          const deltaPerFrame = Math.abs(current.value - previous.value) /
            Math.max(1, current.frame - previous.frame);
          const threshold =
            property === 'x' || property === 'y'
              ? maxTranslationChangePerFrame
              : property === 'rotation'
                ? maxRotationChangePerFrame
                : Infinity;
          if (deltaPerFrame > threshold) {
            const key = `abrupt_transform:${target.id}:${property}`;
            const existing = warningMap.get(key);
            if (existing) existing.frames.push(current.frame);
            else {
              warningMap.set(key, {
                code: 'abrupt_transform_change',
                objectId: object.id,
                targetId: target.id,
                property,
                frames: [current.frame],
                message: `"${target.id}" changes ${property} by ${deltaPerFrame.toFixed(1)} units per frame near frame ${current.frame}.`,
              });
            }
          }
        }
      }
    }
  }
  const warnings = [...warningMap.values()];
  return {
    valid: warnings.length === 0,
    framesAnalyzed: sampledFrames,
    warningCount: warnings.length,
    warnings,
  };
}
