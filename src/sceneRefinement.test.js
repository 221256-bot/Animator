import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject } from './project.js';
import {
  createSceneRepairPrompt,
  MAX_SCENE_REFINEMENT_ATTEMPTS,
  validateSceneRepairProposal,
} from './sceneRefinement.js';
import { analyzeSceneQuality } from './sceneQuality.js';

function repairPlan(operations) {
  return {
    summary: 'Move the object back inside the stage.',
    unsupportedCapabilities: [],
    operations,
  };
}

function outsideStageProject() {
  return createProject(
    [
      {
        id: 'box',
        type: 'rectangle',
        x: 1270,
        y: 50,
        width: 30,
        height: 30,
        fill: '#ff0000',
      },
    ],
    'Repair test',
  );
}

test('repair proposal validates on a copy and reports before/after quality', async () => {
  const original = outsideStageProject();
  const before = structuredClone(original);
  const warnings = analyzeSceneQuality(original).warnings;
  const repair = await validateSceneRepairProposal(
    original,
    repairPlan([
      {
        tool: 'set_object_property',
        args: { objectId: 'box', property: 'x', value: 1200 },
      },
      { tool: 'analyze_scene_quality', args: { timeline: true } },
      { tool: 'validate_project', args: {} },
    ]),
  );

  assert.equal(repair.quality.warningCount, 0);
  assert.equal(repair.project.objects[0].x, 1200);
  assert.equal(original.objects[0].x, 1270);
  assert.deepEqual(original, before);
  assert.match(createSceneRepairPrompt(warnings), /Warnings:/);
});

test('repair proposal is not marked as improved when warnings remain unchanged', async () => {
  const original = outsideStageProject();
  const repair = await validateSceneRepairProposal(
    original,
    repairPlan([
      { tool: 'analyze_scene_quality', args: { timeline: true } },
      { tool: 'validate_project', args: {} },
    ]),
  );

  assert.equal(repair.quality.warningCount, 1);
  assert.equal(repair.qualityImproved, false);
  assert.deepEqual(repair.qualityChange, {
    resolvedWarningCount: 0,
    introducedWarningCount: 0,
  });
  assert.equal(original.objects[0].x, 1270);
});

test('invalid repair operations roll back and refinement attempts are capped', async () => {
  const original = outsideStageProject();
  const before = structuredClone(original);
  await assert.rejects(
    validateSceneRepairProposal(
      original,
      repairPlan([
        {
          tool: 'set_object_property',
          args: { objectId: 'box', property: 'fill', value: 'not-a-color' },
        },
      ]),
    ),
    /Operation 1 .*valid six-digit hex/i,
  );
  await assert.rejects(
    validateSceneRepairProposal(original, repairPlan([]), { attempt: 2 }),
    /limited to 1 refinement attempt/i,
  );

  assert.equal(MAX_SCENE_REFINEMENT_ATTEMPTS, 1);
  assert.deepEqual(original, before);
});
