import {
  addOrUpdateKeyframe,
  evaluateProperty,
  interpolateValue,
} from './animation.js';

export const CHARACTER_ACTIONS = ['idle', 'wave', 'walk'];
export const CHARACTER_POSES = [
  'standing',
  'sitting',
  'walking',
  'waving',
  'riding',
];
const MAX_ACTION_FRAMES = 600 * 30;

const CHARACTER_POSE_ROTATIONS = {
  standing: {
    torso: 0,
    'left-upper-arm': 0,
    'left-lower-arm': 0,
    'left-hand': 0,
    'right-upper-arm': 0,
    'right-lower-arm': 0,
    'right-hand': 0,
    'left-upper-leg': 0,
    'left-lower-leg': 0,
    'left-foot': 0,
    'right-upper-leg': 0,
    'right-lower-leg': 0,
    'right-foot': 0,
  },
  sitting: {
    torso: 0,
    'left-upper-arm': -8,
    'left-lower-arm': 12,
    'left-hand': 0,
    'right-upper-arm': 8,
    'right-lower-arm': -12,
    'right-hand': 0,
    'left-upper-leg': -82,
    'left-lower-leg': 82,
    'left-foot': 0,
    'right-upper-leg': -82,
    'right-lower-leg': 82,
    'right-foot': 0,
  },
  walking: {
    torso: 0,
    'left-upper-arm': 18,
    'left-lower-arm': -8,
    'left-hand': 0,
    'right-upper-arm': -18,
    'right-lower-arm': 8,
    'right-hand': 0,
    'left-upper-leg': -24,
    'left-lower-leg': 12,
    'left-foot': 0,
    'right-upper-leg': 24,
    'right-lower-leg': -12,
    'right-foot': 0,
  },
  waving: {
    torso: 0,
    'left-upper-arm': 0,
    'left-lower-arm': 0,
    'left-hand': 0,
    'right-upper-arm': -95,
    'right-lower-arm': -50,
    'right-hand': 15,
    'left-upper-leg': 0,
    'left-lower-leg': 0,
    'left-foot': 0,
    'right-upper-leg': 0,
    'right-lower-leg': 0,
    'right-foot': 0,
  },
  riding: {
    torso: 8,
    'left-upper-arm': -28,
    'left-lower-arm': 42,
    'left-hand': 0,
    'right-upper-arm': -28,
    'right-lower-arm': 42,
    'right-hand': 0,
    'left-upper-leg': -58,
    'left-lower-leg': 58,
    'left-foot': 0,
    'right-upper-leg': -58,
    'right-lower-leg': 58,
    'right-foot': 0,
  },
};

export function registerCharacterPose(poseName, jointRotations) {
  if (
    typeof poseName !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(poseName) ||
    !jointRotations ||
    typeof jointRotations !== 'object' ||
    Array.isArray(jointRotations) ||
    Object.keys(jointRotations).length === 0 ||
    Object.entries(jointRotations).some(
      ([partName, rotation]) =>
        !/^[a-z][a-z0-9_-]{0,63}$/.test(partName) ||
        typeof rotation !== 'number' ||
        !Number.isFinite(rotation),
    )
  ) {
    throw new Error('Character poses require a valid ID and finite joint rotations.');
  }
  if (!CHARACTER_POSES.includes(poseName)) CHARACTER_POSES.push(poseName);
  CHARACTER_POSE_ROTATIONS[poseName] = { ...jointRotations };
}

const ACTION_PRESETS = {
  idle: {
    cycleFrames: 1,
    tracks: [
      { part: 'torso', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'torso', property: 'y', points: [[0, 0], [1, 0]] },
      { part: 'right-upper-arm', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'right-lower-arm', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'right-hand', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'left-upper-arm', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'left-lower-arm', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'left-hand', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'left-upper-leg', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'left-lower-leg', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'right-upper-leg', property: 'rotation', points: [[0, 0], [1, 0]] },
      { part: 'right-lower-leg', property: 'rotation', points: [[0, 0], [1, 0]] },
    ],
  },
  wave: {
    cycleFrames: 60,
    tracks: [
      {
        part: 'right-upper-arm',
        property: 'rotation',
        points: [[0, 0], [10, -95], [60, 0]],
      },
      {
        part: 'right-lower-arm',
        property: 'rotation',
        points: [[0, 0], [10, -50], [20, -82], [30, -48], [40, -82], [50, -50], [60, 0]],
      },
      {
        part: 'right-hand',
        property: 'rotation',
        points: [[0, 0], [10, 15], [20, -18], [30, 18], [40, -18], [50, 15], [60, 0]],
      },
    ],
  },
  walk: {
    cycleFrames: 30,
    tracks: [
      { part: 'torso', property: 'y', points: [[0, 0], [7, -4], [15, 0], [22, -4], [30, 0]] },
      { part: 'left-upper-leg', property: 'rotation', points: [[0, 0], [7, -24], [15, 0], [22, 24], [30, 0]] },
      { part: 'left-lower-leg', property: 'rotation', points: [[0, 0], [7, 12], [15, 0], [22, -12], [30, 0]] },
      { part: 'right-upper-leg', property: 'rotation', points: [[0, 0], [7, 24], [15, 0], [22, -24], [30, 0]] },
      { part: 'right-lower-leg', property: 'rotation', points: [[0, 0], [7, -12], [15, 0], [22, 12], [30, 0]] },
      { part: 'left-upper-arm', property: 'rotation', points: [[0, 0], [7, 18], [15, 0], [22, -18], [30, 0]] },
      { part: 'left-lower-arm', property: 'rotation', points: [[0, 0], [7, -8], [15, 0], [22, 8], [30, 0]] },
      { part: 'right-upper-arm', property: 'rotation', points: [[0, 0], [7, -18], [15, 0], [22, 18], [30, 0]] },
      { part: 'right-lower-arm', property: 'rotation', points: [[0, 0], [7, 8], [15, 0], [22, -8], [30, 0]] },
    ],
  },
};

function makeTrackFrames(points, durationFrames, loop, cycleFrames) {
  const pointsByFrame = new Map();
  const sample = (frame) => {
    const sourceFrame = loop
      ? frame % cycleFrames
      : (frame / durationFrames) * cycleFrames;
    const sourceKeyframes = points.map(([pointFrame, value]) => ({
      frame: pointFrame,
      value,
    }));
    return interpolateValue(sourceKeyframes, sourceFrame);
  };

  if (loop) {
    const cycleCount = Math.max(1, Math.round(durationFrames / cycleFrames));
    const cycleLength = durationFrames / cycleCount;
    for (let cycle = 0; cycle < cycleCount; cycle += 1) {
      const cycleStart = cycle * cycleLength;
      for (const [pointFrame, value] of points) {
        const frame = Math.round(
          cycleStart + (pointFrame / cycleFrames) * cycleLength,
        );
        if (frame <= durationFrames) pointsByFrame.set(frame, value);
      }
    }
  } else {
    for (const [pointFrame, value] of points) {
      const frame = Math.round((pointFrame / cycleFrames) * durationFrames);
      pointsByFrame.set(frame, value);
    }
  }

  if (loop) pointsByFrame.set(durationFrames, points[0][1]);
  else pointsByFrame.set(durationFrames, sample(durationFrames));
  return [...pointsByFrame.entries()]
    .sort(([firstFrame], [secondFrame]) => firstFrame - secondFrame)
    .map(([frame, offset]) => ({ frame, offset }));
}

export function createCharacterActionPlan(
  character,
  actionName,
  startFrame,
  durationFrames,
  loop = false,
) {
  if (!character || character.type !== 'character') {
    throw new Error('Select a character before applying an action.');
  }

  const preset = ACTION_PRESETS[actionName];
  if (!preset) throw new Error(`Unsupported character action "${actionName}".`);
  if (!Number.isInteger(startFrame) || startFrame < 0) {
    throw new Error('Action start frame must be a non-negative integer.');
  }
  if (
    !Number.isInteger(durationFrames) ||
    durationFrames < 1 ||
    durationFrames > MAX_ACTION_FRAMES
  ) {
    throw new Error(
      `Action duration must be between 1 and ${MAX_ACTION_FRAMES} frames.`,
    );
  }

  const partsByName = new Map(
    character.parts.map((part) => [
      part.id.startsWith(`${character.id}_`)
        ? part.id.slice(character.id.length + 1)
        : part.id,
      part,
    ]),
  );

  return preset.tracks.flatMap((track) => {
    const part = partsByName.get(track.part);
    if (!part) {
      throw new Error(`Character is missing required rig part "${track.part}".`);
    }
    const neutralValue = part[track.property] ?? 0;
    const baseValue = evaluateProperty(
      neutralValue,
      part.keyframes?.[track.property],
      startFrame,
    );
    const trackPoints =
      actionName === 'idle'
        ? [
            [0, 0],
            [1, neutralValue - baseValue],
          ]
        : track.points;
    const actionKeyframes = makeTrackFrames(
      trackPoints,
      durationFrames,
      loop && actionName !== 'idle',
      preset.cycleFrames,
    ).map(({ frame, offset }) => ({
      partId: part.id,
      property: track.property,
      frame: startFrame + frame,
      value: baseValue + offset,
      easing: 'linear',
    }));
    const hasPriorKeyframe = (part.keyframes?.[track.property] ?? []).some(
    (keyframe) => keyframe.frame <= startFrame,
    );
    if (startFrame > 0 && !hasPriorKeyframe) {
      actionKeyframes.unshift({
        partId: part.id,
        property: track.property,
        frame: 0,
        value: neutralValue,
        easing: 'linear',
        preRoll: true,
      });
    }
    return actionKeyframes;
  });
}

export function createCharacterPosePlan(
  character,
  poseName,
  startFrame,
  durationFrames = 1,
) {
  if (!character || character.type !== 'character') {
    throw new Error('Select a character before applying a pose.');
  }
  const pose = CHARACTER_POSE_ROTATIONS[poseName];
  if (!pose) throw new Error(`Unsupported character pose "${poseName}".`);
  if (
    !Number.isInteger(startFrame) ||
    startFrame < 0 ||
    !Number.isInteger(durationFrames) ||
    durationFrames < 1 ||
    durationFrames > MAX_ACTION_FRAMES
  ) {
    throw new Error('Pose start frame and duration must be valid frame values.');
  }
  const partsByName = new Map(
    character.parts.map((part) => [
      part.id.startsWith(`${character.id}_`)
        ? part.id.slice(character.id.length + 1)
        : part.id,
      part,
    ]),
  );
  return Object.entries(pose).flatMap(([partName, targetRotation]) => {
    const part = partsByName.get(partName);
    if (!part) {
      throw new Error(`Character is missing required rig part "${partName}".`);
    }
    const startRotation = evaluateProperty(
      part.rotation ?? 0,
      part.keyframes?.rotation,
      startFrame,
    );
    const frames = [
      { frame: startFrame, value: startRotation },
      { frame: startFrame + durationFrames, value: targetRotation },
    ];
    if (frames[0].frame === frames[1].frame) {
      return [{ partId: part.id, property: 'rotation', ...frames[1] }];
    }
    return frames.map((keyframe) => ({
      partId: part.id,
      property: 'rotation',
      ...keyframe,
    }));
  });
}

export function applyCharacterAction(
  character,
  plan,
  { replaceExisting = false, replaceFrames = [] } = {},
) {
  if (!character || character.type !== 'character' || !Array.isArray(plan)) {
    throw new Error('A character and a valid action keyframe plan are required.');
  }

  const plannedKeys = new Set(
    plan.map(({ partId, property, frame }) => `${partId}:${property}:${frame}`),
  );
  if (plannedKeys.size !== plan.length) {
    throw new Error('An action cannot generate duplicate keyframes.');
  }

  if (
    !Array.isArray(replaceFrames) ||
    replaceFrames.some((frame) => !Number.isInteger(frame) || frame < 0)
  ) {
    throw new Error('Action replacement frames must be non-negative integers.');
  }
  const replaceFrameSet = new Set(replaceFrames);
  const actionPlan = plan.filter((keyframe) => !keyframe.preRoll);
  const actionChannels = new Set(
    actionPlan.map(({ partId, property }) => `${partId}:${property}`),
  );
  const rangesByChannel = new Map();
  const valuesByChannel = new Map();
  for (const keyframe of actionPlan) {
    const key = `${keyframe.partId}:${keyframe.property}`;
    const range = rangesByChannel.get(key) ?? {
      start: keyframe.frame,
      end: keyframe.frame,
    };
    range.start = Math.min(range.start, keyframe.frame);
    range.end = Math.max(range.end, keyframe.frame);
    rangesByChannel.set(key, range);
    const values = valuesByChannel.get(key) ?? new Map();
    values.set(keyframe.frame, keyframe.value);
    valuesByChannel.set(key, values);
  }

  const collisions = [];
  let replacedCount = 0;
  const nextParts = character.parts.map((part) => {
    const channels = [...actionChannels].filter((key) =>
      key.startsWith(`${part.id}:`),
    );
    if (channels.length === 0) return part;

    let updatedPart = part;
    for (const channel of channels) {
      const property = channel.slice(part.id.length + 1);
      const range = rangesByChannel.get(channel);
      const generatedValues = valuesByChannel.get(channel);
      const existing = updatedPart.keyframes?.[property] ?? [];
      const overlapping = existing.filter(({ frame }) =>
        frame >= range.start && frame <= range.end,
      );
      const rejectedOverlaps = overlapping.filter(
        ({ frame, value }) =>
          !replaceExisting &&
          !replaceFrameSet.has(frame) &&
          !(frame === range.start && generatedValues.get(frame) === value),
      );
      collisions.push(...rejectedOverlaps.map((keyframe) => ({
          partId: part.id,
          property,
          frame: keyframe.frame,
        })));
      const framesToReplace = new Set([
        ...(replaceExisting
          ? overlapping.map(({ frame }) => frame)
          : overlapping
              .filter(
                ({ frame, value }) =>
                  replaceFrameSet.has(frame) ||
                  (frame === range.start &&
                    generatedValues.get(frame) === value),
              )
              .map(({ frame }) => frame)),
      ]);
      replacedCount += framesToReplace.size;
      if (framesToReplace.size) {
        const remainingKeyframes = existing.filter(
          ({ frame }) => !framesToReplace.has(frame),
        );
        const nextKeyframes = { ...updatedPart.keyframes };
        if (remainingKeyframes.length) {
          nextKeyframes[property] = remainingKeyframes;
        } else {
          delete nextKeyframes[property];
        }
        updatedPart = {
          ...updatedPart,
          keyframes: nextKeyframes,
        };
      }
    }
    return updatedPart;
  });

  if (collisions.length && !replaceExisting) {
    throw new Error(
      `Action overlaps ${collisions.length} existing joint keyframe${collisions.length === 1 ? '' : 's'}. Enable replacement to overwrite those frames.`,
    );
  }

  let updatedCharacter = { ...character, parts: nextParts };
  for (const keyframe of plan) {
    updatedCharacter = {
      ...updatedCharacter,
      parts: updatedCharacter.parts.map((part) =>
        part.id === keyframe.partId
          ? addOrUpdateKeyframe(
              part,
              keyframe.property,
              keyframe.frame,
              keyframe.value,
              keyframe.easing,
            )
          : part,
      ),
    };
  }

  return { character: updatedCharacter, replacedKeyframes: replacedCount };
}

export function createCharacterActionSequencePlan(
  character,
  actions,
  startFrame,
) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 100) {
    throw new Error('An action sequence must contain between 1 and 100 actions.');
  }
  if (!Number.isInteger(startFrame) || startFrame < 0) {
    throw new Error('Sequence start frame must be a non-negative integer.');
  }

  let cursor = startFrame;
  let workingCharacter = character;
  let replacedKeyframes = 0;
  let totalDurationFrames = 0;
  const steps = [];

  for (const [index, action] of actions.entries()) {
    if (!action || typeof action !== 'object') {
      throw new Error(`Sequence action ${index + 1} must be an object.`);
    }
    const durationFrames = action.durationFrames;
    if (!Number.isInteger(durationFrames) || durationFrames < 1) {
      throw new Error(
        `Sequence action ${index + 1} duration must be at least one frame.`,
      );
    }
    if (
      action.loop !== undefined &&
      typeof action.loop !== 'boolean'
    ) {
      throw new Error(`Sequence action ${index + 1} loop must be a boolean.`);
    }
    if (
      action.replaceExisting !== undefined &&
      typeof action.replaceExisting !== 'boolean'
    ) {
      throw new Error(
        `Sequence action ${index + 1} replaceExisting must be a boolean.`,
      );
    }
    totalDurationFrames += durationFrames;
    if (totalDurationFrames > MAX_ACTION_FRAMES) {
      throw new Error(
        `Action sequence duration must not exceed ${MAX_ACTION_FRAMES} frames.`,
      );
    }

    const actionStartFrame = cursor;
    const plan = createCharacterActionPlan(
      workingCharacter,
      action.action,
      actionStartFrame,
      durationFrames,
      action.loop ?? false,
    );
    const result = applyCharacterAction(workingCharacter, plan, {
      replaceExisting: action.replaceExisting ?? false,
      replaceFrames: index > 0 ? [actionStartFrame] : [],
    });
    workingCharacter = result.character;
    replacedKeyframes += result.replacedKeyframes;
    cursor += durationFrames;
    steps.push({
      action: action.action,
      startFrame: actionStartFrame,
      endFrame: cursor,
      durationFrames,
      loop: Boolean(action.loop),
      keyframeCount: plan.length,
    });
  }

  return {
    character: workingCharacter,
    startFrame,
    endFrame: cursor,
    steps,
    replacedKeyframes,
    keyframeCount: steps.reduce((count, step) => count + step.keyframeCount, 0),
  };
}
