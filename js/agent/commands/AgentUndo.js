const describeCommand = (cmd) =>
  cmd ? (cmd.name ?? cmd.type ?? cmd.constructor?.name ?? 'Unknown') : null;

export const undoSpec = {
  description:
    'Undo the most recent editor action(s), exactly like pressing Ctrl+Z in the editor. ' +
    'The undo history is shared with the user, so this reverts whatever was done last, ' +
    'whether by you or by the user. Use it to back out of your own mistake right after making it. ' +
    'The history only keeps a limited number of recent actions. ' +
    'The result lists the names of the undone actions (most recent first) and the next action ' +
    'that would be undone, so you can check you reverted what you meant to.',
  mutates: true,
  params: {
    steps: {
      type: 'number',
      default: 1,
      description: 'Number of actions to undo. Stops early if the history runs out.',
    },
  },
  run({ steps }, editor) {
    if (!Number.isInteger(steps) || steps < 1) {
      throw new Error(`steps must be a positive integer, got ${steps}.`);
    }

    const history = editor.history;
    const undone = [];

    while (undone.length < steps && history.undos.length > 0) {
      const cmd = history.undos[history.undos.length - 1];
      try {
        editor.undo();
      } catch (err) {
        throw new Error(
          `Undo of "${describeCommand(cmd)}" failed after ${undone.length} successful step(s): ${err.message}`
        );
      }
      undone.push(describeCommand(cmd));
    }

    return {
      stepsRequested: steps,
      stepsUndone: undone.length,
      undone,
      nextUndo: describeCommand(history.undos[history.undos.length - 1]),
      undoAvailable: history.undos.length,
      redoAvailable: history.redos.length,
      currentMode: editor.modeManager.currentMode,
      editedObjectUuid: editor.editSelection.editedObject?.uuid ?? null,
    };
  },
};