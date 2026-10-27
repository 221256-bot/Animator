import { executeAnimationTool, ANIMATION_TOOL_SCHEMAS } from './animationTools.js';
import { parseProject } from './project.js';

const MAX_PLAN_OPERATIONS = 50;

export function validateAnimationPlanShape(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('The generated plan must be an object.');
  }
  if (
    Object.keys(plan).some(
      (key) =>
        !['summary', 'unsupportedCapabilities', 'operations'].includes(key),
    )
  ) {
    throw new Error('The generated plan contains unsupported fields.');
  }
  if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
    throw new Error('The generated plan is missing a summary.');
  }
  if (!Array.isArray(plan.unsupportedCapabilities)) {
    throw new Error('The generated plan must list unsupported capabilities.');
  }
  if (
    plan.unsupportedCapabilities.some(
      (capability) =>
        typeof capability !== 'string' || !capability.trim(),
    )
  ) {
    throw new Error('Unsupported capabilities must be non-empty descriptions.');
  }
  if (
    !Array.isArray(plan.operations) ||
    plan.operations.length > MAX_PLAN_OPERATIONS
  ) {
    throw new Error(
      `The generated plan must contain no more than ${MAX_PLAN_OPERATIONS} operations.`,
    );
  }

  for (const [index, operation] of plan.operations.entries()) {
    if (
      !operation ||
      typeof operation !== 'object' ||
      Array.isArray(operation) ||
      Object.keys(operation).some(
        (key) => !['tool', 'args', 'dependsOn'].includes(key),
      )
    ) {
      throw new Error(`Operation ${index + 1} has an invalid structure.`);
    }
    if (
      typeof operation.tool !== 'string' ||
      !Object.hasOwn(ANIMATION_TOOL_SCHEMAS, operation.tool)
    ) {
      throw new Error(
        `Operation ${index + 1} uses unsupported tool "${operation.tool}".`,
      );
    }
    if (
      !operation.args ||
      typeof operation.args !== 'object' ||
      Array.isArray(operation.args)
    ) {
      throw new Error(`Operation ${index + 1} arguments must be an object.`);
    }
    if (operation.dependsOn !== undefined) {
      if (
        !Array.isArray(operation.dependsOn) ||
        operation.dependsOn.some(
          (dependency) =>
            !Number.isInteger(dependency) ||
            dependency < 0 ||
            dependency >= index,
        ) ||
        new Set(operation.dependsOn).size !== operation.dependsOn.length
      ) {
        throw new Error(
          `Operation ${index + 1} dependencies must be unique earlier operation indices.`,
        );
      }
    }
  }
  return plan;
}

function collectProjectResourceIds(project) {
  const ids = new Set();
  for (const object of project.objects) {
    ids.add(object.id);
    for (const part of object.parts ?? []) ids.add(part.id);
    for (const component of object.components ?? []) ids.add(component.id);
  }
  for (const asset of project.assets ?? []) ids.add(asset.id);
  return ids;
}

function getReferencedResourceIds(operation) {
  const args = operation.args;
  switch (operation.tool) {
    case 'define_anchor':
    case 'inspect_anchors':
    case 'detach_object':
    case 'ungroup_assembly':
    case 'delete_object':
    case 'reorder_layer':
      return [args.objectId ?? args.assemblyId];
    case 'attach_object':
      return [args.objectId, args.parentId];
    case 'set_component_property':
    case 'set_component_parent':
      return [args.assemblyId, args.componentId, args.parentId].filter(Boolean);
    case 'group_objects':
      return args.objectIds;
    case 'duplicate_object':
      return [args.objectId];
    case 'apply_character_action':
    case 'apply_character_sequence':
    case 'apply_character_pose':
    case 'set_character_transform':
      return [args.characterId];
    case 'set_object_property':
      return [args.objectId];
    case 'set_keyframe':
      return [args.objectId, args.partId, args.componentId].filter(Boolean);
    default:
      return [];
  }
}

function collectDependencyAncestors(plan, operation) {
  const ancestors = new Set();
  const pending = [...(operation.dependsOn ?? [])];
  while (pending.length) {
    const dependency = pending.pop();
    if (ancestors.has(dependency)) continue;
    ancestors.add(dependency);
    pending.push(...(plan.operations[dependency].dependsOn ?? []));
  }
  return ancestors;
}

export async function executeAnimationPlan(
  projectInput,
  planInput,
  { signal, onProgress, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {},
) {
  const plan = structuredClone(validateAnimationPlanShape(planInput));
  let workingProject = parseProject(JSON.stringify(projectInput));
  const results = [];
  let previousResourceIds = collectProjectResourceIds(workingProject);
  const creatorsByResourceId = new Map();

  for (const [index, operation] of plan.operations.entries()) {
    if (signal?.aborted) {
      throw new Error('Animation generation was cancelled.');
    }
    const dependencyAncestors = collectDependencyAncestors(plan, operation);
    for (const resourceId of getReferencedResourceIds(operation)) {
      const creatorIndex = creatorsByResourceId.get(resourceId);
      if (creatorIndex !== undefined && !dependencyAncestors.has(creatorIndex)) {
        operation.dependsOn = [
          ...new Set([...(operation.dependsOn ?? []), creatorIndex]),
        ].sort((first, second) => first - second);
      }
    }
    onProgress?.({ completed: index, total: plan.operations.length });
    await yieldControl();
    if (signal?.aborted) {
      throw new Error('Animation generation was cancelled.');
    }

    const execution = executeAnimationTool(
      workingProject,
      operation.tool,
      operation.args,
    );
    if (!execution.ok) {
      throw new Error(
        `Operation ${index + 1} (${operation.tool}) failed: ${execution.error.message} Arguments: ${JSON.stringify(operation.args)}`,
      );
    }
    workingProject = execution.project;
    const currentResourceIds = collectProjectResourceIds(workingProject);
    for (const resourceId of currentResourceIds) {
      if (!previousResourceIds.has(resourceId)) {
        creatorsByResourceId.set(resourceId, index);
      }
    }
    previousResourceIds = currentResourceIds;
    results.push({ tool: operation.tool, result: execution.result });
    onProgress?.({ completed: index + 1, total: plan.operations.length });
  }

  if (signal?.aborted) {
    throw new Error('Animation generation was cancelled.');
  }
  return {
    project: workingProject,
    results,
    plan,
    summary: plan.summary,
    unsupportedCapabilities: plan.unsupportedCapabilities,
  };
}
