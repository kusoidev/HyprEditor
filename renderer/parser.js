const LIST_KEYS = new Set([
  "bind",
  "binde",
  "bindm",
  "bindl",
  "bindr",
  "bindc",
  "bindg",
  "bindd",
  "bindk",
  "unbind",
  "submap",
  "exec-once",
  "exec",
  "env",
  "monitor",
  "workspace",
  "windowrule",
  "windowrulev2",
  "layerrule",
  "source",
  "animation",
  "bezier",
  "permission",
  "gesture",
  "device",
  "touchdevice",
  "tablet",
]);

export function parseConfig(text) {
  const rawLines = text.split('\n');
  const root = { _type: 'section', _children: {}, _lists: {}, _path: [] };
  const sectionStack = [root];

  rawLines.forEach((rawLine, lineIdx) => {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) return;

    const clean = line.split('#')[0].trim();
    if (!clean) return;

    if (clean.endsWith('{')) {
      const name = clean.slice(0, -1).trim().toLowerCase();
      const parent = sectionStack[sectionStack.length - 1];
      if (!parent._children[name]) {
        parent._children[name] = { _type: 'section', _children: {}, _lists: {}, _path: [...parent._path, name] };
      }
      sectionStack.push(parent._children[name]);
      return;
    }

    if (clean === '}') {
      if (sectionStack.length > 1) sectionStack.pop();
      return;
    }

    const eqIdx = clean.indexOf('=');
    if (eqIdx === -1) return;

    const key   = clean.slice(0, eqIdx).trim().toLowerCase();
    const value = clean.slice(eqIdx + 1).trim();
    const cur   = sectionStack[sectionStack.length - 1];

    if (LIST_KEYS.has(key)) {
      if (!cur._lists[key]) cur._lists[key] = [];
      cur._lists[key].push({ value, line: lineIdx });
    } else {
      cur._children[key] = { _type: 'value', value, line: lineIdx };
    }
  });

  return { root, rawLines };
}

export function getValue(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath) {
    node = node._children[seg];
    if (!node) return null;
  }
  const child = node._children[key];
  return child ? child : null;
}

export function getList(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath) {
    node = node._children[seg];
    if (!node) return [];
  }
  return node._lists[key] || [];
}

export function applyChange(rawLines, lineIdx, newValue) {
  const line = rawLines[lineIdx];
  const eqIdx = line.indexOf('=');
  if (eqIdx === -1) return;
  const commentIdx = line.indexOf('#', eqIdx);
  const comment = commentIdx !== -1 ? ' ' + line.slice(commentIdx) : '';
  const prefix = line.slice(0, eqIdx + 1);
  rawLines[lineIdx] = `${prefix} ${newValue}${comment}`;
}

export function serializeConfig(rawLines) {
  return rawLines.join('\n');
}

export function getAllSources(root) {
  return (root._lists['source'] || []).map(e => e.value);
}

export function findAllMatches(root, query) {
  const q = query.toLowerCase();
  const matches = [];

  function walk(node, path) {
    for (const [k, child] of Object.entries(node._children)) {
      if (child._type === 'value') {
        if (k.includes(q) || child.value.toLowerCase().includes(q)) {
          matches.push({ path, key: k, value: child.value, line: child.line });
        }
      } else if (child._type === 'section') {
        const label = [...path, k].join('.');
        if (label.includes(q)) {
          matches.push({ path, key: k, value: '[section]', line: -1 });
        }
        walk(child, [...path, k]);
      }
    }
    for (const [k, entries] of Object.entries(node._lists)) {
      for (const e of entries) {
        if (k.includes(q) || e.value.toLowerCase().includes(q)) {
          matches.push({ path, key: k, value: e.value, line: e.line });
        }
      }
    }
  }

  walk(root, []);
  return matches;
}
