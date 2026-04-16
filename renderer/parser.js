const LIST_KEYS = new Set([
  "bind", "binde", "bindm", "bindl", "bindr", "bindc", "bindg", "bindd", "bindk",
  "unbind", "submap", "exec-once", "exec", "env", "monitor", "workspace",
  "windowrule", "windowrulev2", "windowrulev3", "layerrule", "source",
  "animation", "bezier", "permission", "gesture", "device", "touchdevice",
  "tablet",
]);

function createSectionNode(name = "", path = [], meta = null) {
  return {
    _type: "section",
    name,
    _path: [...path],
    _meta: meta,
    _children: {},
    _lists: {},
    _instances: [],
  };
}

function createValueNode(kind, key, value, line) {
  return {
    _type: kind,
    key,
    value,
    line,
    lineIdx: line,
  };
}

export function parseConfig(text) {
  const parser = new HyprParser(text);
  const ast = parser.parse();
  const root = buildTree(ast);
  return {
    ast,
    root,
    rawLines: ast.lines.slice(),
  };
}

function buildTree(ast) {
  const root = createSectionNode("", []);

  function ingest(nodes, cur) {
    for (const node of nodes) {
      if (node.type === "Section") {
        const name = String(node.name || "").toLowerCase();

        if (!cur._children[name] || cur._children[name]._type !== "section") {
          cur._children[name] = createSectionNode(name, [...cur._path, name]);
        }

        const child = cur._children[name];
        child._instances.push({
          start: node.startLine,
          end: node.endLine,
          line: node.line,
          key: node.key ?? null,
        });

        ingest(node.body, child);
        continue;
      }

      if (node.type === "Assignment") {
        cur._children[node.key] = createValueNode(
          "value",
          node.key,
          node.value.raw,
          node.line
        );
        continue;
      }

      if (node.type === "Variable") {
        const k = `$${node.name}`.toLowerCase();
        cur._children[k] = createValueNode(
          "variable",
          k,
          node.value.raw,
          node.line
        );
        continue;
      }

      if (node.type === "ListEntry") {
        if (!cur._lists[node.key]) cur._lists[node.key] = [];
        cur._lists[node.key].push({
          _type: "list-entry",
          key: node.key,
          value: node.value.raw,
          line: node.line,
          lineIdx: node.line,
        });
      }
    }
  }

  ingest(ast.body, root);
  return root;
}

export function getValue(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath.map(s => String(s).toLowerCase())) {
    node = node?._children?.[seg];
    if (!node || node._type !== "section") return null;
  }

  const child = node?._children?.[String(key).toLowerCase()];
  if (!child) return null;
  if (child._type !== "value" && child._type !== "variable") return null;
  return child;
}

export function getList(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath.map(s => String(s).toLowerCase())) {
    node = node?._children?.[seg];
    if (!node || node._type !== "section") return [];
  }
  return node?._lists?.[String(key).toLowerCase()] || [];
}

export function getDuplicateSections(root, path = []) {
  if (!root || root._type !== "section") return [];

  let duplicates = [];

  for (const [name, node] of Object.entries(root._children || {})) {
    if (!node || node._type !== "section") continue;

    if (node._instances.length > 1) {
      duplicates.push({
        name,
        path: [...path, name],
        count: node._instances.length,
        instances: node._instances.slice(),
      });
    }

    duplicates = duplicates.concat(getDuplicateSections(node, [...path, name]));
  }

  return duplicates;
}

export function mergeDuplicateSections(config) {
  const duplicates = getDuplicateSections(config.root);
  if (!duplicates.length) return config.rawLines.slice();

  const lines = config.rawLines.slice();

  const edits = [];

  for (const dup of duplicates) {
    const [first, ...rest] = dup.instances;
    if (!first || !rest.length) continue;

    for (const inst of rest) {
      edits.push({
        type: "insert",
        at: first.end,
        lines: lines.slice(inst.start + 1, inst.end),
        depth: dup.path.length,
      });

      edits.push({
        type: "remove",
        start: inst.start,
        count: inst.end - inst.start + 1,
        depth: dup.path.length,
      });
    }
  }

  edits.sort((a, b) => {
    const aPos = a.type === "remove" ? a.start : a.at;
    const bPos = b.type === "remove" ? b.start : b.at;
    return bPos - aPos;
  });

  for (const edit of edits) {
    if (edit.type === "remove") {
      lines.splice(edit.start, edit.count);
    } else {
      lines.splice(edit.at, 0, ...edit.lines);
    }
  }

  return lines;
}

export function applyChange(config, sectionPath, key, value) {
  const { root, rawLines } = config;
  const normalizedPath = sectionPath.map(s => String(s).toLowerCase());
  const normalizedKey = String(key).toLowerCase();
  const isList = LIST_KEYS.has(normalizedKey);

  let node = root;
  for (const seg of normalizedPath) {
    node = node?._children?.[seg];
    if (!node || node._type !== "section") break;
  }

  if (!isList) {
    const existing = node?._children?.[normalizedKey];
    if (existing && (existing._type === "value" || existing._type === "variable") && existing.lineIdx !== undefined) {
      rawLines[existing.lineIdx] = replaceAssignmentValue(rawLines[existing.lineIdx], value);
      return;
    }
  }

  if (node && node._type === "section" && node._instances.length) {
    const lastInst = node._instances[node._instances.length - 1];
    const indent = "    ".repeat(normalizedPath.length);
    rawLines.splice(lastInst.end, 0, `${indent}${key} = ${value}`);
    return;
  }

  const indentBase = normalizedPath.map((seg, i) => `${"    ".repeat(i)}${seg} {`);
  const closing = normalizedPath
    .slice()
    .reverse()
    .map((_, i) => `${"    ".repeat(normalizedPath.length - 1 - i)}}`);
  const leafIndent = "    ".repeat(normalizedPath.length);

  rawLines.push(
    "",
    ...indentBase,
    `${leafIndent}${key} = ${value}`,
    ...closing
  );
}

function replaceAssignmentValue(line, value) {
  const idx = findTopLevelEquals(line);
  if (idx === -1) return line;
  const left = line.slice(0, idx + 1);
  const commentSplit = splitComment(line.slice(idx + 1));
  const trailingComment = commentSplit.comment != null ? ` # ${commentSplit.comment}` : "";
  return `${left} ${value}${trailingComment}`;
}

export function serializeConfig(rawLines) {
  return rawLines.join("\n");
}

export function getAllSources(root) {
  return (root?._lists?.["source"] || []).map(e => e.value);
}

export function findAllMatches(root, query) {
  const q = String(query || "").toLowerCase();
  const matches = [];

  function walk(node, path) {
    if (!node || node._type !== "section") return;

    for (const [k, child] of Object.entries(node._children || {})) {
      if (child._type === "value" || child._type === "variable") {
        if (
          k.includes(q) ||
          String(child.value ?? "").toLowerCase().includes(q)
        ) {
          matches.push({
            path,
            key: k,
            value: child.value,
            line: child.line,
          });
        }
        continue;
      }

      if (child._type === "section") {
        const label = [...path, k].join(".");
        if (label.includes(q)) {
          matches.push({
            path,
            key: k,
            value: "[section]",
            line: child._instances[0]?.line ?? -1,
          });
        }
        walk(child, [...path, k]);
      }
    }

    for (const [k, entries] of Object.entries(node._lists || {})) {
      for (const e of entries) {
        if (
          k.includes(q) ||
          String(e.value ?? "").toLowerCase().includes(q)
        ) {
          matches.push({
            path,
            key: k,
            value: e.value,
            line: e.line,
          });
        }
      }
    }
  }

  walk(root, []);
  return matches;
}

class HyprParser {
  constructor(text) {
    this.text = String(text ?? "").replace(/\r\n/g, "\n");
    this.lines = this.text.split("\n");
    this.index = 0;
  }

  parse() {
    const body = this.parseBlock(false);
    return {
      type: "ConfigFile",
      body,
      lines: this.lines,
    };
  }

  parseBlock(stopOnBrace) {
    const nodes = [];

    while (this.index < this.lines.length) {
      const lineNo = this.index;
      const raw = this.lines[this.index++];
      const stmt = this.parseLine(raw, lineNo);

      if (!stmt) continue;

      if (stmt.type === "BlockEnd") {
        if (stopOnBrace) break;
        continue;
      }

      if (stmt.type === "SectionStart") {
        const body = this.parseBlock(true);
        nodes.push({
          type: "Section",
          name: stmt.name,
          key: stmt.key ?? null,
          body,
          line: lineNo,
          startLine: lineNo,
          endLine: this.index - 1,
          loc: loc(lineNo, 0, this.index - 1, this.lines[this.index - 1]?.length ?? 0),
          inlineComment: stmt.inlineComment ?? null,
        });
        continue;
      }

      nodes.push(stmt);
    }

    return nodes;
  }

  parseLine(raw, lineNo) {
    const { code, comment } = splitComment(raw);
    const trimmed = code.trim();

    if (!trimmed) {
      if (comment != null) {
        return {
          type: "Comment",
          value: comment,
          loc: loc(lineNo, 0, lineNo, raw.length),
          line: lineNo,
        };
      }
      return null;
    }

    if (trimmed === "}") {
      return { type: "BlockEnd", line: lineNo };
    }

    if (trimmed.endsWith("{")) {
      const head = trimmed.slice(0, -1).trim();
      if (!head) throw this.error(lineNo, 0, "invalid section start");

      const eqIdx = findTopLevelEquals(head);
      if (eqIdx !== -1) {
        const name = head.slice(0, eqIdx).trim().toLowerCase();
        const key = head.slice(eqIdx + 1).trim();
        return {
          type: "SectionStart",
          name,
          key,
          inlineComment: comment,
          line: lineNo,
        };
      }

      return {
        type: "SectionStart",
        name: head.toLowerCase(),
        key: null,
        inlineComment: comment,
        line: lineNo,
      };
    }

    const eqIdx = findTopLevelEquals(trimmed);
    if (eqIdx === -1) {
      return {
        type: "Raw",
        value: trimmed,
        loc: loc(lineNo, 0, lineNo, raw.length),
        line: lineNo,
        inlineComment: comment ?? null,
      };
    }

    const keyRaw = trimmed.slice(0, eqIdx).trim();
    const valueRaw = trimmed.slice(eqIdx + 1).trim();

    if (!keyRaw) throw this.error(lineNo, 0, "missing key before '='");

    const value = parseValue(valueRaw, lineNo);

    if (keyRaw.startsWith("$")) {
      return {
        type: "Variable",
        name: keyRaw.slice(1),
        value,
        loc: loc(lineNo, 0, lineNo, raw.length),
        line: lineNo,
        inlineComment: comment ?? null,
      };
    }

    const lowered = keyRaw.toLowerCase();

    if (LIST_KEYS.has(lowered)) {
      return {
        type: "ListEntry",
        key: lowered,
        value,
        loc: loc(lineNo, 0, lineNo, raw.length),
        line: lineNo,
        inlineComment: comment ?? null,
      };
    }

    return {
      type: "Assignment",
      key: lowered,
      value,
      loc: loc(lineNo, 0, lineNo, raw.length),
      line: lineNo,
      inlineComment: comment ?? null,
    };
  }

  error(line, col, msg) {
    return new SyntaxError(`${msg} at ${line + 1}:${col + 1}`);
  }
}

function loc(line, col, endLine, endCol) {
  return { line, col, endLine, endCol };
}

function splitComment(line) {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "#") {
      if (line[i + 1] === "#") {
        out += "#";
        i++;
      } else {
        return {
          code: out,
          comment: line.slice(i + 1).trim(),
        };
      }
    } else {
      out += ch;
    }
  }
  return { code: out, comment: null };
}

function findTopLevelEquals(s) {
  let exprDepth = 0;

  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      exprDepth++;
      i++;
      continue;
    }
    if (s[i] === "}" && s[i + 1] === "}") {
      exprDepth = Math.max(0, exprDepth - 1);
      i++;
      continue;
    }
    if (s[i] === "=" && exprDepth === 0) {
      return i;
    }
  }

  return -1;
}

function parseValue(raw, lineNo = 0) {
  const parts = [];
  let i = 0;
  let text = "";

  const flushText = () => {
    if (text) {
      parts.push({ type: "Text", value: text });
      text = "";
    }
  };

  while (i < raw.length) {
    if (raw[i] === "$") {
      const m = raw.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) {
        flushText();
        parts.push({ type: "VarRef", name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    if (raw[i] === "{" && raw[i + 1] === "{") {
      const end = findExprEnd(raw, i + 2);
      if (end === -1) {
        throw new SyntaxError(`unclosed expression at line ${lineNo + 1}`);
      }
      flushText();
      const exprText = raw.slice(i + 2, end).trim();
      parts.push({
        type: "Expr",
        expr: parseExpression(exprText),
      });
      i = end + 2;
      continue;
    }

    text += raw[i++];
  }

  flushText();

  return {
    type: "Value",
    raw,
    parts,
  };
}

function findExprEnd(s, start) {
  let depth = 1;

  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
      continue;
    }
    if (s[i] === "}" && s[i + 1] === "}") {
      depth--;
      if (depth === 0) return i;
      i++;
    }
  }

  return -1;
}

function parseExpression(input) {
  const tokens = tokenizeExpr(input);
  let pos = 0;

  function peek() {
    return tokens[pos];
  }

  function consume(type, value = null) {
    const tok = tokens[pos];
    if (!tok || tok.type !== type || (value != null && tok.value !== value)) {
      throw new SyntaxError("unexpected token in expression");
    }
    pos++;
    return tok;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new SyntaxError("unexpected end of expression");

    if (tok.type === "number") {
      consume("number");
      return { type: "Number", value: Number(tok.value) };
    }

    if (tok.type === "ident") {
      consume("ident");
      return { type: "VarRef", name: tok.value };
    }

    if (tok.type === "op" && tok.value === "-") {
      consume("op", "-");
      const expr = parsePrimary();
      return { type: "Unary", op: "-", expr };
    }

    if (tok.type === "punct" && tok.value === "(") {
      consume("punct", "(");
      const expr = parseAddSub();
      consume("punct", ")");
      return expr;
    }

    throw new SyntaxError(`invalid expression token: ${tok.value}`);
  }

  function parseMulDiv() {
    let left = parsePrimary();
    while (true) {
      const tok = peek();
      if (tok && tok.type === "op" && (tok.value === "*" || tok.value === "/")) {
        consume("op");
        const right = parsePrimary();
        left = { type: "Binary", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseAddSub() {
    let left = parseMulDiv();
    while (true) {
      const tok = peek();
      if (tok && tok.type === "op" && (tok.value === "+" || tok.value === "-")) {
        consume("op");
        const right = parseMulDiv();
        left = { type: "Binary", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  const expr = parseAddSub();
  if (pos !== tokens.length) {
    throw new SyntaxError("unexpected trailing tokens in expression");
  }
  return expr;
}

function tokenizeExpr(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: "number", value: input.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "$") {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i + 1, j) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }

    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    if ("()".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    throw new SyntaxError(`unexpected character in expression: ${ch}`);
  }

  return tokens;
}