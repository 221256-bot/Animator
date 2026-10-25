import React, { useEffect, useRef, useState } from 'react';
import {
  Circle,
  Ellipse,
  Group,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from 'react-konva';
import {
  ANIMATABLE_PROPERTIES,
  addOrUpdateKeyframe,
  evaluateObjectAtFrame,
  moveKeyframe,
  removeKeyframe,
  updateKeyframeEasing,
} from './animation.js';
import {
  AUTOSAVE_KEY,
  createProject,
  DEFAULT_DURATION_SECONDS,
  parseProject,
  PROJECT_HEIGHT as STAGE_HEIGHT,
  PROJECT_WIDTH as STAGE_WIDTH,
} from './project.js';
import { createCharacter } from './character.js';
import {
  applyCharacterAction,
  CHARACTER_ACTIONS,
  CHARACTER_POSES,
  createCharacterActionPlan,
  createCharacterActionSequencePlan,
  createCharacterPosePlan,
} from './characterActions.js';
import { executeAnimationPlan } from './aiGeneration.js';
import { analyzeSceneTimelineQuality } from './sceneQuality.js';
import {
  createSceneRepairPrompt,
  MAX_SCENE_REFINEMENT_ATTEMPTS,
  validateSceneRepairProposal,
} from './sceneRefinement.js';
import {
  evaluateProjectAtFrame,
  worldPointToAttachmentOffset,
} from './sceneEvaluation.js';

const FRAME_RATE = 30;
const PIXELS_PER_SECOND = 100;

function createObjectId() {
  return `object-${crypto.randomUUID()}`;
}

function updateAnimationTarget(object, partId, update) {
  if (!partId) return update(object);
  if (object.type === 'character') {
    return {
      ...object,
      parts: object.parts.map((part) =>
        part.id === partId ? update(part) : part,
      ),
    };
  }
  if (object.type === 'assembly') {
    return {
      ...object,
      components: object.components.map((component) =>
        component.id === partId ? update(component) : component,
      ),
    };
  }
  return object;
}

function readAutosavedProject() {
  try {
    const savedProject = localStorage.getItem(AUTOSAVE_KEY);
    return savedProject
      ? { ...parseProject(savedProject), status: 'Restored autosaved project' }
      : {
          objects: [],
          name: 'Untitled project',
        durationSeconds: DEFAULT_DURATION_SECONDS,
        status: 'Autosave ready',
      };
  } catch (error) {
    return {
      objects: [],
      name: 'Untitled project',
      durationSeconds: DEFAULT_DURATION_SECONDS,
      status: `Autosave unavailable: ${error.message}`,
    };
  }
}

function App() {
  const workspaceRef = useRef(null);
  const transformerRef = useRef(null);
  const objectRefs = useRef(new Map());
  const hasMountedAutosave = useRef(false);
  const [initialProject] = useState(readAutosavedProject);
  const [objects, setObjects] = useState(initialProject.objects);
  const [projectName, setProjectName] = useState(initialProject.name);
  const [projectStatus, setProjectStatus] = useState(initialProject.status);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const fileInputRef = useRef(null);
  const timelineViewportRef = useRef(null);
  const isScrubbingTimeline = useRef(false);
  const keyframeDragRef = useRef(null);
  const playbackRef = useRef({
    active: false,
    frameRequestId: null,
    startFrame: 0,
    startTimestamp: 0,
  });
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [selectedCharacterPartId, setSelectedCharacterPartId] = useState(null);
  const [selectedKeyframe, setSelectedKeyframe] = useState(null);
  const [selectedAnimatedProperty, setSelectedAnimatedProperty] =
    useState('x');
  const [selectedAction, setSelectedAction] = useState('wave');
  const [selectedPose, setSelectedPose] = useState('standing');
  const [actionSequence, setActionSequence] = useState('idle, wave, walk, idle');
  const [actionStartSeconds, setActionStartSeconds] = useState(0);
  const [actionDurationSeconds, setActionDurationSeconds] = useState(2);
  const [actionLoops, setActionLoops] = useState(false);
  const [replaceActionKeyframes, setReplaceActionKeyframes] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPlanState, setAiPlanState] = useState(null);
  const [isRepairPreview, setIsRepairPreview] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiProgress, setAiProgress] = useState(null);
  const aiAbortControllerRef = useRef(null);
  const [draggedKeyframeFrame, setDraggedKeyframeFrame] = useState(null);
  const [stageScale, setStageScale] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(
    initialProject.durationSeconds ?? DEFAULT_DURATION_SECONDS,
  );
  const [currentFrame, setCurrentFrame] = useState(0);
  const totalFrames = Math.round(durationSeconds * FRAME_RATE);
  const totalFramesRef = useRef(totalFrames);
  totalFramesRef.current = totalFrames;
  const [playbackState, setPlaybackState] = useState('stopped');
  const currentTime = currentFrame / FRAME_RATE;
  const displayedProjectObjects = isRepairPreview && aiPlanState
    ? (aiPlanState.repair?.project ?? aiPlanState.previewProject).objects
    : objects;
  const displayObjects = evaluateProjectAtFrame(
    { objects: displayedProjectObjects },
    currentFrame,
  );
  const selectedObjectData = objects.find(
    (object) => object.id === selectedObjectId,
  );
  const selectedObject = displayObjects.find(
    (object) => object.id === selectedObjectId,
  ) ?? null;
  const selectedCharacterPart =
    selectedObject?.type === 'character'
      ? evaluateObjectAtFrame(
          selectedObject.parts.find(
            (part) => part.id === selectedCharacterPartId,
          ) ?? selectedObject.parts[0],
          currentFrame,
        )
      : null;
  const selectedAssemblyComponent =
    selectedObject?.type === 'assembly'
      ? evaluateObjectAtFrame(
          selectedObject.components.find(
            (component) => component.id === selectedCharacterPartId,
          ) ?? selectedObject.components[0],
          currentFrame,
        )
      : null;
  const selectedKeyframeTarget = selectedKeyframe
    ? (() => {
        const owner = objects.find(
          (object) => object.id === selectedKeyframe.objectId,
        );
        return (
          owner?.parts?.find((part) => part.id === selectedKeyframe.partId) ??
          owner?.components?.find(
            (component) => component.id === selectedKeyframe.partId,
          ) ??
          owner
        );
      })()
    : null;
  const selectedKeyframeData = selectedKeyframeTarget?.keyframes?.[
    selectedKeyframe?.property
  ]?.find((keyframe) => keyframe.frame === selectedKeyframe.frame);
  const selectedIndex = objects.findIndex(
    (object) => object.id === selectedObjectId,
  );
  const timelineWidth = durationSeconds * PIXELS_PER_SECOND;

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const selectedNode = objectRefs.current.get(selectedObjectId);
    transformer.nodes(selectedNode ? [selectedNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [objects, selectedObjectId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return undefined;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageScale(Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT, 1));
    });

    resizeObserver.observe(workspace);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(
    () => () => {
      playbackRef.current.active = false;
      if (playbackRef.current.frameRequestId !== null) {
        cancelAnimationFrame(playbackRef.current.frameRequestId);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hasMountedAutosave.current) {
      hasMountedAutosave.current = true;
      return;
    }

    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify(createProject(objects, projectName, durationSeconds)),
      );
      setProjectStatus('Autosaved locally');
    } catch (error) {
      setProjectStatus(`Autosave failed: ${error.message}`);
    }
  }, [objects, projectName, durationSeconds]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (
        tagName === 'input' ||
        tagName === 'textarea' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (selectedKeyframe) {
        event.preventDefault();
        deleteSelectedKeyframe();
        return;
      }

      if (!selectedObjectId) return;

      event.preventDefault();
      setObjects((currentObjects) =>
        currentObjects.filter((object) => object.id !== selectedObjectId),
      );
      setSelectedObjectId(null);
      setSelectedKeyframe(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedKeyframe, selectedObjectId]);

  function addObject(type) {
    const offset = (objects.length % 8) * 24;
    const common = {
      id: createObjectId(),
      type,
      x: type === 'circle' ? 640 + offset : 500 + offset,
      y: type === 'circle' ? 360 + offset : 276 + offset,
      rotation: 0,
      fill:
        type === 'circle'
          ? '#f2aa4c'
          : type === 'text'
            ? '#20242d'
            : '#5b8def',
    };
    const object =
      type === 'rectangle'
        ? { ...common, width: 280, height: 168 }
        : type === 'circle'
          ? { ...common, radius: 92 }
          : {
              ...common,
              x: 500 + offset,
              y: 276 + offset,
              text: 'Text',
              width: 300,
              fontSize: 48,
              align: 'left',
            };

    setObjects((currentObjects) => [...currentObjects, object]);
    setSelectedObjectId(object.id);
    setSelectedCharacterPartId(null);
    setSelectedKeyframe(null);
  }

  function addCharacter() {
    const number =
      objects.filter((object) => object.type === 'character').length + 1;
    const character = createCharacter(
      createObjectId(),
      STAGE_WIDTH / 2,
      STAGE_HEIGHT / 2,
      `Character ${number}`,
    );
    setObjects((currentObjects) => [...currentObjects, character]);
    setSelectedObjectId(character.id);
    setSelectedCharacterPartId(character.parts[0].id);
    setSelectedKeyframe(null);
  }

  function updateCharacterPart(partId, patch) {
    if (!selectedObjectId) return;
    setObjects((currentObjects) =>
      currentObjects.map((object) =>
        object.id === selectedObjectId && object.type === 'character'
          ? {
              ...object,
              parts: object.parts.map((part) =>
                part.id === partId
                  ? Object.entries(patch).reduce(
                      (updatedPart, [property, value]) => {
                        const nextPart = { ...updatedPart, [property]: value };
                        return updatedPart.keyframes?.[property]?.length
                          ? addOrUpdateKeyframe(
                              nextPart,
                              property,
                              currentFrame,
                              value,
                            )
                          : nextPart;
                      },
                      part,
                    )
                  : part,
              ),
            }
          : object,
      ),
    );
  }

  function addJointKeyframe() {
    if (
      !selectedObject ||
      !['character', 'assembly'].includes(selectedObject.type)
    ) {
      return;
    }
    const component = selectedCharacterPart ?? selectedAssemblyComponent;
    if (!component) return;
    const partId = component.id;
    const value = component.rotation ?? 0;
    setObjects((currentObjects) =>
      currentObjects.map((object) =>
        object.id === selectedObject.id
          ? updateAnimationTarget(object, partId, (part) =>
              addOrUpdateKeyframe(part, 'rotation', currentFrame, value),
            )
          : object,
      ),
    );
    setSelectedKeyframe({
      objectId: selectedObject.id,
      partId,
      property: 'rotation',
      frame: currentFrame,
    });
  }

  function updateAssemblyComponent(componentId, patch) {
    if (!selectedObject || selectedObject.type !== 'assembly') return;
    setObjects((currentObjects) =>
      currentObjects.map((object) =>
        object.id === selectedObject.id
          ? {
              ...object,
              components: object.components.map((component) => {
                if (component.id !== componentId) return component;
                let updated = { ...component, ...patch };
                for (const [property, value] of Object.entries(patch)) {
                  if (component.keyframes?.[property]?.length) {
                    updated = addOrUpdateKeyframe(
                      updated,
                      property,
                      currentFrame,
                      value,
                    );
                  }
                }
                return updated;
              }),
            }
          : object,
      ),
    );
  }

  function applySelectedCharacterAction() {
    if (!selectedObject || selectedObject.type !== 'character') {
      setActionStatus('Select a character before applying an action.');
      return;
    }

    const startFrame = Math.round(Number(actionStartSeconds) * FRAME_RATE);
    const durationFrames = Math.round(
      Number(actionDurationSeconds) * FRAME_RATE,
    );
    if (
      !Number.isFinite(startFrame) ||
      startFrame < 0 ||
      !Number.isFinite(durationFrames) ||
      durationFrames < 1 ||
      startFrame + durationFrames > totalFrames
    ) {
      setActionStatus(
        `Choose a start time and duration that fit within the ${durationSeconds}-second timeline.`,
      );
      return;
    }

    try {
      const plan = createCharacterActionPlan(
        selectedObjectData,
        selectedAction,
        startFrame,
        durationFrames,
        actionLoops,
      );
      const result = applyCharacterAction(selectedObjectData, plan, {
        replaceExisting: replaceActionKeyframes,
      });
      pausePlayback();
      setObjects((currentObjects) =>
        currentObjects.map((object) =>
          object.id === selectedObject.id ? result.character : object,
        ),
      );
      const firstPartId = plan[0]?.partId ?? null;
      setSelectedCharacterPartId(firstPartId);
      setSelectedKeyframe(null);
      setCurrentFrame(startFrame);
      setActionStatus(
        `${selectedAction[0].toUpperCase()}${selectedAction.slice(1)} applied: ${plan.length} joint keyframes added${result.replacedKeyframes ? `; ${result.replacedKeyframes} overlapping keys replaced` : ''}.`,
      );
    } catch (error) {
      setActionStatus(error.message);
    }
  }

  function applySelectedCharacterPose() {
    if (!selectedObjectData || selectedObjectData.type !== 'character') {
      setActionStatus('Select a character before applying a pose.');
      return;
    }
    const startFrame = Math.round(Number(actionStartSeconds) * FRAME_RATE);
    const durationFrames = Math.round(Number(actionDurationSeconds) * FRAME_RATE);
    if (
      !Number.isInteger(startFrame) ||
      startFrame < 0 ||
      !Number.isInteger(durationFrames) ||
      durationFrames < 1 ||
      startFrame + durationFrames > totalFrames
    ) {
      setActionStatus('Choose pose timing that fits within the scene timeline.');
      return;
    }
    try {
      const plan = createCharacterPosePlan(
        selectedObjectData,
        selectedPose,
        startFrame,
        durationFrames,
      );
      const updatedCharacter = {
        ...selectedObjectData,
        parts: selectedObjectData.parts.map((part) => {
          const keyframes = plan.filter((keyframe) => keyframe.partId === part.id);
          return keyframes.reduce(
            (updated, keyframe) =>
              addOrUpdateKeyframe(
                updated,
                keyframe.property,
                keyframe.frame,
                keyframe.value,
                'linear',
              ),
            part,
          );
        }),
      };
      pausePlayback();
      setObjects((currentObjects) =>
        currentObjects.map((object) =>
          object.id === selectedObjectData.id ? updatedCharacter : object,
        ),
      );
      setSelectedKeyframe(null);
      setCurrentFrame(startFrame);
      setActionStatus(
        `${selectedPose[0].toUpperCase()}${selectedPose.slice(1)} pose keyed: ${plan.length} editable joint keyframes.`,
      );
    } catch (error) {
      setActionStatus(error.message);
    }
  }

  function applySelectedCharacterSequence() {
    if (!selectedObject || selectedObject.type !== 'character') {
      setActionStatus('Select a character before applying an action sequence.');
      return;
    }

    const startFrame = Math.round(Number(actionStartSeconds) * FRAME_RATE);
    const durationFrames = Math.round(
      Number(actionDurationSeconds) * FRAME_RATE,
    );
    const actionNames = actionSequence
      .split(',')
      .map((action) => action.trim().toLowerCase())
      .filter(Boolean);
    if (
      !Number.isFinite(startFrame) ||
      startFrame < 0 ||
      !Number.isFinite(durationFrames) ||
      durationFrames < 1 ||
      actionNames.some((action) => !CHARACTER_ACTIONS.includes(action))
    ) {
      setActionStatus(
        'Enter known comma-separated actions and valid start/duration values.',
      );
      return;
    }

    try {
      const sequence = createCharacterActionSequencePlan(
        selectedObjectData,
        actionNames.map((action) => ({
          action,
          durationFrames,
          loop: action === 'walk' && actionLoops,
          replaceExisting: replaceActionKeyframes,
        })),
        startFrame,
      );
      if (sequence.endFrame > totalFrames) {
        throw new Error(
          `This sequence ends at ${(sequence.endFrame / FRAME_RATE).toFixed(2)} seconds, beyond the ${durationSeconds}-second timeline.`,
        );
      }

      pausePlayback();
      setObjects((currentObjects) =>
        currentObjects.map((object) =>
          object.id === selectedObject.id ? sequence.character : object,
        ),
      );
      setSelectedCharacterPartId(sequence.character.parts[0]?.id ?? null);
      setSelectedKeyframe(null);
      setCurrentFrame(startFrame);
      setActionStatus(
        `Sequence scheduled through ${(sequence.endFrame / FRAME_RATE).toFixed(2)}s: ${sequence.steps.map((step) => step.action).join(' → ')} (${sequence.keyframeCount} joint keys).`,
      );
    } catch (error) {
      setActionStatus(error.message);
    }
  }

  function pausePlayback() {
    const playback = playbackRef.current;
    if (!playback.active) return;

    playback.active = false;
    if (playback.frameRequestId !== null) {
      cancelAnimationFrame(playback.frameRequestId);
      playback.frameRequestId = null;
    }
    setPlaybackState('paused');
  }

  function stopPlayback() {
    const playback = playbackRef.current;
    playback.active = false;
    if (playback.frameRequestId !== null) {
      cancelAnimationFrame(playback.frameRequestId);
      playback.frameRequestId = null;
    }
    setCurrentFrame(0);
    setPlaybackState('stopped');
  }

  function startPlayback() {
    const playback = playbackRef.current;
    if (playback.active) return;

    const startFrame =
      currentFrame >= totalFramesRef.current ? 0 : currentFrame;
    if (startFrame !== currentFrame) setCurrentFrame(startFrame);

    playback.active = true;
    playback.startFrame = startFrame;
    playback.startTimestamp = performance.now();
    setPlaybackState('playing');

    function advancePlayback(timestamp) {
      if (!playback.active) return;

      const elapsedSeconds = (timestamp - playback.startTimestamp) / 1000;
      const exactFrame = Math.min(
        playback.startFrame + elapsedSeconds * FRAME_RATE,
        totalFramesRef.current,
      );
      const nextFrame = Math.floor(exactFrame);
      setCurrentFrame(nextFrame);

      if (exactFrame >= totalFramesRef.current) {
        playback.active = false;
        playback.frameRequestId = null;
        setPlaybackState('stopped');
        return;
      }

      playback.frameRequestId = requestAnimationFrame(advancePlayback);
    }

    playback.frameRequestId = requestAnimationFrame(advancePlayback);
  }

  function goToStart() {
    const playback = playbackRef.current;
    playback.active = false;
    if (playback.frameRequestId !== null) {
      cancelAnimationFrame(playback.frameRequestId);
      playback.frameRequestId = null;
    }
    setCurrentFrame(0);
    setPlaybackState('stopped');
  }

  function setTimelineTime(time) {
    pausePlayback();
    const frame = Math.round(time * FRAME_RATE);
    setCurrentFrame(Math.max(0, Math.min(frame, totalFrames)));
  }

  function setTimelineFrameFromPointer(event) {
    const viewport = timelineViewportRef.current;
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    const offset = event.clientX - bounds.left + viewport.scrollLeft;
    return Math.max(
      0,
      Math.min(
        totalFrames,
        Math.round((offset / PIXELS_PER_SECOND) * FRAME_RATE),
      ),
    );
  }

  function handleKeyframePointerDown(
    event,
    objectId,
    partId,
    property,
    frame,
  ) {
    event.stopPropagation();
    event.preventDefault();
    pausePlayback();
    keyframeDragRef.current = {
      objectId,
      partId,
      property,
      fromFrame: frame,
      toFrame: frame,
    };
    setSelectedKeyframe({ objectId, partId, property, frame });
    setSelectedObjectId(objectId);
    if (partId) setSelectedCharacterPartId(partId);
    setSelectedAnimatedProperty(property);
    setCurrentFrame(frame);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleKeyframePointerMove(event) {
    if (!keyframeDragRef.current) return;
    const nextFrame = setTimelineFrameFromPointer(event);
    keyframeDragRef.current.toFrame = nextFrame;
    setDraggedKeyframeFrame(nextFrame);
  }

  function finishKeyframeDrag(event) {
    const drag = keyframeDragRef.current;
    if (!drag) return;
    keyframeDragRef.current = null;
    setDraggedKeyframeFrame(null);
    if (drag.fromFrame !== drag.toFrame) {
      const owner = objects.find((object) => object.id === drag.objectId);
      const target = drag.partId
        ? owner?.parts?.find((part) => part.id === drag.partId) ??
          owner?.components?.find(
            (component) => component.id === drag.partId,
          )
        : owner;
      const targetHasKeyframe = target?.keyframes?.[drag.property]?.some(
        (keyframe) => keyframe.frame === drag.toFrame,
      );
      if (!targetHasKeyframe) {
        setObjects((currentObjects) =>
          currentObjects.map((object) =>
            object.id === drag.objectId
              ? updateAnimationTarget(object, drag.partId, (animationTarget) =>
                  moveKeyframe(
                    animationTarget,
                    drag.property,
                    drag.fromFrame,
                    drag.toFrame,
                  ),
                )
              : object,
          ),
        );
        setSelectedKeyframe({
          objectId: drag.objectId,
          partId: drag.partId,
          property: drag.property,
          frame: drag.toFrame,
        });
        setCurrentFrame(drag.toFrame);
      }
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyframeClick(event, objectId, partId, property, frame) {
    event.stopPropagation();
    if (event.detail !== 0) return;
    setSelectedObjectId(objectId);
    setSelectedKeyframe({ objectId, partId, property, frame });
    if (partId) setSelectedCharacterPartId(partId);
    setSelectedAnimatedProperty(property);
    setTimelineTime(frame / FRAME_RATE);
  }

  function scrubTimeline(event) {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;

    const bounds = viewport.getBoundingClientRect();
    const offset = event.clientX - bounds.left + viewport.scrollLeft;
    setTimelineTime((offset / timelineWidth) * durationSeconds);
  }

  function handleTimelinePointerDown(event) {
    if (event.target.closest('[data-track-id]')) return;
    isScrubbingTimeline.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTimeline(event);
  }

  function handleTimelinePointerMove(event) {
    if (keyframeDragRef.current) {
      handleKeyframePointerMove(event);
    } else if (isScrubbingTimeline.current) {
      scrubTimeline(event);
    }
  }

  function handleTimelinePointerUp(event) {
    isScrubbingTimeline.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function changeDuration(value) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) return;

    pausePlayback();
    setDurationSeconds(duration);
    setCurrentFrame((frame) =>
      Math.min(frame, Math.round(duration * FRAME_RATE)),
    );
  }

  function saveProject() {
    const project = createProject(objects, projectName, durationSeconds);
    const projectFile = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json',
    });
    const downloadUrl = URL.createObjectURL(projectFile);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${projectName.replace(/[<>:"/\\|?*]/g, '_') || 'untitled-project'}.animator.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);

    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
      setProjectStatus('Project downloaded and autosaved locally');
    } catch (error) {
      setProjectStatus(`Project downloaded; autosave failed: ${error.message}`);
    }
  }

  function analyzeCurrentScene() {
    try {
      const baseProject = createProject(objects, projectName, durationSeconds);
      const quality = analyzeSceneTimelineQuality(baseProject);
      setAiPlanState({
        plan: {
          summary: 'Quality review of the current editable scene.',
          unsupportedCapabilities: [],
          operations: [],
        },
        previewProject: baseProject,
        quality,
        repairAttempts: 0,
        baseProject,
        baseProjectJson: JSON.stringify(baseProject),
      });
      setIsRepairPreview(false);
      setAiStatus(
        quality.warningCount
          ? `Scene analysis complete: ${quality.warningCount} warning(s) need review.`
          : 'Scene analysis complete: no configured quality warnings found.',
      );
    } catch (error) {
      setAiStatus(`Scene analysis failed: ${error.message}`);
    }
  }

  async function generateAnimationPlan(event) {
    event.preventDefault();
    if (!aiPrompt.trim()) {
      setAiStatus('Describe the animation you want to create.');
      return;
    }

    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    const baseProject = createProject(objects, projectName, durationSeconds);
    setAiBusy(true);
    setAiPlanState(null);
    setIsRepairPreview(false);
    setAiProgress(null);
    setAiStatus('Asking the planning model for a supported animation plan…');
    let planReceived = false;
    try {
      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, project: baseProject }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Plan request failed (${response.status}).`);
      }
      if (!payload.plan) {
        throw new Error('The planning service returned no plan.');
      }
      planReceived = true;

      const validation = await executeAnimationPlan(baseProject, payload.plan, {
        signal: controller.signal,
      });
      const quality = analyzeSceneTimelineQuality(validation.project);
      setAiPlanState({
        plan: payload.plan,
        previewProject: validation.project,
        quality,
        repairAttempts: 0,
        baseProject,
        baseProjectJson: JSON.stringify(baseProject),
      });
      setAiStatus(
        payload.plan.unsupportedCapabilities.length
          ? 'Plan validated. Unsupported requests are listed below; only the supported steps can be applied.'
          : 'Plan validated. Review it before applying changes.',
      );
    } catch (error) {
      if (aiAbortControllerRef.current === controller) {
        if (error.name === 'AbortError') {
          setAiStatus('Generation cancelled. The project was not changed.');
        } else if (error instanceof TypeError && /fetch/i.test(error.message)) {
          setAiStatus(
            'AI request failed: Cannot reach the planning server. Start or restart the app with npm run dev, open its local URL, and refresh the page.',
          );
        } else if (!planReceived) {
          setAiStatus(`AI planning request failed: ${error.message}`);
        } else {
          setAiStatus(`Plan failed validation: ${error.message}`);
        }
      }
    } finally {
      if (aiAbortControllerRef.current === controller) {
        aiAbortControllerRef.current = null;
        setAiBusy(false);
      }
    }
  }

  async function proposeSceneRepair() {
    if (
      !aiPlanState ||
      aiPlanState.repairAttempts >= MAX_SCENE_REFINEMENT_ATTEMPTS
    ) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setAiBusy(true);
    setAiProgress(null);
    setAiPlanState((current) =>
      current ? { ...current, repairAttempts: current.repairAttempts + 1 } : current,
    );
    setAiStatus('Requesting one bounded quality-repair proposal…');
    try {
      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: createSceneRepairPrompt(aiPlanState.quality.warnings),
          project: aiPlanState.previewProject,
        }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? `Repair request failed (${response.status}).`);
      }
      if (!payload.plan) {
        throw new Error('The planning service returned no repair proposal.');
      }
      const repair = await validateSceneRepairProposal(
        aiPlanState.previewProject,
        payload.plan,
        { signal: controller.signal },
      );
      setAiPlanState((current) =>
        current
          ? { ...current, repair: { plan: payload.plan, ...repair } }
          : current,
      );
      setIsRepairPreview(false);
      setAiStatus(
        repair.quality.warningCount
          ? `Repair proposal validated; ${repair.quality.warningCount} quality warning(s) remain. Review before applying.`
          : 'Repair proposal validated with no remaining quality warnings. Review before applying.',
      );
    } catch (error) {
      if (aiAbortControllerRef.current === controller) {
        setAiStatus(
          error.name === 'AbortError'
            ? 'Repair proposal cancelled. The project was not changed.'
            : `Repair proposal failed validation; the project was not changed: ${error.message}`,
        );
      }
    } finally {
      if (aiAbortControllerRef.current === controller) {
        aiAbortControllerRef.current = null;
        setAiBusy(false);
      }
    }
  }

  async function applyGeneratedPlan() {
    if (!aiPlanState) return;
    const currentProject = createProject(objects, projectName, durationSeconds);
    if (JSON.stringify(currentProject) !== aiPlanState.baseProjectJson) {
      setAiPlanState(null);
      setIsRepairPreview(false);
      setAiStatus(
        'The project changed after planning. Generate a fresh plan before applying it.',
      );
      return;
    }

    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setAiBusy(true);
    setAiProgress({ completed: 0, total: aiPlanState.plan.operations.length });
    setAiStatus('Applying and validating operations on a temporary project copy…');
    try {
      const result = aiPlanState.repair
        ? {
            project: parseProject(JSON.stringify(aiPlanState.repair.project)),
            results: aiPlanState.repair.results,
            unsupportedCapabilities:
              aiPlanState.repair.unsupportedCapabilities,
          }
        : await executeAnimationPlan(
            aiPlanState.baseProject,
            aiPlanState.plan,
            {
              signal: controller.signal,
              onProgress: setAiProgress,
            },
          );
      if (controller.signal.aborted) {
        throw new Error('Animation generation was cancelled.');
      }
      pausePlayback();
      setObjects(result.project.objects);
      setDurationSeconds(result.project.durationSeconds);
      setProjectName(result.project.name);
      setSelectedObjectId(null);
      setSelectedCharacterPartId(null);
      setSelectedKeyframe(null);
      setCurrentFrame(0);
      setAiPlanState(null);
      setIsRepairPreview(false);
      setAiStatus(
        result.unsupportedCapabilities.length
          ? `Supported steps applied. ${result.unsupportedCapabilities.length} requested capability/capabilities remain unsupported.`
          : `Animation created successfully: ${result.results.length} operation(s) applied.`,
      );
    } catch (error) {
      if (aiAbortControllerRef.current === controller) {
        setAiStatus(
          error.message === 'Animation generation was cancelled.'
            ? 'Generation cancelled. The project was not changed.'
            : `Generation failed; no changes were committed: ${error.message}`,
        );
      }
    } finally {
      if (aiAbortControllerRef.current === controller) {
        aiAbortControllerRef.current = null;
        setAiBusy(false);
        setAiProgress(null);
      }
    }
  }

  function cancelAnimationGeneration() {
    aiAbortControllerRef.current?.abort();
    setAiPlanState(null);
    setIsRepairPreview(false);
    setAiBusy(false);
    setAiProgress(null);
    setAiStatus('Generation cancelled. The project was not changed.');
  }

  async function loadProject(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setProjectStatus('Load failed: project files must be 5 MB or smaller.');
      return;
    }

    setIsLoadingProject(true);
    try {
      const project = parseProject(await file.text());
      stopPlayback();
      setObjects(project.objects);
      setProjectName(project.name);
      setDurationSeconds(project.durationSeconds);
      setSelectedObjectId(null);
      setSelectedKeyframe(null);
      setCurrentFrame(0);
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
        setProjectStatus(`Loaded ${file.name} and autosaved locally`);
      } catch (error) {
        setProjectStatus(
          `Loaded ${file.name}; autosave failed: ${error.message}`,
        );
      }
    } catch (error) {
      setProjectStatus(`Load failed: ${error.message}`);
    } finally {
      setIsLoadingProject(false);
    }
  }

  function deleteSelectedObject() {
    if (!selectedObjectId) return;
    const attachedObjects = objects.filter(
      (object) => object.attachment?.parentId === selectedObjectId,
    );
    if (attachedObjects.length) {
      setProjectStatus(
        `Cannot delete this object while ${attachedObjects.map((object) => object.id).join(', ')} is attached. Detach them first.`,
      );
      return;
    }
    setObjects((currentObjects) =>
      currentObjects.filter((object) => object.id !== selectedObjectId),
    );
    setSelectedObjectId(null);
    setSelectedKeyframe(null);
  }

  function updateSelectedObject(patch) {
    if (!selectedObjectId) return;
    updateObject(selectedObjectId, patch);
  }

  function updateObject(objectId, patch) {
    setObjects((currentObjects) => {
      const objectToUpdate = currentObjects.find((object) => object.id === objectId);
      let normalizedPatch = patch;
      if (objectToUpdate?.attachment) {
        const evaluated = evaluateProjectAtFrame(
          { objects: currentObjects },
          currentFrame,
        );
        const worldObject = evaluated.find((object) => object.id === objectId);
        const parentWorld = evaluated.find(
          (object) => object.id === objectToUpdate.attachment.parentId,
        );
        const parent = currentObjects.find(
          (object) => object.id === objectToUpdate.attachment.parentId,
        );
        const anchor = parent?.anchors?.find(
          (item) => item.id === objectToUpdate.attachment.anchorId,
        );
        if (!parentWorld || !anchor) {
          setProjectStatus('Cannot update object: its attachment anchor is unavailable.');
          return currentObjects;
        }
        normalizedPatch = { ...patch };
        if ('x' in patch || 'y' in patch) {
          const offset = worldPointToAttachmentOffset(parentWorld, anchor, {
            x: patch.x ?? worldObject.x,
            y: patch.y ?? worldObject.y,
          });
          normalizedPatch.x = offset.x;
          normalizedPatch.y = offset.y;
        }
        if ('rotation' in patch) {
          normalizedPatch.rotation =
            patch.rotation -
            (parentWorld.rotation ?? 0) -
            (anchor.rotation ?? 0);
        }
        if ('scaleX' in patch) {
          normalizedPatch.scaleX =
            patch.scaleX / (parentWorld.scaleX ?? 1);
        }
        if ('scaleY' in patch) {
          normalizedPatch.scaleY =
            patch.scaleY / (parentWorld.scaleY ?? 1);
        }
      }
      return currentObjects.map((object) => {
        if (object.id !== objectId) return object;

        let updatedObject = { ...object, ...normalizedPatch };
        for (const [property, value] of Object.entries(normalizedPatch)) {
          if (object.keyframes?.[property]?.length) {
            updatedObject = addOrUpdateKeyframe(
              updatedObject,
              property,
              currentFrame,
              value,
            );
          }
        }
        return updatedObject;
      });
    });
  }

  function addKeyframe() {
    if (!selectedObject) return;

    setObjects((currentObjects) =>
      currentObjects.map((object) => {
        if (object.id !== selectedObject.id) return object;
        let updatedObject = object;
        const value =
          selectedObject[selectedAnimatedProperty] ??
          (selectedAnimatedProperty === 'opacity' ||
          selectedAnimatedProperty === 'scaleX' ||
          selectedAnimatedProperty === 'scaleY'
            ? 1
            : 0);
        updatedObject = addOrUpdateKeyframe(
          updatedObject,
          selectedAnimatedProperty,
          currentFrame,
          value,
        );
        return updatedObject;
      }),
    );
    setSelectedKeyframe({
      objectId: selectedObject.id,
      property: selectedAnimatedProperty,
      frame: currentFrame,
    });
  }

  function deleteSelectedKeyframe() {
    if (!selectedKeyframe) return;
    pausePlayback();
    setObjects((currentObjects) =>
      currentObjects.map((object) =>
        object.id === selectedKeyframe.objectId
          ? updateAnimationTarget(
              object,
              selectedKeyframe.partId,
              (animationTarget) =>
                removeKeyframe(
                  animationTarget,
                  selectedKeyframe.property,
                  selectedKeyframe.frame,
                ),
            )
          : object,
      ),
    );
    setSelectedKeyframe(null);
  }

  function changeSelectedKeyframeEasing(easing) {
    if (!selectedKeyframe) return;
    setObjects((currentObjects) =>
      currentObjects.map((object) =>
        object.id === selectedKeyframe.objectId
          ? updateAnimationTarget(
              object,
              selectedKeyframe.partId,
              (animationTarget) =>
                updateKeyframeEasing(
                  animationTarget,
                  selectedKeyframe.property,
                  selectedKeyframe.frame,
                  easing,
                ),
            )
          : object,
      ),
    );
  }

  function moveSelectedLayer(destination) {
    if (selectedIndex < 0) return;

    setObjects((currentObjects) => {
      const nextObjects = [...currentObjects];
      const currentIndex = nextObjects.findIndex(
        (object) => object.id === selectedObjectId,
      );
      if (currentIndex < 0) return currentObjects;

      const [selected] = nextObjects.splice(currentIndex, 1);
      let targetIndex;

      if (destination === 'front') {
        targetIndex = nextObjects.length;
      } else if (destination === 'back') {
        targetIndex = 0;
      } else if (destination === 'forward') {
        targetIndex = Math.min(currentIndex + 1, nextObjects.length);
      } else {
        targetIndex = Math.max(currentIndex - 1, 0);
      }

      nextObjects.splice(targetIndex, 0, selected);
      return nextObjects;
    });
  }

  function renderProperty(label, value, onChange, options = {}) {
    const { type = 'number', min, max, step = 1 } = options;
    return (
      <label className="property-field" key={label}>
        <span>{label}</span>
        <input
          type={type}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    );
  }

  function renderNumberProperty(
    label,
    property,
    minimum = -Infinity,
    maximum,
  ) {
    return renderProperty(
      label,
      selectedObject[property] ??
        (property === 'scaleX' ||
        property === 'scaleY' ||
        property === 'opacity'
          ? 1
          : 0),
      (value) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < minimum) return;
        updateSelectedObject({ [property]: number });
      },
      {
        min: Number.isFinite(minimum) ? minimum : undefined,
        max: maximum,
      },
    );
  }

  function renderCharacterPartNumberProperty(
    label,
    property,
    minimum = -Infinity,
  ) {
    return renderProperty(
      label,
      selectedCharacterPart[property],
      (value) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < minimum) return;
        updateCharacterPart(selectedCharacterPart.id, { [property]: number });
      },
      { min: Number.isFinite(minimum) ? minimum : undefined },
    );
  }

  const objectTrackNames = new Map();
  const trackCounts = new Map();
  objects.forEach((object) => {
    const number = (trackCounts.get(object.type) ?? 0) + 1;
    trackCounts.set(object.type, number);
    objectTrackNames.set(
      object.id,
      object.type === 'character' || object.type === 'assembly'
        ? object.name
        : `${object.type} ${number}`,
    );
  });
  const timelineRows = objects.flatMap((object) => {
    const rows = [
      {
        objectId: object.id,
        partId: null,
        label: objectTrackNames.get(object.id),
        type: object.type,
        keyframes: object.keyframes ?? {},
      },
    ];
    if (object.type === 'character') {
      rows.push(
        ...object.parts
          .filter((part) =>
            Object.values(part.keyframes ?? {}).some(
              (keyframes) => keyframes.length > 0,
            ),
          )
          .map((part) => ({
            objectId: object.id,
            partId: part.id,
            label: part.id
              .slice(object.id.length + 1)
              .replaceAll('-', ' '),
            type: object.type,
            keyframes: part.keyframes,
          })),
      );
    }
    if (object.type === 'assembly') {
      rows.push(
        ...object.components
          .filter((component) =>
            Object.values(component.keyframes ?? {}).some(
              (keyframes) => keyframes.length > 0,
            ),
          )
          .map((component) => ({
            objectId: object.id,
            partId: component.id,
            label: component.id
              .replace(`${object.id}_`, '')
              .replaceAll('_', ' ')
              .replaceAll('-', ' '),
            type: object.type,
            keyframes: component.keyframes,
          })),
      );
    }
    return rows;
  });
  const formatTime = (time) => {
    const seconds = Math.floor(time);
    const minutesPart = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secondsPart = String(seconds % 60).padStart(2, '0');
    return `${minutesPart}:${secondsPart}`;
  };

  return (
    <main className="editor">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Animator home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>Animator</span>
        </a>
        <div className="toolbar" role="toolbar" aria-label="Editor tools">
          <div className="tool-group" role="group" aria-label="Add objects">
            <button
              className="tool-button"
              onClick={() => addObject('rectangle')}
              type="button"
            >
              <span className="rectangle-icon" aria-hidden="true" />
              <span>Rectangle</span>
            </button>
            <button
              className="tool-button"
              onClick={() => addObject('circle')}
              type="button"
            >
              <span className="circle-icon" aria-hidden="true" />
              <span>Circle</span>
            </button>
            <button
              className="tool-button"
              onClick={() => addObject('text')}
              type="button"
            >
              <span aria-hidden="true">T</span>
              <span>Text</span>
            </button>
            <button
              className="tool-button"
              onClick={addCharacter}
              type="button"
              aria-label="Add Character"
            >
              <span aria-hidden="true">♙</span>
              <span>Add Character</span>
            </button>
          </div>
          <div className="tool-group layer-tools" role="group" aria-label="Layer order">
            <button
              className="icon-button"
              aria-label="Bring to front"
              title="Bring to front"
              disabled={selectedIndex < 0 || selectedIndex === objects.length - 1}
              onClick={() => moveSelectedLayer('front')}
              type="button"
            >
              ⇈
            </button>
            <button
              className="icon-button"
              aria-label="Bring forward"
              title="Bring forward"
              disabled={selectedIndex < 0 || selectedIndex === objects.length - 1}
              onClick={() => moveSelectedLayer('forward')}
              type="button"
            >
              ↑
            </button>
            <button
              className="icon-button"
              aria-label="Send backward"
              title="Send backward"
              disabled={selectedIndex <= 0}
              onClick={() => moveSelectedLayer('backward')}
              type="button"
            >
              ↓
            </button>
            <button
              className="icon-button"
              aria-label="Send to back"
              title="Send to back"
              disabled={selectedIndex <= 0}
              onClick={() => moveSelectedLayer('back')}
              type="button"
            >
              ⇊
            </button>
          </div>
          <button
            className="tool-button delete-button"
            onClick={deleteSelectedObject}
            disabled={!selectedObject}
            type="button"
          >
            Delete
          </button>
        </div>
        <div className="project-actions">
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.animator.json,application/json"
            onChange={loadProject}
            aria-label="Choose project file"
          />
          <button
            className="tool-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoadingProject}
            type="button"
          >
            Load
          </button>
          <button className="tool-button" onClick={saveProject} type="button">
            Save
          </button>
          <span className="save-status" role="status" title={projectStatus}>
            {projectStatus}
          </span>
        </div>
      </header>

      <section className="ai-generation-panel" aria-labelledby="ai-generation-title">
        <div className="ai-generation-copy">
          <h2 id="ai-generation-title">Generate with AI</h2>
          <p>
            Describe an animation. Review the supported plan before applying it;
            the model cannot edit the canvas directly.
          </p>
        </div>
        <form className="ai-generation-form" onSubmit={generateAnimationPlan}>
          <label className="visually-hidden" htmlFor="animation-prompt">
            Animation description
          </label>
          <textarea
            id="animation-prompt"
            value={aiPrompt}
            maxLength={4000}
            placeholder="For example: Make the character wave, then walk across the scene."
            onChange={(event) => setAiPrompt(event.currentTarget.value)}
            disabled={aiBusy}
            rows={2}
          />
          <div className="ai-generation-actions">
            <button
              className="tool-button"
              type="button"
              onClick={analyzeCurrentScene}
              disabled={aiBusy}
            >
              Analyze Current Scene
            </button>
            <button
              className="tool-button ai-primary-button"
              type="submit"
              disabled={aiBusy || !aiPrompt.trim()}
            >
              {aiBusy && !aiProgress ? 'Planning…' : 'Generate Animation'}
            </button>
            {(aiBusy || aiPlanState) && (
              <button
                className="tool-button"
                type="button"
                onClick={
                  aiBusy
                    ? cancelAnimationGeneration
                    : () => {
                        setAiPlanState(null);
                      setIsRepairPreview(false);
                      setAiStatus('Plan cancelled. The project was not changed.');
                      }
                }
              >
                {aiBusy ? 'Cancel' : 'Discard Plan'}
              </button>
            )}
            {aiPlanState && (
              <button
                className="tool-button ai-primary-button"
                type="button"
                onClick={applyGeneratedPlan}
                disabled={
                  aiBusy ||
                  (aiPlanState.repair
                    ? aiPlanState.repair.results.length === 0
                    : aiPlanState.plan.operations.length === 0)
                }
              >
                {aiPlanState.repair ? 'Apply Refined Project' : 'Apply Supported Steps'}
              </button>
            )}
            {aiPlanState?.quality.warningCount > 0 &&
              !aiPlanState.repair &&
              aiPlanState.repairAttempts < MAX_SCENE_REFINEMENT_ATTEMPTS && (
                <button
                  className="tool-button"
                  type="button"
                  onClick={proposeSceneRepair}
                  disabled={aiBusy}
                >
                  Propose One Repair Pass
                </button>
              )}
            {aiPlanState && (
              <button
                className="tool-button"
                type="button"
                onClick={() => {
                  setIsRepairPreview((visible) => !visible);
                  if (!isRepairPreview) setCurrentFrame(0);
                }}
                aria-pressed={isRepairPreview}
              >
                {isRepairPreview
                  ? 'Exit Scene Preview'
                  : aiPlanState.repair
                    ? 'Preview Repair on Stage'
                    : 'Preview Planned Scene'}
              </button>
            )}
          </div>
        </form>
        {aiStatus && (
          <div className="ai-generation-status" role="status" aria-live="polite">
            {aiStatus}
            {aiProgress && aiBusy && (
              <span>
                {' '}
                ({aiProgress.completed}/{aiProgress.total} operations validated)
              </span>
            )}
          </div>
        )}
        {aiPlanState && (
          <div className="ai-plan-review" aria-label="Generated animation plan">
            <h3>Plan review</h3>
            <p>{aiPlanState.plan.summary}</p>
            {aiPlanState.quality.warningCount > 0 && (
              <div className="ai-unsupported" role="alert">
                <strong>Scene quality warnings to review:</strong>
                <ul>
                  {aiPlanState.quality.warnings.map((warning, index) => (
                    <li
                      key={`${warning.code}-${warning.objectId}-${warning.partId ?? index}`}
                    >
                      {warning.message}
                      {warning.frames?.length
                        ? ` (frames: ${warning.frames.join(', ')})`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {aiPlanState.plan.unsupportedCapabilities.length > 0 && (
              <div className="ai-unsupported">
                <strong>Not supported — these steps will not be created:</strong>
                <ul>
                  {aiPlanState.plan.unsupportedCapabilities.map(
                    (capability, index) => (
                      <li key={`${index}-${capability}`}>{capability}</li>
                    ),
                  )}
                </ul>
              </div>
            )}
            <ol className="ai-operation-list">
              {aiPlanState.plan.operations.map((operation, index) => (
                <li key={`${index}-${operation.tool}`}>
                  <code>{operation.tool}</code>
                  <pre>{JSON.stringify(operation.args, null, 2)}</pre>
                </li>
              ))}
              {aiPlanState.plan.operations.length === 0 && (
                <li>No supported operations were generated.</li>
              )}
            </ol>
            {aiPlanState.repair && (
              <div className="ai-repair-review" aria-label="Validated repair proposal">
                <h3>
                  Repair proposal (attempt {aiPlanState.repair.attempt} of{' '}
                  {aiPlanState.repair.attemptLimit})
                </h3>
                <p>{aiPlanState.repair.summary}</p>
                <p>
                  Remaining warnings after preview:{' '}
                  {aiPlanState.repair.quality.warningCount}
                </p>
                {aiPlanState.repair.quality.warnings.length > 0 && (
                  <ul>
                    {aiPlanState.repair.quality.warnings.map((warning, index) => (
                      <li key={`${warning.code}-${warning.objectId}-${index}`}>
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                )}
                <ol className="ai-operation-list">
                  {aiPlanState.repair.plan.operations.map((operation, index) => (
                    <li key={`repair-${index}-${operation.tool}`}>
                      <code>{operation.tool}</code>
                      <pre>{JSON.stringify(operation.args, null, 2)}</pre>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="editor-content">
        <section className="workspace" ref={workspaceRef} aria-label="Editor canvas">
          {isRepairPreview && (
            <div className="ai-generation-status" role="status">
              Read-only preview of the generated scene. The project is unchanged
              until you apply the reviewed plan.
            </div>
          )}
          <div
            className="stage-frame"
            style={{
              width: STAGE_WIDTH * stageScale,
              height: STAGE_HEIGHT * stageScale,
            }}
          >
            <div
              className="stage-scaler"
              style={{ transform: `scale(${stageScale})` }}
            >
              <Stage
                width={STAGE_WIDTH}
                height={STAGE_HEIGHT}
                onMouseDown={(event) => {
                  if (isRepairPreview) return;
                  if (event.target === event.target.getStage()) {
                    setSelectedObjectId(null);
                    setSelectedKeyframe(null);
                  }
                }}
                onTouchStart={(event) => {
                  if (isRepairPreview) return;
                  if (event.target === event.target.getStage()) {
                    setSelectedObjectId(null);
                    setSelectedKeyframe(null);
                  }
                }}
              >
                <Layer>
                  {displayObjects.map((object) => {
                    const isSelected = object.id === selectedObjectId;
                    const handleSelect = () => {
                      setSelectedObjectId(object.id);
                      setSelectedCharacterPartId(
                        object.type === 'character'
                          ? object.parts[0]?.id
                          : object.type === 'assembly'
                            ? object.components[0]?.id
                            : null,
                      );
                      setSelectedKeyframe(null);
                    };
                    const handleDragEnd = (event) => {
                      const { x, y } = event.target.position();
                      updateObject(object.id, { x, y });
                    };
                    const handleTransformEnd = (event) => {
                      const node = event.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();
                      const { x, y } = node.position();
                      const rotation = node.rotation();
                      node.scaleX(1);
                      node.scaleY(1);

                      const currentObject = objects.find(
                        (item) => item.id === object.id,
                      );
                      if (!currentObject) return;

                      const patch = { x, y, rotation };
                      if (
                        currentObject.type === 'character' ||
                        currentObject.type === 'assembly'
                      ) {
                        patch.scaleX = scaleX;
                        patch.scaleY = scaleY;
                      } else if (currentObject.type === 'rectangle') {
                        patch.width = Math.max(
                          5,
                          currentObject.width * scaleX,
                        );
                        patch.height = Math.max(
                          5,
                          currentObject.height * scaleY,
                        );
                      } else if (currentObject.type === 'circle') {
                        patch.radius = Math.max(
                          5,
                          currentObject.radius * Math.max(scaleX, scaleY),
                        );
                      } else {
                        patch.width = Math.max(
                          10,
                          currentObject.width * scaleX,
                        );
                        patch.fontSize = Math.max(
                          5,
                          currentObject.fontSize * scaleY,
                        );
                      }
                      updateObject(object.id, patch);
                    };
                    const sharedProps = {
                      ref: (node) => {
                        if (node) objectRefs.current.set(object.id, node);
                        else objectRefs.current.delete(object.id);
                      },
                      x: object.x,
                      y: object.y,
                      rotation: object.rotation ?? 0,
                      scaleX: object.scaleX ?? 1,
                      scaleY: object.scaleY ?? 1,
                      opacity: object.opacity ?? 1,
                      fill: object.fill,
                      draggable: !isRepairPreview,
                      stroke: isSelected ? '#20242d' : undefined,
                      strokeWidth: isSelected ? 3 : 0,
                      onClick: isRepairPreview ? undefined : handleSelect,
                      onTap: isRepairPreview ? undefined : handleSelect,
                      onDragStart: isRepairPreview ? undefined : handleSelect,
                      onDragEnd: isRepairPreview ? undefined : handleDragEnd,
                      onTransformEnd: isRepairPreview
                        ? undefined
                        : handleTransformEnd,
                    };

                    if (object.type === 'character') {
                      const renderPart = (part) => (
                        (() => {
                          const displayedPart = evaluateObjectAtFrame(
                            part,
                            currentFrame,
                          );
                          return (
                            <Group
                              key={part.id}
                              x={displayedPart.x}
                              y={displayedPart.y}
                              rotation={displayedPart.rotation}
                              scaleX={displayedPart.scaleX ?? 1}
                              scaleY={displayedPart.scaleY ?? 1}
                              opacity={displayedPart.opacity ?? 1}
                            >
                              {displayedPart.shape === 'ellipse' ? (
                                <Ellipse
                                    x={(displayedPart.shapeOffsetX ?? 0) - displayedPart.width / 2}
                                    y={(displayedPart.shapeOffsetY ?? 0) - displayedPart.height / 2}
                                  width={displayedPart.width}
                                  height={displayedPart.height}
                                  fill={displayedPart.fill}
                                />
                              ) : (
                                <Rect
                                  x={(displayedPart.shapeOffsetX ?? 0) - displayedPart.width / 2}
                                  y={(displayedPart.shapeOffsetY ?? 0) - displayedPart.height / 2}
                                  width={displayedPart.width}
                                  height={displayedPart.height}
                                  cornerRadius={displayedPart.cornerRadius}
                                  fill={displayedPart.fill}
                                />
                              )}
                              {object.parts
                                .filter((child) => child.parentId === part.id)
                                .map(renderPart)}
                            </Group>
                          );
                        })()
                      );
                      const rootCharacterProps = {
                        ref: (node) => {
                          if (node) objectRefs.current.set(object.id, node);
                          else objectRefs.current.delete(object.id);
                        },
                        x: object.x,
                        y: object.y,
                        rotation: object.rotation ?? 0,
                        scaleX: object.scaleX ?? 1,
                        scaleY: object.scaleY ?? 1,
                        opacity: object.opacity ?? 1,
                        draggable: !isRepairPreview,
                        onClick: isRepairPreview ? undefined : handleSelect,
                        onTap: isRepairPreview ? undefined : handleSelect,
                        onDragStart: isRepairPreview ? undefined : handleSelect,
                        onDragEnd: isRepairPreview ? undefined : handleDragEnd,
                        onTransformEnd: isRepairPreview
                          ? undefined
                          : handleTransformEnd,
                      };
                      return (
                        <Group key={object.id} {...rootCharacterProps}>
                          {object.parts
                            .filter((part) => part.parentId === null)
                            .map(renderPart)}
                        </Group>
                      );
                    }

                    if (object.type === 'assembly') {
                      const renderComponent = (component) => {
                        const displayedComponent = evaluateObjectAtFrame(
                          component,
                          currentFrame,
                        );
                        const children = object.components.filter(
                          (item) => item.parentId === component.id,
                        );
                        return (
                          <Group
                            key={displayedComponent.id}
                            x={displayedComponent.x}
                            y={displayedComponent.y}
                            rotation={displayedComponent.rotation ?? 0}
                            scaleX={displayedComponent.scaleX ?? 1}
                            scaleY={displayedComponent.scaleY ?? 1}
                            opacity={displayedComponent.opacity ?? 1}
                          >
                            {displayedComponent.type === 'rectangle' ? (
                              <Rect
                                x={-displayedComponent.width / 2}
                                y={-displayedComponent.height / 2}
                                width={displayedComponent.width}
                                height={displayedComponent.height}
                                cornerRadius={displayedComponent.cornerRadius}
                                fill={displayedComponent.fill}
                              />
                            ) : displayedComponent.type === 'circle' ? (
                              <Circle
                                radius={displayedComponent.radius}
                                fill={displayedComponent.fill}
                              />
                            ) : (
                              <Text
                                x={-displayedComponent.width / 2}
                                y={-(displayedComponent.fontSize * 1.3) / 2}
                                text={displayedComponent.text}
                                width={displayedComponent.width}
                                fontSize={displayedComponent.fontSize}
                                fontFamily="Arial"
                                align={displayedComponent.align}
                                fill={displayedComponent.fill}
                              />
                            )}
                            {children.map(renderComponent)}
                          </Group>
                        );
                      };
                      return (
                        <Group key={object.id} {...sharedProps}>
                          {object.components
                            .filter((component) => component.parentId === null)
                            .map(renderComponent)}
                        </Group>
                      );
                    }

                    if (object.type === 'rectangle') {
                      return (
                        <Rect
                          key={object.id}
                          {...sharedProps}
                          width={object.width}
                          height={object.height}
                          cornerRadius={4}
                        />
                      );
                    }
                    if (object.type === 'circle') {
                      return (
                        <Circle
                          key={object.id}
                          {...sharedProps}
                          radius={object.radius}
                        />
                      );
                    }
                    return (
                      <Text
                        key={object.id}
                        {...sharedProps}
                        text={object.text}
                        width={object.width}
                        fontSize={object.fontSize}
                        fontFamily="Arial"
                        align={object.align}
                      />
                    );
                  })}
                  {!isRepairPreview && (
                    <Transformer
                    ref={transformerRef}
                    anchorFill="#ffffff"
                    anchorStroke="#3978e8"
                    anchorSize={10}
                    borderStroke="#3978e8"
                    borderStrokeWidth={1.5}
                    keepRatio={selectedObject?.type === 'circle'}
                    enabledAnchors={
                      selectedObject?.type === 'circle'
                        ? [
                            'top-left',
                            'top-right',
                            'bottom-left',
                            'bottom-right',
                          ]
                        : undefined
                    }
                    rotateEnabled
                    rotateAnchorOffset={36}
                    />
                  )}
                </Layer>
              </Stage>
            </div>
          </div>
        </section>

        <aside className="properties-panel" aria-label="Properties panel">
          <h2>Properties</h2>
          {!selectedObject ? (
            <p className="empty-properties">Select an object to edit its properties.</p>
          ) : (
            <div className="property-list">
              <div className="selected-type">
                {selectedObject.type[0].toUpperCase() +
                  selectedObject.type.slice(1)}
              </div>
              {renderNumberProperty('X', 'x')}
              {renderNumberProperty('Y', 'y')}
              {selectedObject.type === 'character' ||
              selectedObject.type === 'assembly' ? null : selectedObject.type === 'circle' ? (
                renderNumberProperty('Radius', 'radius', 5)
              ) : (
                <>
                  {renderNumberProperty(
                    'Width',
                    'width',
                    selectedObject.type === 'text' ? 10 : 5,
                  )}
                  {selectedObject.type === 'rectangle' &&
                    renderNumberProperty('Height', 'height', 5)}
                </>
              )}
              {renderNumberProperty('Rotation', 'rotation')}
              {renderNumberProperty('Scale X', 'scaleX', 0.01)}
              {renderNumberProperty('Scale Y', 'scaleY', 0.01)}
              {renderNumberProperty('Opacity', 'opacity', 0, 1)}
              {selectedObject.type === 'character' && (
                <>
                  <label className="property-field property-field-stacked">
                    <span>Character name</span>
                    <input
                      type="text"
                      value={selectedObject.name}
                      onChange={(event) =>
                        updateSelectedObject({ name: event.currentTarget.value })
                      }
                    />
                  </label>
                  <div className="character-rig-properties">
                    <h3>Rig part</h3>
                    <label className="property-field property-field-stacked">
                      <span>Body part</span>
                      <select
                        value={selectedCharacterPart.id}
                        onChange={(event) =>
                          setSelectedCharacterPartId(event.currentTarget.value)
                        }
                        aria-label="Character body part"
                      >
                        {selectedObject.parts.map((part) => (
                          <option key={part.id} value={part.id}>
                            {part.id
                              .slice(selectedObject.id.length + 1)
                              .replaceAll('-', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {renderCharacterPartNumberProperty('Local X', 'x')}
                    {renderCharacterPartNumberProperty('Local Y', 'y')}
                    {renderCharacterPartNumberProperty('Width', 'width', 1)}
                    {renderCharacterPartNumberProperty('Height', 'height', 1)}
                    {renderCharacterPartNumberProperty(
                      'Rotation',
                      'rotation',
                    )}
                    {renderProperty(
                      'Part fill',
                      selectedCharacterPart.fill,
                      (fill) =>
                        updateCharacterPart(selectedCharacterPart.id, {
                          fill,
                        }),
                      { type: 'color' },
                    )}
                    <button
                      className="inspector-keyframe-button"
                      onClick={addJointKeyframe}
                      type="button"
                    >
                      Add Joint Rotation Keyframe
                    </button>
                  </div>
                  <div className="character-actions">
                    <h3>Actions</h3>
                    <label className="property-field property-field-stacked">
                      <span>Reusable pose</span>
                      <select
                        value={selectedPose}
                        onChange={(event) =>
                          setSelectedPose(event.currentTarget.value)
                        }
                        aria-label="Character pose"
                      >
                        {CHARACTER_POSES.map((pose) => (
                          <option key={pose} value={pose}>
                            {pose[0].toUpperCase() + pose.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="inspector-keyframe-button"
                      onClick={applySelectedCharacterPose}
                      type="button"
                    >
                      Apply Editable Pose
                    </button>
                    <label className="property-field property-field-stacked">
                      <span>Action</span>
                      <select
                        value={selectedAction}
                        onChange={(event) =>
                          setSelectedAction(event.currentTarget.value)
                        }
                        aria-label="Character action"
                      >
                        {CHARACTER_ACTIONS.map((action) => (
                          <option key={action} value={action}>
                            {action[0].toUpperCase() + action.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="property-field property-field-stacked">
                      <span>Action sequence</span>
                      <input
                        type="text"
                        value={actionSequence}
                        onChange={(event) =>
                          setActionSequence(event.currentTarget.value)
                        }
                        aria-label="Action sequence"
                      />
                    </label>
                    <label className="property-field property-field-stacked">
                      <span>Start time (seconds)</span>
                      <input
                        type="number"
                        min="0"
                        step={1 / FRAME_RATE}
                        value={actionStartSeconds}
                        onChange={(event) =>
                          setActionStartSeconds(event.currentTarget.value)
                        }
                        aria-label="Action start time in seconds"
                      />
                    </label>
                    <label className="property-field property-field-stacked">
                      <span>Duration (seconds)</span>
                      <input
                        type="number"
                        min={1 / FRAME_RATE}
                        max={durationSeconds}
                        step={1 / FRAME_RATE}
                        value={actionDurationSeconds}
                        onChange={(event) =>
                          setActionDurationSeconds(event.currentTarget.value)
                        }
                        aria-label="Action duration in seconds"
                      />
                    </label>
                    <label className="action-checkbox">
                      <input
                        type="checkbox"
                        checked={actionLoops}
                        disabled={selectedAction === 'idle'}
                        onChange={(event) =>
                          setActionLoops(event.currentTarget.checked)
                        }
                        aria-label="Loop action"
                      />
                      <span>Loop action</span>
                    </label>
                    <label className="action-checkbox">
                      <input
                        type="checkbox"
                        checked={replaceActionKeyframes}
                        onChange={(event) =>
                          setReplaceActionKeyframes(
                            event.currentTarget.checked,
                          )
                        }
                        aria-label="Replace overlapping action keyframes"
                      />
                      <span>Replace overlapping joint keys</span>
                    </label>
                    <button
                      className="inspector-keyframe-button"
                      onClick={applySelectedCharacterAction}
                      type="button"
                    >
                      Apply Action
                    </button>
                    <button
                      className="inspector-keyframe-button"
                      onClick={applySelectedCharacterSequence}
                      type="button"
                    >
                      Apply Sequence
                    </button>
                    {actionStatus && (
                      <p className="action-status" role="status">
                        {actionStatus}
                      </p>
                    )}
                  </div>
                </>
              )}
              {selectedObject.type === 'assembly' && (
                <>
                  <label className="property-field property-field-stacked">
                    <span>Assembly name</span>
                    <input
                      type="text"
                      value={selectedObject.name}
                      onChange={(event) =>
                        updateSelectedObject({ name: event.currentTarget.value })
                      }
                    />
                  </label>
                  <div className="character-rig-properties">
                    <h3>Assembly component</h3>
                    <label className="property-field property-field-stacked">
                      <span>Component</span>
                      <select
                        value={selectedAssemblyComponent.id}
                        onChange={(event) =>
                          setSelectedCharacterPartId(event.currentTarget.value)
                        }
                        aria-label="Assembly component"
                      >
                        {selectedObject.components.map((component) => (
                          <option key={component.id} value={component.id}>
                            {component.id
                              .slice(selectedObject.id.length + 1)
                              .replaceAll('_', ' ')
                              .replaceAll('-', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    {['x', 'y', 'rotation'].map((property) =>
                      renderProperty(
                        `Local ${property.toUpperCase()}`,
                        selectedAssemblyComponent[property] ?? 0,
                        (value) => {
                          const number = Number(value);
                          if (!Number.isFinite(number)) return;
                          updateAssemblyComponent(
                            selectedAssemblyComponent.id,
                            { [property]: number },
                          );
                        },
                      ),
                    )}
                    {selectedAssemblyComponent.type === 'rectangle' &&
                      ['width', 'height'].map((property) =>
                        renderProperty(
                          property[0].toUpperCase() + property.slice(1),
                          selectedAssemblyComponent[property],
                          (value) => {
                            const number = Number(value);
                            if (!Number.isFinite(number) || number < 1) return;
                            updateAssemblyComponent(
                              selectedAssemblyComponent.id,
                              { [property]: number },
                            );
                          },
                          { min: 1 },
                        ),
                      )}
                    {selectedAssemblyComponent.type === 'circle' &&
                      renderProperty(
                        'Radius',
                        selectedAssemblyComponent.radius,
                        (value) => {
                          const number = Number(value);
                          if (!Number.isFinite(number) || number < 1) return;
                          updateAssemblyComponent(
                            selectedAssemblyComponent.id,
                            { radius: number },
                          );
                        },
                        { min: 1 },
                      )}
                    {selectedAssemblyComponent.type === 'text' && (
                      <>
                        <label className="property-field property-field-stacked">
                          <span>Component text</span>
                          <input
                            type="text"
                            value={selectedAssemblyComponent.text}
                            onChange={(event) =>
                              updateAssemblyComponent(
                                selectedAssemblyComponent.id,
                                { text: event.currentTarget.value },
                              )
                            }
                          />
                        </label>
                        {['width', 'fontSize'].map((property) =>
                          renderProperty(
                            property === 'fontSize' ? 'Font size' : 'Width',
                            selectedAssemblyComponent[property],
                            (value) => {
                              const number = Number(value);
                              if (!Number.isFinite(number) || number < 1) return;
                              updateAssemblyComponent(
                                selectedAssemblyComponent.id,
                                { [property]: number },
                              );
                            },
                            { min: 1 },
                          ),
                        )}
                      </>
                    )}
                    {renderProperty(
                      'Component fill',
                      selectedAssemblyComponent.fill,
                      (fill) =>
                        updateAssemblyComponent(
                          selectedAssemblyComponent.id,
                          { fill },
                        ),
                      { type: 'color' },
                    )}
                    <button
                      className="inspector-keyframe-button"
                      onClick={addJointKeyframe}
                      type="button"
                    >
                      Add Component Rotation Keyframe
                    </button>
                  </div>
                </>
              )}
              {selectedObject.type === 'text' && (
                <>
                  <label className="property-field property-field-stacked">
                    <span>Text</span>
                    <textarea
                      rows={3}
                      value={selectedObject.text}
                      onChange={(event) =>
                        updateSelectedObject({ text: event.currentTarget.value })
                      }
                    />
                  </label>
                  {renderNumberProperty('Font size', 'fontSize', 5)}
                  <label className="property-field">
                    <span>Alignment</span>
                    <select
                      value={selectedObject.align}
                      onChange={(event) =>
                        updateSelectedObject({ align: event.currentTarget.value })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </>
              )}
              {selectedObject.type !== 'character' &&
                selectedObject.type !== 'assembly' &&
                renderProperty(
                  'Fill',
                  selectedObject.fill,
                  (fill) => updateSelectedObject({ fill }),
                  { type: 'color' },
                )}
              <div className="animation-properties">
                <h3>Animation</h3>
                <label className="property-field property-field-stacked">
                  <span>Property to keyframe</span>
                  <select
                    value={selectedAnimatedProperty}
                    onChange={(event) =>
                      setSelectedAnimatedProperty(event.currentTarget.value)
                    }
                    aria-label="Property to keyframe"
                  >
                    {ANIMATABLE_PROPERTIES.map((property) => (
                      <option key={property} value={property}>
                        {property}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="inspector-keyframe-button"
                  onClick={addKeyframe}
                  type="button"
                >
                  Add / Update Keyframe
                </button>
                {selectedKeyframeData &&
                  selectedKeyframe?.objectId === selectedObject.id && (
                    <>
                      <label className="property-field property-field-stacked">
                        <span>
                          Easing after {selectedKeyframe.property} at frame{' '}
                          {selectedKeyframe.frame}
                        </span>
                        <select
                          value={selectedKeyframeData.easing ?? 'linear'}
                          onChange={(event) =>
                            changeSelectedKeyframeEasing(
                              event.currentTarget.value,
                            )
                          }
                          aria-label="Selected keyframe easing"
                        >
                          <option value="linear">Linear</option>
                          <option value="ease-in">Ease in</option>
                          <option value="ease-out">Ease out</option>
                          <option value="ease-in-out">Ease in/out</option>
                        </select>
                      </label>
                      <button
                        className="inspector-keyframe-button delete-keyframe-button"
                        onClick={deleteSelectedKeyframe}
                        type="button"
                      >
                        Delete Selected Keyframe
                      </button>
                    </>
                  )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <section className="timeline-panel" aria-label="Animation timeline">
        <div className="timeline-heading">
          <div className="timeline-title">
            <h2>Timeline</h2>
            <span>{FRAME_RATE} FPS</span>
            <button
              className="add-keyframe-button"
              onClick={addKeyframe}
              disabled={!selectedObject}
              type="button"
              title={
                selectedObject
                  ? `Record ${selectedObject.type} position at ${currentTime.toFixed(2)} seconds`
                  : 'Select an object to add a keyframe'
              }
            >
              Add Keyframe
            </button>
            <div className="playback-controls" role="group" aria-label="Playback controls">
              <button
                className="playback-button"
                onClick={goToStart}
                type="button"
                aria-label="Go to start"
                title="Go to start"
              >
                |◀
              </button>
              <button
                className="playback-button playback-toggle"
                onClick={
                  playbackState === 'playing' ? pausePlayback : startPlayback
                }
                type="button"
                aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
                title={playbackState === 'playing' ? 'Pause' : 'Play'}
              >
                {playbackState === 'playing' ? 'Ⅱ' : '▶'}
              </button>
              <button
                className="playback-button"
                onClick={stopPlayback}
                type="button"
                aria-label="Stop"
                title="Stop"
              >
                ■
              </button>
            </div>
            <output className="playback-time" aria-live="off">
              {formatTime(currentTime)} / {formatTime(durationSeconds)}
            </output>
          </div>
          <label className="duration-control">
            <span>Duration</span>
            <input
              type="number"
              min="1"
              max="600"
              step="0.5"
              value={durationSeconds}
              onChange={(event) => changeDuration(event.currentTarget.value)}
              aria-label="Animation duration in seconds"
            />
            <span>sec</span>
          </label>
          <label className="current-time-control">
            <span>Current time</span>
            <input
              type="number"
              min="0"
              max={durationSeconds}
              step={1 / FRAME_RATE}
              value={Number(currentTime.toFixed(3))}
              onChange={(event) =>
                setTimelineTime(Number(event.currentTarget.value) || 0)
              }
              aria-label="Current time in seconds"
            />
            <span>s</span>
          </label>
        </div>

        <div className="timeline-body">
          <div className="track-label-column">
            <div className="track-label-header">OBJECTS</div>
            {timelineRows.map((row) => (
              <button
                className={`track-label${row.objectId === selectedObjectId && (!row.partId || row.partId === selectedCharacterPartId) ? ' selected' : ''}${row.partId ? ' part-track-label' : ''}`}
                key={`${row.objectId}-${row.partId ?? 'root'}`}
                onClick={() => {
                  setSelectedObjectId(row.objectId);
                  setSelectedCharacterPartId(row.partId);
                  setSelectedKeyframe(null);
                }}
                type="button"
              >
                <span className={`track-type-icon ${row.type}`} />
                <span>{row.label}</span>
              </button>
            ))}
            {timelineRows.length === 0 && (
              <div className="track-label-empty">No objects</div>
            )}
          </div>

          <div
            className="timeline-scroll"
            ref={timelineViewportRef}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerCancel={handleTimelinePointerUp}
            role="group"
            aria-label="Timeline ruler and tracks. Click or drag to scrub."
          >
            <div
              className="timeline-content"
              style={{ width: timelineWidth }}
            >
              <div className="timeline-ruler">
                {Array.from(
                  { length: Math.floor(durationSeconds) + 1 },
                  (_, second) => (
                  <div
                    className="ruler-tick"
                    key={second}
                    style={{ left: `${second * PIXELS_PER_SECOND}px` }}
                  >
                    <span>{second}s</span>
                  </div>
                  ),
                )}
                {durationSeconds % 1 !== 0 && (
                  <div
                    className="ruler-tick"
                    style={{ left: `${timelineWidth}px` }}
                  >
                    <span>{durationSeconds}s</span>
                  </div>
                )}
              </div>
              <div className="timeline-tracks">
                {timelineRows.map((row) => (
                  <div
                    className={`timeline-track${row.objectId === selectedObjectId && (!row.partId || row.partId === selectedCharacterPartId) ? ' selected' : ''}`}
                    data-track-id={row.objectId}
                    key={`${row.objectId}-${row.partId ?? 'root'}`}
                    onClick={() => {
                      setSelectedObjectId(row.objectId);
                      setSelectedCharacterPartId(row.partId);
                      setSelectedKeyframe(null);
                    }}
                    role="group"
                    aria-label={`Select ${row.label} track`}
                  >
                    <span
                      className="track-grid"
                      style={{
                        backgroundSize: `${PIXELS_PER_SECOND}px 100%`,
                      }}
                    />
                    {ANIMATABLE_PROPERTIES.flatMap((property, propertyIndex) =>
                      (row.keyframes?.[property] ?? []).map((keyframe) => {
                        const isSelected =
                          selectedKeyframe?.objectId === row.objectId &&
                          selectedKeyframe?.partId === row.partId &&
                          selectedKeyframe.property === property &&
                          selectedKeyframe.frame === keyframe.frame;
                        const markerFrame =
                          keyframeDragRef.current?.objectId === row.objectId &&
                          keyframeDragRef.current?.partId === row.partId &&
                          keyframeDragRef.current.property === property &&
                          keyframeDragRef.current.fromFrame === keyframe.frame &&
                          draggedKeyframeFrame !== null
                            ? draggedKeyframeFrame
                            : keyframe.frame;

                        return (
                          <button
                            className={`keyframe-marker${row.partId ? ' character-keyframe-marker' : ''}${isSelected ? ' selected' : ''}`}
                            key={`${property}-${keyframe.frame}`}
                            data-keyframe-marker
                            style={{
                              left: `${(markerFrame / FRAME_RATE) * PIXELS_PER_SECOND}px`,
                              top: `${((propertyIndex + 0.5) / ANIMATABLE_PROPERTIES.length) * 100}%`,
                            }}
                            onPointerDown={(event) =>
                              handleKeyframePointerDown(
                                event,
                                row.objectId,
                                row.partId,
                                property,
                                keyframe.frame,
                              )
                            }
                            onPointerMove={handleKeyframePointerMove}
                            onPointerUp={finishKeyframeDrag}
                            onPointerCancel={finishKeyframeDrag}
                            onClick={(event) =>
                              handleKeyframeClick(
                                event,
                                row.objectId,
                                row.partId,
                                property,
                                keyframe.frame,
                              )
                            }
                            type="button"
                            aria-label={`Select ${property} keyframe at ${(keyframe.frame / FRAME_RATE).toFixed(2)} seconds for ${row.label}`}
                            title={`${row.label} ${property}: ${(keyframe.frame / FRAME_RATE).toFixed(2)}s, ${keyframe.value}`}
                          />
                        );
                      }),
                    )}
                  </div>
                ))}
                {objects.length === 0 && (
                  <div className="timeline-empty">
                    Add an object to create a timeline track.
                  </div>
                )}
              </div>
              <div
                className="timeline-playhead"
                style={{
                left: `${currentTime * PIXELS_PER_SECOND}px`,
                }}
                aria-hidden="true"
              >
                <span className="playhead-cap" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="statusbar">
        <span>
          Stage <strong>{STAGE_WIDTH} × {STAGE_HEIGHT}</strong>
        </span>
        <span>
          {objects.length} {objects.length === 1 ? 'object' : 'objects'}
        </span>
      </footer>
    </main>
  );
}

export default App;
