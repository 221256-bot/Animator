import { evaluateObjectAtFrame } from './animation.js';

function rotatePoint(x, y, rotation) {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function evaluateLocalTargets(object, frame) {
  const evaluated = { ...evaluateObjectAtFrame(object, frame) };
  if (object.type === 'character') {
    evaluated.parts = object.parts.map((part) =>
      evaluateObjectAtFrame(part, frame),
    );
  }
  if (object.type === 'assembly') {
    evaluated.components = object.components.map((component) =>
      evaluateObjectAtFrame(component, frame),
    );
  }
  return evaluated;
}

export function evaluateProjectAtFrame(project, frame) {
  const objects = project.objects.map((object) =>
    evaluateLocalTargets(object, frame),
  );
  const objectsById = new Map(objects.map((object) => [object.id, object]));
  const evaluated = new Map();
  const active = new Set();

  function resolve(objectId) {
    if (evaluated.has(objectId)) return evaluated.get(objectId);
    if (active.has(objectId)) {
      throw new Error('Attachment graph contains a cycle.');
    }
    active.add(objectId);
    const object = objectsById.get(objectId);
    if (!object) {
      throw new Error(`Attachment parent "${objectId}" does not exist.`);
    }
    let world = object;
    if (object.attachment) {
      const parent = resolve(object.attachment.parentId);
      const anchor = parent.anchors?.find(
        (candidate) => candidate.id === object.attachment.anchorId,
      );
      if (!anchor) {
        throw new Error(
          `Anchor "${object.attachment.anchorId}" does not exist on "${parent.id}".`,
        );
      }
      const parentScaleX = parent.scaleX ?? 1;
      const parentScaleY = parent.scaleY ?? 1;
      const anchorOffset = rotatePoint(
        anchor.x * parentScaleX,
        anchor.y * parentScaleY,
        parent.rotation ?? 0,
      );
      const relativeOffset = rotatePoint(
        object.x * parentScaleX,
        object.y * parentScaleY,
        (parent.rotation ?? 0) + (anchor.rotation ?? 0),
      );
      world = {
        ...object,
        x: parent.x + anchorOffset.x + relativeOffset.x,
        y: parent.y + anchorOffset.y + relativeOffset.y,
        rotation:
          (parent.rotation ?? 0) +
          (anchor.rotation ?? 0) +
          (object.rotation ?? 0),
        scaleX: (parent.scaleX ?? 1) * (object.scaleX ?? 1),
        scaleY: (parent.scaleY ?? 1) * (object.scaleY ?? 1),
        opacity: (parent.opacity ?? 1) * (object.opacity ?? 1),
      };
    }
    active.delete(objectId);
    evaluated.set(objectId, world);
    return world;
  }

  return objects.map((object) => resolve(object.id));
}

export function worldPointToAttachmentOffset(parent, anchor, point) {
  const anchorOffset = rotatePoint(
    anchor.x * (parent.scaleX ?? 1),
    anchor.y * (parent.scaleY ?? 1),
    parent.rotation ?? 0,
  );
  const delta = {
    x: point.x - parent.x - anchorOffset.x,
    y: point.y - parent.y - anchorOffset.y,
  };
  const parentLocal = rotatePoint(delta.x, delta.y, -(parent.rotation ?? 0));
  const anchorLocal = rotatePoint(
    parentLocal.x,
    parentLocal.y,
    -(anchor.rotation ?? 0),
  );
  return {
    x: anchorLocal.x / (parent.scaleX ?? 1),
    y: anchorLocal.y / (parent.scaleY ?? 1),
  };
}
