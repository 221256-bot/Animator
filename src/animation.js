export const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'opacity',
];
export const EASING_TYPES = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

export function applyEasing(progress, easing = 'linear') {
  const normalizedProgress = Math.max(0, Math.min(progress, 1));
  if (easing === 'ease-in') return normalizedProgress ** 2;
  if (easing === 'ease-out') {
    return 1 - (1 - normalizedProgress) ** 2;
  }
  if (easing === 'ease-in-out') {
    return 3 * normalizedProgress ** 2 - 2 * normalizedProgress ** 3;
  }
  return normalizedProgress;
}

export function addOrUpdateKeyframe(
  object,
  property,
  frame,
  value,
  easing,
) {
  if (!ANIMATABLE_PROPERTIES.includes(property)) {
    throw new Error(`Unsupported animated property "${property}".`);
  }
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error('Keyframe frame must be a non-negative integer.');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Keyframe value must be a finite number.');
  }
  if (easing !== undefined && !EASING_TYPES.includes(easing)) {
    throw new Error(`Unsupported easing type "${easing}".`);
  }

  const propertyKeyframes = object.keyframes?.[property] ?? [];
  const existingIndex = propertyKeyframes.findIndex(
    (keyframe) => keyframe.frame === frame,
  );
  const nextKeyframes = [...propertyKeyframes];
  const keyframe = {
    ...(nextKeyframes[existingIndex] ?? {}),
    frame,
    value,
    ...(easing === undefined ? {} : { easing }),
  };

  if (existingIndex >= 0) {
    nextKeyframes[existingIndex] = keyframe;
  } else {
    nextKeyframes.push(keyframe);
    nextKeyframes.sort((first, second) => first.frame - second.frame);
  }

  return {
    ...object,
    keyframes: {
      ...object.keyframes,
      [property]: nextKeyframes,
    },
  };
}

export function removeKeyframe(object, property, frame) {
  const propertyKeyframes = object.keyframes?.[property];
  if (!propertyKeyframes) return object;

  const nextKeyframes = propertyKeyframes.filter(
    (keyframe) => keyframe.frame !== frame,
  );
  if (nextKeyframes.length === propertyKeyframes.length) return object;

  const keyframes = { ...object.keyframes };
  if (nextKeyframes.length) keyframes[property] = nextKeyframes;
  else delete keyframes[property];

  return {
    ...object,
    keyframes,
  };
}

export function updateKeyframeEasing(object, property, frame, easing) {
  if (!EASING_TYPES.includes(easing)) {
    throw new Error(`Unsupported easing type "${easing}".`);
  }

  const propertyKeyframes = object.keyframes?.[property];
  if (!propertyKeyframes) return object;

  return {
    ...object,
    keyframes: {
      ...object.keyframes,
      [property]: propertyKeyframes.map((keyframe) =>
        keyframe.frame === frame ? { ...keyframe, easing } : keyframe,
      ),
    },
  };
}

export function moveKeyframe(object, property, fromFrame, toFrame) {
  if (!ANIMATABLE_PROPERTIES.includes(property)) {
    throw new Error(`Unsupported animated property "${property}".`);
  }
  if (!Number.isInteger(fromFrame) || fromFrame < 0) {
    throw new Error('Source frame must be a non-negative integer.');
  }
  if (!Number.isInteger(toFrame) || toFrame < 0) {
    throw new Error('Destination frame must be a non-negative integer.');
  }

  const propertyKeyframes = object.keyframes?.[property] ?? [];
  const source = propertyKeyframes.find(
    (keyframe) => keyframe.frame === fromFrame,
  );
  if (!source || fromFrame === toFrame) return object;
  if (propertyKeyframes.some((keyframe) => keyframe.frame === toFrame)) {
    return object;
  }

  const nextKeyframes = propertyKeyframes
    .map((keyframe) =>
      keyframe.frame === fromFrame
        ? { ...keyframe, frame: toFrame }
        : keyframe,
    )
    .sort((first, second) => first.frame - second.frame);

  return {
    ...object,
    keyframes: {
      ...object.keyframes,
      [property]: nextKeyframes,
    },
  };
}

export function evaluateProperty(baseValue, keyframes = [], frame = 0) {
  if (keyframes.length === 0) return baseValue;

  const value = interpolateValue(keyframes, frame);
  return value === undefined ? baseValue : value;
}

export function interpolateValue(keyframes, frame) {
  if (!keyframes?.length) return undefined;

  const sorted = [...keyframes].sort(
    (first, second) => first.frame - second.frame,
  );

  if (frame <= sorted[0].frame) {
    return sorted[0].value;
  }

  const last = sorted[sorted.length - 1];
  if (frame >= last.frame) {
    return last.value;
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const first = sorted[index];
    const second = sorted[index + 1];

    if (frame < first.frame || frame > second.frame) continue;
    if (frame === second.frame) return second.value;

    const frameSpan = second.frame - first.frame;
    if (frameSpan <= 0) return second.value;

    const progress = (frame - first.frame) / frameSpan;
    const easedProgress = applyEasing(progress, first.easing);
    return first.value + (second.value - first.value) * easedProgress;
  }

  return undefined;
}

export function evaluateObjectAtFrame(object, frame) {
  if (!object.keyframes) return object;

  const evaluatedObject = { ...object };
  for (const property of ANIMATABLE_PROPERTIES) {
    const keyframes = object.keyframes[property];
    if (keyframes?.length) {
      evaluatedObject[property] = evaluateProperty(
        object[property] ?? 1,
        keyframes,
        frame,
      );
    }
  }

  return evaluatedObject;
}
