var DECLARATION, IGNORE_DIRS, composePackageSchema, declarations, effectiveSchemaPath, fs, mergeEnum, mergeModel, modelMembers, normalize, path, schemaSources;

fs = require('fs');

path = require('path');

IGNORE_DIRS = new Set(['node_modules', '.git', '.logos', '.svelte-cache', '.snapshots', '.database', 'dist', 'data', 'uploads', 'profiles', 'secrets', 'generated', 'backups', 'snapshots', 'sessions', 'shared-cache']);

DECLARATION = /\b(model|enum|type|view|datasource|generator)\s+([A-Za-z_]\w*)\s*\{/g;

normalize = function(value) {
  return value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
};

declarations = function(text, source, primary) {
  var char, cursor, depth, match, open, quote, raw, result;
  result = [];
  DECLARATION.lastIndex = 0;
  while (match = DECLARATION.exec(text)) {
    open = text.indexOf('{', match.index);
    depth = 1;
    cursor = open + 1;
    quote = '';
    while (cursor < text.length && depth > 0) {
      char = text[cursor];
      if (quote) {
        if (char === '\\') {
          cursor++;
        } else if (char === quote) {
          quote = '';
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
      cursor++;
    }
    if (depth !== 0) {
      throw new Error(`DB_SCHEMA_UNCLOSED_DECLARATION:${source}:${match[1]}:${match[2]}`);
    }
    raw = text.slice(match.index, cursor).trim();
    result.push({
      kind: match[1],
      name: match[2],
      header: `${match[1]} ${match[2]}`,
      body: text.slice(open + 1, cursor - 1),
      raw,
      source,
      primary
    });
    DECLARATION.lastIndex = cursor;
  }
  return result;
};

modelMembers = function(body) {
  var existing, i, key, len, line, members, raw, ref;
  members = new Map();
  ref = body.split(/\r?\n/);
  for (i = 0, len = ref.length; i < len; i++) {
    raw = ref[i];
    line = raw.trim();
    if (!line || line.startsWith('//')) {
      continue;
    }
    key = line.startsWith('@@') ? normalize(line) : line.split(/\s+/)[0];
    existing = members.get(key);
    if (existing && normalize(existing) !== normalize(line)) {
      throw new Error(`DB_SCHEMA_DUPLICATE_MEMBER:${key}`);
    }
    members.set(key, line);
  }
  return members;
};

mergeModel = function(base, incoming) {
  var body, current, line, name, origins, ref, ref1, ref2, target, x;
  target = modelMembers(base.body);
  origins = (ref = base.memberOrigins) != null ? ref : new Map(Array.from(target.keys()).map(function(name) {
    return [
      name,
      {
        source: base.source,
        primary: base.primary
      }
    ];
  }));
  for (x of modelMembers(incoming.body)) {
    [name, line] = x;
    current = target.get(name);
    if (!current) {
      target.set(name, line);
      origins.set(name, {
        source: incoming.source,
        primary: incoming.primary
      });
    } else if (normalize(current) !== normalize(line) && !((ref1 = origins.get(name)) != null ? ref1.primary : void 0)) {
      throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${base.kind}:${base.name}:${name}:${(ref2 = origins.get(name)) != null ? ref2.source : void 0}:${incoming.source}`);
    }
  }
  body = Array.from(target.values()).map(function(line) {
    return `  ${line}`;
  }).join('\n');
  return {
    ...base,
    body,
    raw: `${base.header} {\n${body}\n}`,
    memberOrigins: origins
  };
};

mergeEnum = function(base, incoming) {
  var body, i, j, len, len1, line, raw, ref, ref1, values;
  values = new Map();
  ref = [base.body, incoming.body];
  for (i = 0, len = ref.length; i < len; i++) {
    body = ref[i];
    ref1 = body.split(/\r?\n/);
    for (j = 0, len1 = ref1.length; j < len1; j++) {
      raw = ref1[j];
      line = raw.trim();
      if (line && !line.startsWith('//')) {
        values.set(normalize(line), line);
      }
    }
  }
  body = Array.from(values.values()).map(function(line) {
    return `  ${line}`;
  }).join('\n');
  return {
    ...base,
    body,
    raw: `${base.header} {\n${body}\n}`
  };
};

schemaSources = function(packageDir) {
  var found, primary, visit;
  found = [];
  visit = function(dir) {
    var entry, full, i, len, ref;
    ref = fs.readdirSync(dir, {
      withFileTypes: true
    });
    for (i = 0, len = ref.length; i < len; i++) {
      entry = ref[i];
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      full = path.join(dir, entry.name);
      if (entry.isDirectory() && !fs.existsSync(path.join(full, 'package.json'))) {
        visit(full);
      } else if (entry.isFile() && /\.(prisma|scriba|schema)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  visit(packageDir);
  primary = path.join(packageDir, 'schema.prisma');
  return found.sort(function(a, b) {
    if (a === primary) {
      return -1;
    } else if (b === primary) {
      return 1;
    } else {
      return a.localeCompare(b);
    }
  });
};

effectiveSchemaPath = function(packageDir) {
  return path.join(packageDir, '.logos', 'generated', 'db', 'schema.prisma');
};

composePackageSchema = function(packageDir) {
  var banner, current, declaration, i, j, key, len, len1, merged, outputPath, primary, primaryPath, ref, ref1, schema, source, sources, temporary;
  sources = schemaSources(packageDir);
  if (!sources.length) {
    return null;
  }
  primaryPath = path.join(packageDir, 'schema.prisma');
  merged = new Map();
  for (i = 0, len = sources.length; i < len; i++) {
    source = sources[i];
    primary = source === primaryPath;
    ref = declarations(fs.readFileSync(source, 'utf8'), path.relative(packageDir, source), primary);
    for (j = 0, len1 = ref.length; j < len1; j++) {
      declaration = ref[j];
      key = `${declaration.kind}:${declaration.name}`;
      current = merged.get(key);
      if (!current) {
        merged.set(key, declaration);
      } else if ((ref1 = declaration.kind) === 'model' || ref1 === 'type' || ref1 === 'view') {
        merged.set(key, mergeModel(current, declaration));
      } else if (declaration.kind === 'enum') {
        merged.set(key, mergeEnum(current, declaration));
      } else if (normalize(current.raw) !== normalize(declaration.raw) && !current.primary) {
        throw new Error(`DB_SCHEMA_FRAGMENT_CONFLICT:${key}:${current.source}:${declaration.source}`);
      }
    }
  }
  banner = `// Generated by Logos from: ${sources.map(function(source) {
    return path.relative(packageDir, source);
  }).join(', ')}\n// Do not edit this file directly.\n\n`;
  schema = banner + Array.from(merged.values()).map(function(item) {
    return item.raw;
  }).join('\n\n') + '\n';
  outputPath = effectiveSchemaPath(packageDir);
  fs.mkdirSync(path.dirname(outputPath), {
    recursive: true
  });
  temporary = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, schema, 'utf8');
  fs.renameSync(temporary, outputPath);
  return {schema, outputPath, sources};
};

Object.defineProperty(exports, '__esModule', {
  value: true
});

Object.assign(exports, {effectiveSchemaPath, composePackageSchema});
