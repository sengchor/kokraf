import { SetPositionCommand } from './SetPositionCommand.js';
import { SetRotationCommand } from './SetRotationCommand.js';
import { SetScaleCommand } from './SetScaleCommand.js';
import { AddObjectCommand } from './AddObjectCommand.js';
import { RemoveObjectCommand } from './RemoveObjectCommand.js';
import { MoveObjectCommand } from './MoveObjectCommand.js';
import { SetValueCommand } from './SetValueCommand.js';
import { SetColorCommand } from './SetColorCommand.js';
import { SetShadowValueCommand } from './SetShadowValueCommand.js';
import { SetMaterialValueCommand } from './SetMaterialValueCommand.js';
import { SetMaterialColorCommand } from './SetMaterialColorCommand.js';
import { SetVertexPositionCommand } from './SetVertexPositionCommand.js';
import { SwitchModeCommand } from './SwitchModeCommand.js';
import { SetShadingCommand } from './SetShadingCommand.js';
import { ExtrudeCommand } from './ExtrudeCommand.js';
import { CreateFaceCommand } from './CreateFaceCommand.js';
import { DeleteSelectionCommand } from './DeleteSelectionCommand.js';
import { SeparateSelectionCommand } from './SeparateSelectionCommand.js';
import { LoopCutCommand } from './LoopCutCommand.js';
import { KnifeCommand } from './KnifeCommand.js';
import { SwitchSubModeCommand } from './SwitchSubModeCommand.js';
import { MultiCommand } from './MultiCommand.js';
import { JoinObjectsCommand } from './JoinObjectsCommand.js';
import { SequentialMultiCommand } from './SequentialMultiCommand.js';

export const commands = new Map([
  [SetPositionCommand.type, SetPositionCommand],
  [SetRotationCommand.type, SetRotationCommand],
  [SetScaleCommand.type, SetScaleCommand],
  [AddObjectCommand.type, AddObjectCommand],
  [RemoveObjectCommand.type, RemoveObjectCommand],
  [MoveObjectCommand.type, MoveObjectCommand],
  [SetValueCommand.type, SetValueCommand],
  [SetColorCommand.type, SetColorCommand],
  [SetShadowValueCommand.type, SetShadowValueCommand],
  [SetMaterialValueCommand.type, SetMaterialValueCommand],
  [SetMaterialColorCommand.type, SetMaterialColorCommand],
  [SetVertexPositionCommand.type, SetVertexPositionCommand],
  [SwitchModeCommand.type, SwitchModeCommand],
  [SetShadingCommand.type, SetShadingCommand],
  [ExtrudeCommand.type, ExtrudeCommand],
  [CreateFaceCommand.type, CreateFaceCommand],
  [DeleteSelectionCommand.type, DeleteSelectionCommand],
  [SeparateSelectionCommand.type, SeparateSelectionCommand],
  [LoopCutCommand.type, LoopCutCommand],
  [KnifeCommand.type, KnifeCommand],
  [SwitchSubModeCommand.type, SwitchSubModeCommand],
  [MultiCommand.type, MultiCommand],
  [JoinObjectsCommand.type, JoinObjectsCommand],
  [SequentialMultiCommand.type, SequentialMultiCommand],
]);