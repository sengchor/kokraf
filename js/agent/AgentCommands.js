import * as THREE from 'three';
import { MODES } from '../core/ModeManager.js';
import { sceneOutlineSpec } from './commands/AgentSceneOutline.js';
import { viewportCaptureSpec } from './commands/AgentViewportCapture.js';
import { meshInspectSpec } from './commands/AgentMeshInspect.js';
import { undoSpec } from './commands/AgentUndo.js';
import { redoSpec } from './commands/AgentRedo.js';
import { objectPickSpec } from './commands/AgentObjectPick.js';
import { objectSelectSpec } from './commands/AgentObjectSelection.js';
import { objectAddMeshSpec } from './commands/AgentAddMesh.js';
import { objectTransformSpec } from './commands/AgentObjectTransform.js';
import { editPickSpec } from './commands/AgentEditPick.js';
import { editSelectSpec } from './commands/AgentEditSelection.js';
import { editTransformSpec } from './commands/AgentEditTransform.js';
import { editExtrudeSpec} from './commands/AgentEditExtrude.js';
import { editLoopCutSpec } from './commands/AgentEditLoopCut.js';
import { editKnifeSpec } from './commands/AgentEditKnife.js';
import { editInsetSpec } from './commands/AgentEditInset.js';
import { editBevelSpec } from './commands/AgentEditBevel.js';
import { editEdgeSlideSpec } from './commands/AgentEditEdgeSlide.js';
import { editSelectLinkedSpec } from './commands/AgentEditSelectLinked.js';

function defineModeCommand(registry, name, { prepare, run, ...spec }) {
  const mode = name.split('.')[0];
  if (!MODES[mode]) {
    throw new Error(`defineModeCommand: "${name}" prefix "${mode}" is not an editor mode.`);
  }

  return registry.define(name, {
    ...spec,
    mode,
    run(params, editor) {
      const ctx = prepare ? prepare(params, editor) ?? {} : {};
      const modeSwitched = editor.modeManager.switchTo(mode, ctx.modeTarget ?? null);
      const result = run(params, editor, ctx);
      return { mode, modeSwitched, ...result };
    },
  });
}

export function registerAgentCommands(registry) {
  registry.define('scene.outline', sceneOutlineSpec);
  registry.define('viewport.capture', viewportCaptureSpec);
  registry.define('mesh.inspect', meshInspectSpec);
  registry.define('editor.undo', undoSpec);
  registry.define('editor.redo', redoSpec);

  defineModeCommand(registry, 'object.pick', objectPickSpec);
  defineModeCommand(registry, 'object.select', objectSelectSpec);
  defineModeCommand(registry, 'object.addMesh', objectAddMeshSpec);
  defineModeCommand(registry, 'object.transform', objectTransformSpec);
  defineModeCommand(registry, 'edit.pick', editPickSpec);
  defineModeCommand(registry, 'edit.select', editSelectSpec);
  defineModeCommand(registry, 'edit.selectLinked', editSelectLinkedSpec);
  defineModeCommand(registry, 'edit.transform', editTransformSpec);
  defineModeCommand(registry, 'edit.extrude', editExtrudeSpec);
  defineModeCommand(registry, 'edit.loopCut', editLoopCutSpec);
  defineModeCommand(registry, 'edit.knife', editKnifeSpec);
  defineModeCommand(registry, 'edit.inset', editInsetSpec);
  defineModeCommand(registry, 'edit.bevel', editBevelSpec);
  defineModeCommand(registry, 'edit.edgeSlide', editEdgeSlideSpec);

  return registry;
}