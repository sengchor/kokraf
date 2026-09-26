import * as THREE from 'three';
import { MODES } from '../core/ModeManager.js';
import { sceneOutlineSpec } from './commands/AgentSceneOutline.js';
import { viewportCaptureSpec } from './commands/AgentViewportCapture.js';
import { objectAddMeshSpec } from './commands/AgentAddMesh.js';
import { objectTransformSpec } from './commands/AgentObjectTransform.js';
import { editSelectSpec } from './commands/AgentSelection.js';
import { editTransformSpec } from './commands/AgentEditTransform.js';

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

  defineModeCommand(registry, 'object.addMesh', objectAddMeshSpec);
  defineModeCommand(registry, 'object.transform', objectTransformSpec);
  defineModeCommand(registry, 'edit.select', editSelectSpec);
  defineModeCommand(registry, 'edit.transform', editTransformSpec);

  return registry;
}