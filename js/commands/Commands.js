import { SetPositionCommand } from './SetPositionCommand.js';
import { SetRotationCommand } from './SetRotationCommand.js';
import { SetScaleCommand } from './SetScaleCommand.js';
import { AddObjectCommand } from './AddObjectCommand.js';
import { RemoveObjectCommand } from './RemoveObjectCommand.js';
import { MoveObjectCommand } from './MoveObjectCommand.js';
import { SetValueCommand } from './SetValueCommand.js';

export const commands = new Map([
  [SetPositionCommand.type, SetPositionCommand],
  [SetRotationCommand.type, SetRotationCommand],
  [SetScaleCommand.type, SetScaleCommand],
  [AddObjectCommand.type, AddObjectCommand],
  [RemoveObjectCommand.type, RemoveObjectCommand],
  [MoveObjectCommand.type, MoveObjectCommand],
  [SetValueCommand.type, SetValueCommand]
]);