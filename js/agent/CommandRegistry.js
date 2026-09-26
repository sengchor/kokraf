const TYPE_CHECKS = {
  any: () => true,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  vec3: (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)),
  'string[]': (v) => Array.isArray(v) && v.every((s) => typeof s === 'string'),
  'number[]': (v) => Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n)),
};

function typeNames(type) {
  return Array.isArray(type) ? type : String(type).split('|');
}

function matchesType(value, type) {
  return typeNames(type).some((name) => {
    const check = TYPE_CHECKS[name.trim()];
    if (!check) throw new Error(`CommandRegistry: unknown param type "${name}"`);
    return check(value);
  });
}

function cloneDefault(value) {
  return Array.isArray(value) ? value.slice() : value;
}

export class CommandRegistry {
  constructor(editor) {
    this.editor = editor;
    this.commands = new Map();
  }

  define(name, definition) {
    if (this.commands.has(name)) {
      throw new Error(`CommandRegistry: "${name}" is already defined`);
    }
    if (typeof definition?.run !== 'function') {
      throw new Error(`CommandRegistry: "${name}" needs a run() function`);
    }

    this.commands.set(name, {
      name,
      description: definition.description ?? '',
      params: definition.params ?? {},
      mutates: definition.mutates ?? false,
      run: definition.run,
    });

    return this;
  }

  has(name) {
    return this.commands.has(name);
  }

  list() {
    return [...this.commands.values()].map(({ name, description, params, mutates }) => ({
      name,
      description,
      mutates,
      params,
    }));
  }

  async execute(name, rawParams = {}) {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error(`Unknown command "${name}". Available: ${[...this.commands.keys()].join(', ')}`);
    }

    const params = this._validate(command, rawParams ?? {});
    return await command.run(params, this.editor);
  }

  _validate(command, raw) {
    const schema = command.params;

    for (const key of Object.keys(raw)) {
      if (!(key in schema)) {
        const valid = Object.keys(schema).join(', ') || '(none)';
        throw new Error(`${command.name}: unknown parameter "${key}". Valid parameters: ${valid}`);
      }
    }

    const out = {};

    for (const [key, spec] of Object.entries(schema)) {
      const value = raw[key];

      if (value === undefined || value === null) {
        if ('default' in spec) {
          out[key] = cloneDefault(spec.default);
          continue;
        }
        if (spec.optional) {
          out[key] = undefined;
          continue;
        }
        throw new Error(`${command.name}: missing required parameter "${key}"`);
      }

      if (spec.type && !matchesType(value, spec.type)) {
        throw new Error(
          `${command.name}: parameter "${key}" must be ${typeNames(spec.type).join(' or ')}, got ${JSON.stringify(value)}`
        );
      }

      if (spec.enum && !spec.enum.includes(value)) {
        throw new Error(`${command.name}: parameter "${key}" must be one of ${spec.enum.join(', ')}`);
      }

      out[key] = value;
    }

    return out;
  }
}