import { executeAnimationPlan } from './aiGeneration.js';
import { analyzeSceneTimelineQuality } from './sceneQuality.js';

export const MAX_SCENE_REFINEMENT_ATTEMPTS = 1;

export function createSceneRepairPrompt(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    throw new Error('Scene repair requires at least one quality warning.');
  }
  const actionableWarnings = warnings.slice(0, 8).map((warning) => ({
    code: warning.code,
    objectId: warning.objectId,
    relatedObjectId: warning.relatedObjectId,
    componentId: warning.componentId,
    partId: warning.partId,
    message: warning.message?.slice(0, 240),
  }));
  return [
    'Propose one small, editable repair plan for the current project.',
    'Address only the listed geometry or declared layer issues. Preserve unrelated objects and existing animation.',
    'Use only supported tools. Do not invent semantic facts, delete objects, or claim that a warning is resolved unless the proposed operations do so.',
    'Include validate_project and analyze_scene_quality with timeline:true as final validation operations.',
    `Warnings: ${JSON.stringify(actionableWarnings)}`,
    ...(warnings.length > actionableWarnings.length
      ? [`Only the first ${actionableWarnings.length} of ${warnings.length} warnings are included; avoid broad changes.`]
      : []),
  ].join('\n');
}

function getWarningKey(warning) {
  return [
    warning.code,
    warning.objectId,
    warning.relatedObjectId ?? warning.partId ?? warning.componentId ?? '',
  ].join(':');
}

export async function validateSceneRepairProposal(
  project,
  plan,
  { attempt = 1, signal, yieldControl } = {},
) {
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > MAX_SCENE_REFINEMENT_ATTEMPTS
  ) {
    throw new Error(
      `Scene repair is limited to ${MAX_SCENE_REFINEMENT_ATTEMPTS} refinement attempt.`,
    );
  }
  const originalProject = structuredClone(project);
  const execution = await executeAnimationPlan(project, plan, {
    signal,
    yieldControl,
  });
  const quality = analyzeSceneTimelineQuality(execution.project);
  const originalWarningKeys = new Set(
    analyzeSceneTimelineQuality(originalProject).warnings.map(getWarningKey),
  );
  const repairedWarningKeys = new Set(quality.warnings.map(getWarningKey));
  const resolvedWarningCount = [...originalWarningKeys].filter(
    (key) => !repairedWarningKeys.has(key),
  ).length;
  const introducedWarningCount = [...repairedWarningKeys].filter(
    (key) => !originalWarningKeys.has(key),
  ).length;
  return {
    project: execution.project,
    quality,
    qualityImproved: resolvedWarningCount > 0 && introducedWarningCount === 0,
    qualityChange: { resolvedWarningCount, introducedWarningCount },
    summary: execution.summary,
    unsupportedCapabilities: execution.unsupportedCapabilities,
    results: execution.results,
    originalProject,
    attempt,
    attemptLimit: MAX_SCENE_REFINEMENT_ATTEMPTS,
  };
}
