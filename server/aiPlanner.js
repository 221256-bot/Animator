import { ANIMATION_TOOL_SCHEMAS } from '../src/animationTools.js';
import { parseProject } from '../src/project.js';
import {
  executeAnimationPlan,
  validateAnimationPlanShape,
} from '../src/aiGeneration.js';
import { getObjectTemplateRegistry } from '../src/objectTemplates.js';
import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../src/project.js';
import { CHARACTER_POSES } from '../src/characterActions.js';

const MAX_PROMPT_LENGTH = 4000;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_PLAN_CORRECTION_ATTEMPTS = 2;
const DEFAULT_MODEL = 'gpt-4o-mini';
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

const CAPABILITIES = {
  objects: [
    'rectangle',
    'circle',
    'text',
    'imported transparent PNG, WebP, and SVG image objects',
    'editable 17-part character',
    'editable primitive assemblies with component hierarchy',
  ],
  actions: ['idle', 'wave', 'walk'],
  characterPoses: CHARACTER_POSES,
  properties: [
    'x',
    'y',
    'rotation',
    'scaleX',
    'scaleY',
    'opacity',
    'component local position and rotation',
    'component dimensions and fill',
    'component-level rotation and synchronized root/component keyframes',
    'named local-space anchors and persistent object attachments',
  ],
  limitations: [
    'Assemblies contain editable primitive parts; they are not specialized rigs',
    'Wheel and crank rotations can be keyed, but wheel travel is not automatically coupled to distance',
    'Character leg animation is not automatically coupled to bicycle pedals',
    'No camera or viewport animation; composition uses object positions and layer order',
    'AI cannot synthesize or import artwork; it can place only assets already in the project asset library',
    'No video generation',
  ],
};

function createSystemPrompt() {
  const capabilities = {
    ...CAPABILITIES,
    stage: { width: PROJECT_WIDTH, height: PROJECT_HEIGHT },
    templates: getObjectTemplateRegistry(),
  };
  return [
    'Create an animation plan as JSON. Do not execute code or invent tools.',
    'Use only the listed tool names and their exact schemas.',
    'Every fill value must be a six-digit hexadecimal color in the exact form #RRGGBB (for example #3f9b62); named colors and short hex are invalid.',
    'Return exactly { "summary": string, "unsupportedCapabilities": string[], "operations": [{ "tool": string, "args": object }] }.',
    'Report every requested capability that is not explicitly listed as unsupported; do not imply it was created.',
    'Only plan supported work that is a faithful, useful part of the request. Never substitute a different object or action without clearly explaining the limitation.',
    'Preserve existing scene objects. Use the provided object IDs. New IDs must contain only letters, digits, underscores, or hyphens and be unique.',
    'Treat each specifically requested scene object as required: create one instance for every requested item and do not substitute or omit a named object. If a requested object has a registered template, use create_template with that template ID; in particular, a requested bicycle MUST use the bicycle template, which already includes the frame, wheels, spokes, seat, handlebar, and pedals. Use custom assemblies only for designs without a suitable template.',
    'Before returning JSON, audit every requested object, quantity, relationship, and time interval against the operations. Missing requested scenery is not an acceptable simplification: create each named item, including repeated decorative elements, as editable primitives or assemblies. If the request names flower clusters, build visibly recognizable clusters from editable circles rather than omitting them or using isolated square marks.',
    'Render a requested scene title as a single-line text object with an explicit width large enough for the full text. Place titles clear of clouds and other foreground objects, not centered over an existing object.',
    'Coordinate conventions: rectangle and text x/y are the upper-left corner; circle x/y and character/assembly x/y are their local origin; assembly component x/y are component center/pivot positions in parent-local coordinates. Keep each object’s full geometry inside the 1280x720 stage, including rotated custom-assembly components. Use background rectangles at x:0,y:0 with stage-bounded width and height, not centered at the stage dimensions.',
    'Template instance x/y is the assembly origin. Use the supplied template component geometry (including parent-relative coordinates and dimensions) to calculate full bounds before placing an instance; keep those bounds inside the stage and away from unrelated foreground objects.',
    'Frames are integers at 30 FPS and must stay within the scene duration. Use explicit validated operations.',
    'For actions, use apply_character_action or apply_character_sequence. For reusable joint-local postures, use apply_character_pose. For movement, use set_keyframe on supported properties.',
    'Use attach_object only when the parent has the named anchor; attachment offsets and attached-object root transforms are local to that anchor. Use define_anchor when a custom anchor is needed.',
    'Place artwork only by referencing an imported asset ID from the project asset library with add_image_object. Never fabricate image data, URLs, or asset IDs. Images remain independent editable scene objects.',
    'When layer intent is clear, set depthRole to background, midground, or foreground so the quality analyzer can check layer order. Substantial overlaps are warnings to review, not proof of an error.',
    'Template component IDs use the created object ID plus the listed suffix. Key component rotation at shared frames for coordinated motion; do not claim automatic physical coupling.',
    'To animate a template component, call set_keyframe with objectId equal to the assembly ID and componentId equal to the full component ID (for example objectId:"bike", componentId:"bike_rear_wheel"). Never use a component ID as objectId when setting componentId separately. Existing template anchors should be used as listed; do not redefine them unless they are absent or unsuitable.',
    'Component rotation keyframes are supported, including bicycle wheel rotation. State clearly that manual wheel rotation is synchronized by keyframes and is not physically coupled to travel distance.',
    'For scene construction, use add_object, create_template, or create_assembly. Create dependencies before operations that reference their IDs. The executor automatically adds direct dependsOn edges for references to resources created by earlier operations; you may include them explicitly.',
    'Decompose the request into environment, objects, relationships, transforms, animations, and validation. Build every referenced object and anchor before use. Do not reference an object or component before its creation step.',
    'If a duration is requested, set it before adding animation keyframes. Convert seconds to frames at 30 FPS, keep all keys and actions within duration, and use matching start/end frames for motions intended to run together. A manual wheel rotation can be synchronized in time with travel but is not physically coupled to distance.',
    'For timed movement with stationary holds, key the unchanged starting position at the beginning and end of the initial hold, key the travel endpoint at the travel end, and let that value hold afterward. Start any later character action at its requested time. For a 10-second request, frames 0, 60, 210, and 240 correspond to 0, 2, 7, and 8 seconds.',
    'For requested rightward travel, the final x keyframe value MUST be greater than the initial x value; for leftward travel it MUST be smaller. Do not key identical values across a requested travel segment. Use ease-in-out easing on the travel endpoint when smooth motion is requested.',
    'Apply a static reusable pose immediately at the beginning of its requested interval using a 1-frame pose transition, rather than spending the entire initial stationary interval transitioning into the pose.',
    'The waving pose is supported and is listed as "waving" in characterPoses; the looping "wave" action is also supported. Do not report either as unsupported. Use apply_character_action for a timed wave when requested; use apply_character_pose only for a static waving posture.',
    'Only claim actions and poses that exist in the capability registry. A riding pose is a keyed reusable posture, not physical pedaling or wheel coupling. No camera controls are available.',
    'Use a concise, coherent scene plan rather than adding unrelated filler objects. Finish with validate_relationships when using attachments, analyze_scene_quality with timeline:true to check geometry across animation, and validate_project for the completed project. Treat quality findings as actionable warnings: propose only small supported refinements, re-analyze, and disclose anything that remains.',
    'Prefer registered templates when they meet the request; use create_assembly only for genuinely custom editable designs, and give every component a valid #RRGGBB fill. Clearly disclose any parts or behavior that cannot be represented.',
    `Capabilities: ${JSON.stringify(capabilities)}`,
    `Available project tools and argument schemas: ${JSON.stringify(ANIMATION_TOOL_SCHEMAS)}`,
  ].join('\n');
}

function buildProjectContext(project) {
  return {
    stage: { width: project.width, height: project.height },
    durationSeconds: project.durationSeconds,
    assets: (project.assets ?? []).map((asset) => ({
      id: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
    })),
    objects: project.objects.map((object) => ({
      id: object.id,
      type: object.type,
      name: object.name ?? object.text ?? object.id,
      x: object.x,
      y: object.y,
      ...(object.type === 'character'
        ? {
            parts: object.parts.map((part) => ({
              id: part.id,
              parentId: part.parentId,
              shape: part.shape,
              x: part.x,
              y: part.y,
              rotation: part.rotation ?? 0,
              width: part.width,
              height: part.height,
              shapeOffsetX: part.shapeOffsetX ?? 0,
              shapeOffsetY: part.shapeOffsetY ?? 0,
              keyframes: part.keyframes ?? {},
            })),
          }
        : {}),
      ...(object.type === 'assembly'
        ? {
            components: object.components.map((component) => ({
              id: component.id,
              parentId: component.parentId,
              type: component.type,
              x: component.x,
              y: component.y,
              rotation: component.rotation ?? 0,
              ...(component.width === undefined
                ? {}
                : { width: component.width }),
              ...(component.height === undefined
                ? {}
                : { height: component.height }),
              ...(component.radius === undefined
                ? {}
                : { radius: component.radius }),
              keyframes: component.keyframes ?? {},
            })),
          }
        : {}),
      ...(object.width === undefined ? {} : { width: object.width }),
      ...(object.height === undefined ? {} : { height: object.height }),
      ...(object.radius === undefined ? {} : { radius: object.radius }),
      rotation: object.rotation ?? 0,
      depthRole: object.depthRole ?? null,
      keyframes: object.keyframes ?? {},
      anchors: object.anchors ?? [],
      attachment: object.attachment ?? null,
    })),
  };
}

function validatePromptRequirements(prompt, plan) {
  const operations = plan.operations;
  const unsupportedCapabilities = plan.unsupportedCapabilities.join(' ');
  if (
    /\battach(?:ed|ment)?\b/i.test(prompt) &&
    !operations.some((operation) => operation.tool === 'attach_object')
  ) {
    throw new Error(
      'The request requires an object attachment, but the plan has no attach_object operation. Defining an anchor is not a substitute for attaching the child object.',
    );
  }
  if (
    /\beditable title text object\b/i.test(prompt) &&
    !operations.some(
      (operation) =>
        operation.tool === 'add_object' &&
        operation.args.type === 'text' &&
        typeof operation.args.text === 'string' &&
        operation.args.text.trim(),
    )
  ) {
    throw new Error(
      'The request requires an editable title text object, but the plan does not create one.',
    );
  }
  if (/\beditable title text object\b/i.test(prompt)) {
    const title = operations.find(
      (operation) =>
        operation.tool === 'add_object' &&
        operation.args.type === 'text' &&
        typeof operation.args.text === 'string' &&
        operation.args.text.trim(),
    );
    if (
      !title ||
      !Number.isFinite(title.args.width) ||
      title.args.width < title.args.text.length * (title.args.fontSize ?? 24) * 0.5 ||
      title.args.x < 0 ||
      title.args.x + title.args.width > PROJECT_WIDTH
    ) {
      throw new Error(
        'The editable scene title needs an explicit single-line width that fits the stage.',
      );
    }
  }
  if (
    /\b(?:three|3)\s+(?:visibly recognizable\s+)?flower[- ]cluster assemblies\b/i.test(
      prompt,
    )
  ) {
    const flowerClusters = operations.filter(
      (operation) =>
        operation.tool === 'create_assembly' &&
        /flower|petal/i.test(
          `${operation.args.id} ${operation.args.name} ${operation.args.components
            .map((component) => component.id)
            .join(' ')}`,
        ),
    );
    if (flowerClusters.length < 3) {
      throw new Error(
        `The request requires three editable flower-cluster assemblies, but the plan creates ${flowerClusters.length}.`,
      );
    }
  }
  if (
    /\b(?:wave|waving)\b/i.test(unsupportedCapabilities) &&
    (CAPABILITIES.actions.includes('wave') ||
      CHARACTER_POSES.includes('waving'))
  ) {
    throw new Error(
      'The plan incorrectly reports waving as unsupported; the wave action and waving pose are available.',
    );
  }
}

export async function generateAnimationPlan(
  { prompt, project },
  {
    apiKey,
    model,
    provider,
    fetchImpl = fetch,
    signal: requestSignal,
  } = {},
) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Enter an animation description.');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`);
  }
  const configuredProvider =
    provider ?? process.env.LLM_PROVIDER?.trim().toLowerCase();
  const resolvedProvider =
    configuredProvider ||
    (process.env.OPENROUTER_API_KEY ? 'openrouter' : 'openai');
  if (!['openai', 'openrouter'].includes(resolvedProvider)) {
    throw new Error(`Unsupported LLM provider "${resolvedProvider}".`);
  }
  const resolvedApiKey =
    apiKey ??
    (resolvedProvider === 'openrouter'
      ? process.env.OPENROUTER_API_KEY
      : process.env.OPENAI_API_KEY);
  if (!resolvedApiKey) {
    const error = new Error(
      resolvedProvider === 'openrouter'
        ? 'AI generation is not configured. Set OPENROUTER_API_KEY on the server.'
        : 'AI generation is not configured. Set OPENAI_API_KEY on the server.',
    );
    error.statusCode = 503;
    throw error;
  }
  const resolvedModel =
    model ??
    (resolvedProvider === 'openrouter'
      ? process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL
      : process.env.OPENAI_MODEL || DEFAULT_MODEL);

  const normalizedProject = parseProject(JSON.stringify(project));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  const abortRequest = () => controller.abort();
  requestSignal?.addEventListener('abort', abortRequest, { once: true });
  if (requestSignal?.aborted) controller.abort();
  const messages = [
    { role: 'system', content: createSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        request: prompt.trim(),
        currentProject: buildProjectContext(normalizedProject),
      }),
    },
  ];
  try {
    for (let attempt = 0; attempt <= MAX_PLAN_CORRECTION_ATTEMPTS; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(
          resolvedProvider === 'openrouter'
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resolvedApiKey}`,
              'Content-Type': 'application/json',
              ...(resolvedProvider === 'openrouter'
                ? { 'X-Title': 'Animator 2D Scene Editor' }
                : {}),
            },
            body: JSON.stringify({
              model: resolvedModel,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages,
            }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) {
          const timeoutError = !requestSignal?.aborted;
          throw new Error(
            timeoutError
              ? 'The LLM request was cancelled or timed out.'
              : 'The LLM request was cancelled.',
          );
        }
        throw new Error('Unable to reach the configured LLM provider.');
      }

      if (!response.ok) {
        const message =
          response.status === 401 || response.status === 403
            ? `${resolvedProvider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} rejected the API key (HTTP ${response.status}). Verify ${resolvedProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY'} in the server environment and replace any revoked key.`
            : `The LLM provider returned HTTP ${response.status}.`;
        const error = new Error(message);
        error.statusCode = 502;
        throw error;
      }
      const completion = await response.json();
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('The LLM provider returned no structured plan.');
      }
      let plan;
      try {
        plan = JSON.parse(content);
      } catch {
        throw new Error('The LLM provider returned malformed plan JSON.');
      }
      try {
        validateAnimationPlanShape(plan);
        validatePromptRequirements(prompt, plan);
        const execution = await executeAnimationPlan(
          normalizedProject,
          plan,
          { signal: requestSignal },
        );
        return execution.plan;
      } catch (error) {
        if (
          attempt === MAX_PLAN_CORRECTION_ATTEMPTS ||
          requestSignal?.aborted
        ) {
          throw error;
        }
        messages.push(
          { role: 'assistant', content },
          {
            role: 'user',
            content: [
              'Your previous plan failed validation and was not applied.',
              `Validation error: ${error instanceof Error ? error.message : 'Unknown validation error.'}`,
              'Return a corrected complete plan in the required JSON format. Preserve the original scene request and capabilities. Follow every tool argument schema and include all required fields; for set_keyframe, property, frame, value, and objectId are mandatory, and component tracks use componentId. All primitive and component fill fields must be valid six-digit hex colors like #3f9b62, never named colors.',
            ].join('\n'),
          },
        );
      }
    }
    throw new Error('The generated plan could not be validated.');
  } finally {
    clearTimeout(timeoutId);
    requestSignal?.removeEventListener('abort', abortRequest);
  }
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
      const error = new Error('Request body exceeds the 12 MB limit.');
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function createPlanEndpointHandler(options = {}) {
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const input = await readJsonBody(request);
      const plan = await generateAnimationPlan(input, {
        ...options,
        signal: controller.signal,
      });
      return sendJson(response, 200, { plan });
    } catch (error) {
      if (response.destroyed) return;
      const statusCode = error.statusCode ?? 400;
      return sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : 'Plan generation failed.',
      });
    }
  };
}
