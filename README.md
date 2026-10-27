# Animator

React, Vite, and Konva 2D animation editor with a server-side AI animation planner.

## Run locally

Use Node.js 18 or newer, then install dependencies and start Vite:

```sh
npm install
npm run dev
```

AI planning supports OpenAI and OpenRouter. Configure a provider key in the
server process environment; it is never placed in frontend variables or sent
to the browser. For OpenRouter, use a fresh key stored locally in the server
environment, and explicitly select the provider:

PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "your-new-key"
$env:LLM_PROVIDER = "openrouter"
# Optional; this is the default OpenRouter model.
$env:OPENROUTER_MODEL = "openai/gpt-4o-mini"
npm run dev
```

POSIX shell:

```sh
LLM_PROVIDER="openrouter" OPENROUTER_API_KEY="your-new-key" npm run dev
```

OpenRouter uses `https://openrouter.ai/api/v1/chat/completions`; set
`OPENROUTER_MODEL` to another model ID available to your account. If
`LLM_PROVIDER` is omitted, the server selects OpenRouter when
`OPENROUTER_API_KEY` is present; otherwise it uses OpenAI. For direct OpenAI
use, set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`; its default model is
`gpt-4o-mini`, configurable with `OPENAI_MODEL`. Without a key, the editor
remains usable and the AI panel reports which provider key is missing.
If AI generation reports `Failed to fetch`, the editor cannot reach its local
planning endpoint. Start or restart `npm run dev`, open the local URL printed
by Vite (normally `http://localhost:5173/`), and refresh the page. A missing
API key is a separate server response; set the provider's key in the same
terminal before starting the development server.
If the planner reports HTTP 401 or 403, the provider rejected the key. Revoke
any key shared in chat, create a replacement in the provider dashboard, set
the matching environment variable, and restart Vite. Do not paste keys into
chat or commit them to the project.

For a production build, run `npm run build`, then `npm start`. The Node server
serves `dist/` and the same protected `/api/generate-plan` endpoint. Set
`PORT` to change its default port of 4173.

## Scene construction and AI boundaries

The model only proposes a reviewable JSON plan using the existing validated
animation tools. The browser validates the entire plan against a temporary
project copy, and applies it to editor state only after explicit approval and
successful validation of every operation. If provider output fails tool
validation, the server makes at most two bounded correction requests using the
validation error and still returns a plan only after all operations validate.
Failed or exhausted attempts leave the project unchanged.

Scene primitives are rectangles, circles, and text. Editable assemblies can
combine these components with local positions, rotation, scale, opacity,
parent-child relationships, and component keyframes. Registered starter
templates include trees, clouds, houses, benches, tables, chairs, and a
primitive bicycle silhouette. Developers can extend these templates using
`registerObjectTemplate` in `src/objectTemplates.js`; the planner discovers the
registered template IDs when it builds its capability prompt.

Available construction tools include `add_object`, `create_assembly`,
`create_template`, `group_objects`, `ungroup_assembly`,
`set_component_property`, `set_component_parent`, `duplicate_object`,
`delete_object`, and `reorder_layer`. Relationship tools include
`define_anchor`, `inspect_anchors`, `attach_object`, `detach_object`, and
`validate_relationships`. Reusable standing, sitting, walking, waving, and
riding poses are written as editable character-part keyframes using
`apply_character_pose`; they are keyframed joint postures, not specialized
physics or pedal coupling. Additional joint-rotation presets can be registered
with `registerCharacterPose` in `src/characterActions.js`. Root and component
transforms use the same keyframe evaluator; assembly components rotate around their local origins, and
parented components retain their relative transforms. The bicycle template has
editable spokes, a seat anchor, and pedals parented to a rotatable crank.
Attached objects inherit the parent's animated transform and can be animated
relative to the named anchor. An object with existing root transform
keyframes must have those keys removed or baked before it can be attached.
Deleting a parent with attached children is rejected until they are detached.
The plan executor adds direct `dependsOn` edges when an operation references an
object or component created by an earlier step. Resources must still be created
before use, and missing references fail validation. All steps run against a
working copy and only the complete result can be applied. Plans are limited to
50 operations and prompts to 4,000 characters.

Templates are editable primitive assemblies, not specialized geometry or
rigging. Wheel and crank rotations can be keyed, and the crank carries its
pedals, but wheel rotation is not automatically coupled to travel and a
character's legs are not automatically coupled to the pedals. Detaching an
object with root transform keyframes is rejected until those keys are removed
or baked. Ungrouping currently accepts only unanimated assemblies with zero
root rotation, unit root scale, and unanimated, unparented components.
The riding posture is illustrative, not a specialized bicycle rig, and leg
motion is not coupled to pedals. Camera animation is not implemented. The
planner reports these limitations when requested rather than implying they are
supported.
Unsupported requests must be reported rather than described as completed.

The read-only `analyze_scene_quality` tool checks evaluated geometry at a chosen
frame or across keyframes and intermediate timeline samples. It reports
out-of-stage objects, disconnected character/assembly components, substantial
overlap candidates, abrupt transform changes, and violations of explicitly
declared `depthRole` ordering (`background`, `midground`, `foreground`).
Overlap thresholds are configurable; containment is ignored to avoid treating
backgrounds as errors. These are geometry heuristics, not semantic judgments:
overlap may be intentional, and layering is checked only when roles are
declared. The AI plan review shows warnings and previews generated or repaired
projects on the stage without modifying editor state. A separate repair request
may propose at most one validated repair plan; it runs on a project copy and
can be applied only after review. The analyzer remains read-only and repair
failures leave the original untouched.

Character part positions are joint-local, with optional shape offsets
positioning rendered geometry away from each joint pivot. These offsets persist,
and older projects without them remain valid.

## Artwork assets

Import transparent PNG, WebP, or SVG files from **Import artwork**, then choose
an item in the artwork library and select **Add to stage**. Each placed image is
an independent scene object that can be selected, moved, resized, rotated,
layered, animated, and replaced with another imported asset. The image bytes
are embedded in the project file, so saved projects do not depend on external
file paths. Older project files without an `assets` collection load with an
empty artwork library.

Each source file is limited to 2 MB, a project can contain up to 100 assets, and
the combined embedded source data is limited to 8 MB. Project files up to 15 MB
can be loaded; browser local-storage quotas may be lower, in which case the
editor reports the autosave failure while keeping project download available.
SVG imports allow static vector artwork and local fragment references only;
scripts, event handlers, external resources, animation elements, embedded media,
and other active content are rejected.

The AI planner receives each imported asset's ID, name, format, and dimensions,
not its image data. It may use `add_image_object` to place only an existing
library asset; it cannot import files, synthesize artwork, or invent asset IDs.
