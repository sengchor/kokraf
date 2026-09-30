const describeCommand = (cmd) =>
  cmd ? (cmd.name ?? cmd.type ?? cmd.constructor?.name ?? 'Unknown') : null;

export const redoSpec = {
  description:
    'Redo action(s) that were just undone, exactly like pressing Ctrl+Shift+Z in the editor. ' +
    'The redo history is shared with the user and is cleared as soon as any new action is made, ' +
    'so redo must happen before making other changes. ' +
    'The result lists the names of the redone actions (in the order they were reapplied) and the next ' +
    'action that would be redone, so you can check you restored what you meant to.',
  mutates: true,
  params: {
    steps: {
      type: 'number',
      default: 1,
      description: 'Number of actions to redo. Stops early if there is nothing left to redo.',
    },
  },
  run({ steps }, editor) {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new Error(`steps must be a positive integer, got ${steps}.`);
    }

    const history = editor.history;
    const redone = [];

    while (redone.length < steps && history.redos.length > 0) {
      const cmd = history.redos[history.redos.length - 1];
      try {
        editor.redo();
      } catch (err) {
        throw new Error(
          `Redo of "${describeCommand(cmd)}" failed after ${redone.length} successful step(s): ${err.message}`
        );
      }
      redone.push(describeCommand(cmd));
    }

    return {
      stepsRequested: steps,
      stepsRedone: redone.length,
      redone,
      nextRedo: describeCommand(history.redos[history.redos.length - 1]),
      undoAvailable: history.undos.length,
      redoAvailable: history.redos.length,
      currentMode: editor.modeManager.currentMode,
      editedObjectUuid:  editor.editSelection.editedObject?.uuid ?? null,
    };
  },
};