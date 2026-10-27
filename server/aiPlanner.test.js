import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAnimationPlan } from './aiPlanner.js';
import { createProject } from '../src/project.js';
import { createObjectFromTemplate } from '../src/objectTemplates.js';

const project = createProject([], 'Planner test');

function completion(content) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
  };
}

test('planner requests structured output with server-only credentials and capability context', async () => {
  let captured;
  const result = await generateAnimationPlan(
    { prompt: 'Make a bicycle animation', project },
    {
      apiKey: 'server-test-secret',
      model: 'test-model',
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return completion({
          summary: 'A character can walk.',
          unsupportedCapabilities: ['Bicycle objects and wheel rotation are unavailable.'],
          operations: [],
        });

      },
    },
  );

  const request = JSON.parse(captured.options.body);
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(
    captured.options.headers.Authorization,
    'Bearer server-test-secret',
  );
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.match(request.messages[0].content, /apply_character_sequence/);
  assert.match(request.messages[0].content, /attach_object/);
  assert.match(
    request.messages[0].content,
    /wheel travel is not automatically coupled/i,
  );
  assert.match(request.messages[0].content, /automatically adds direct dependsOn edges/i);
  assert.match(request.messages[0].content, /apply_character_pose/);
  assert.match(request.messages[0].content, /sitting.*riding/);
  assert.match(request.messages[0].content, /analyze_scene_quality/);
  assert.match(request.messages[0].content, /timeline:true/);
  assert.match(request.messages[0].content, /supported refinements/i);
  assert.match(request.messages[0].content, /bicycle/i);
  assert.match(request.messages[1].content, /Make a bicycle animation/);
  assert.match(request.messages[1].content, /stage.*1280.*720/i);
  assert.deepEqual(result.unsupportedCapabilities, [
    'Bicycle objects and wheel rotation are unavailable.',
  ]);
});

test('planner receives imported artwork metadata and the image placement tool', async () => {
  const artworkProject = createProject([], 'Planner artwork test', 10, [
    {
      id: 'asset-cloud',
      name: 'cloud.svg',
      mimeType: 'image/svg+xml',
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"/>',
      ).toString('base64')}`,
      width: 120,
      height: 60,
    },
  ]);
  let messages;
  await generateAnimationPlan(
    { prompt: 'Place the cloud artwork.', project: artworkProject },
    {
      apiKey: 'test-key',
      fetchImpl: async (_url, options) => {
        messages = JSON.parse(options.body).messages;
        return completion({
          summary: 'Place the imported cloud asset.',
          unsupportedCapabilities: [],
          operations: [],
        });
      },
    },
  );

  assert.match(messages[0].content, /add_image_object/);
  assert.match(messages[1].content, /asset-cloud/);
  assert.match(messages[1].content, /cloud\.svg/);
  assert.doesNotMatch(messages[1].content, /data:image/);
});

test('planner receives editable template geometry and accurate pose capabilities', async () => {
  const tree = createObjectFromTemplate('tree', 'tree-1', 100, 500);
  let messages;
  await generateAnimationPlan(
    {
      prompt: 'Place the tree and have the character wave.',
      project: createProject([tree], 'Planner geometry test'),
    },
    {
      apiKey: 'test-key',
      fetchImpl: async (_url, options) => {
        messages = JSON.parse(options.body).messages;
        return completion({
          summary: 'A supported wave plan.',
          unsupportedCapabilities: [],
          operations: [],
        });
      },
    },
  );

  const currentProject = JSON.parse(messages[1].content).currentProject;
  const trunk = currentProject.objects[0].components.find((part) =>
    part.id.endsWith('_trunk'),
  );
  assert.equal(trunk.x, 0);
  assert.equal(trunk.y, 42);
  assert.equal(trunk.width, 28);
  assert.equal(trunk.height, 100);
  assert.match(messages[0].content, /waving pose is supported/i);
  assert.match(messages[0].content, /missing requested scenery/i);
});

test('planner returns validated plans with inferred dependency edges', async () => {
  const result = await generateAnimationPlan(
    { prompt: 'Add a boy and make him wave.', project },
    {
      apiKey: 'test-key',
      fetchImpl: async () =>
        completion({
          summary: 'Add a character and make him wave.',
          unsupportedCapabilities: [],
          operations: [
            {
              tool: 'add_character',
              args: { id: 'boy_1', x: 400, y: 300, name: 'Boy' },
            },
            {
              tool: 'apply_character_action',
              args: {
                characterId: 'boy_1',
                action: 'wave',
                startFrame: 0,
                durationFrames: 30,
              },
            },
          ],
        }),
    },
  );

  assert.deepEqual(result.operations[1].dependsOn, [0]);
});

test('planner reports missing credentials without calling the provider', async () => {
  let called = false;
  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Wave', project },
      {
        apiKey: '',
        fetchImpl: async () => {
          called = true;
        },
      },
    ),
    /set OPENAI_API_KEY/i,
  );
  assert.equal(called, false);
});

test('planner uses OpenRouter endpoint and model when configured', async () => {
  let captured;
  await generateAnimationPlan(
    { prompt: 'Make a scene', project },
    {
      provider: 'openrouter',
      apiKey: 'test-openrouter-key',
      model: 'openai/gpt-4o-mini',
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return completion({
          summary: 'A valid test plan.',
          unsupportedCapabilities: [],
          operations: [],
        });
      },
    },
  );

  assert.equal(
    captured.url,
    'https://openrouter.ai/api/v1/chat/completions',
  );
  assert.equal(captured.options.headers['X-Title'], 'Animator 2D Scene Editor');
  assert.equal(
    JSON.parse(captured.options.body).model,
    'openai/gpt-4o-mini',
  );
});

test('planner honors the configured provider and reports its missing key', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_PROVIDER = 'openrouter';
  try {
    await assert.rejects(
      generateAnimationPlan({ prompt: 'Make a scene', project }),
      /set OPENROUTER_API_KEY/i,
    );
  } finally {
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalProvider;
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});

test('planner rejects malformed JSON and unknown tool calls', async () => {
  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Wave', project },
      {
        apiKey: 'test-key',
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{broken json' } }],
          }),
        }),
      },
    ),
    /malformed plan json/i,
  );
  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Wave', project },
      {
        apiKey: 'test-key',
        fetchImpl: async () =>
          completion({
            summary: 'Unsupported',
            unsupportedCapabilities: [],
            operations: [{ tool: 'execute_script', args: { script: 'x' } }],
          }),
      },
    ),
    /unsupported tool/i,
  );
  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Make a character transparent', project },
      {
        apiKey: 'test-key',
        fetchImpl: async () =>
          completion({
            summary: 'Invalid transform',
            unsupportedCapabilities: [],
            operations: [
              {
                tool: 'set_character_transform',
                args: {
                  characterId: 'missing-character',
                  properties: { opacity: 2 },
                },
              },
            ],
          }),
      },
    ),
    /Operation 1 .* no scene object/i,
  );
});

test('planner converts provider failures into explicit errors', async () => {
  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Wave', project },
      {
        apiKey: 'test-key',
        fetchImpl: async () => ({ ok: false, status: 429 }),
      },
    ),
    /HTTP 429/i,
  );

  await assert.rejects(
    generateAnimationPlan(
      { prompt: 'Wave', project },
      {
        provider: 'openrouter',
        apiKey: 'revoked-test-key',
        fetchImpl: async () => ({ ok: false, status: 401 }),
      },
    ),
    /OpenRouter rejected the API key \(HTTP 401\).*OPENROUTER_API_KEY/i,
  );
});
