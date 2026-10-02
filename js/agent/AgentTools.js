const TYPE_SCHEMAS = {
  any: {},
  number: { type: 'number' },
  string: { type: 'string' },
  boolean: { type: 'boolean' },
  object: { type: 'object' },
  vec3: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  'string[]': { type: 'array', items: { type: 'string' } },
  'number[]': { type: 'array', items: { type: 'number' } },
};

function schemaForSpec(spec) {
  let schema;

  if (spec.enum) {
    schema = { enum: spec.enum };
  } else {
    const names = Array.isArray(spec.type) ? spec.type : String(spec.type ?? 'any').split('|');
    const parts = names.map((name) => ({ ...(TYPE_SCHEMAS[name.trim()] ?? {}) }));
    schema = parts.length === 1 ? parts[0] : { anyOf: parts };
  }

  // Defaults stay in CommandRegistry._validate; the model only needs to know them.
  const notes = [spec.description];
  if ('default' in spec) notes.push(`Default: ${JSON.stringify(spec.default)}.`);
  const description = notes.filter(Boolean).join(' ');
  if (description) schema.description = description;

  return schema;
}

// Tool names can't contain dots: "scene.outline" -> "scene_outline".
export const toolNameFor = (command) => command.replace(/[^a-zA-Z0-9_-]/g, '_');

export function buildTools(registry) {
  const tools = [];
  const commandByTool = new Map();

  for (const command of registry.list()) {
    const name = toolNameFor(command.name);
    commandByTool.set(name, command.name);

    const properties = {};
    const required = [];
    for (const [key, spec] of Object.entries(command.params ?? {})) {
      properties[key] = schemaForSpec(spec);
      if (!('default' in spec) && !spec.optional) required.push(key);
    }

    const base = command.description || command.name;
    tools.push({
      name,
      description: command.mutates ? `${base} (Modifies the scene; undoable.)` : base,
      // _validate rejects unknown keys, so say so in the schema too.
      input_schema: { type: 'object', properties, required, additionalProperties: false },
    });
  }

  return {
    tools,
    commandFor: (toolName) => commandByTool.get(toolName) ?? null,
  };
}

export function toToolResult(toolUseId, result, isError = false) {
  // Same image convention as the MCP server's resultToContent.
  if (!isError && result && typeof result === 'object' && result.__image) {
    const { data, mimeType = 'image/png', caption } = result.__image;
    const content = [{ type: 'image', source: { type: 'base64', media_type: mimeType, data } }];
    if (caption) content.push({ type: 'text', text: caption });
    return { type: 'tool_result', tool_use_id: toolUseId, content };
  }

  // Size limits are applied by the claude-agent edge function.
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2);

  return { type: 'tool_result', tool_use_id: toolUseId, content: text, ...(isError && { is_error: true }) };
}