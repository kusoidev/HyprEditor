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
  "windowrulev3",
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
  const parser = new HyprParser(text);
  const ast = parser.parse();

  const root = buildCompatTree(ast);
  return {
    ast,
    root,
    rawLines: ast.lines.slice(),
  };
}

export function getValue(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath) {
    node = node?._children?.[seg];
    if (!node) return null;
  }
  const child = node._children?.[String(key).toLowerCase()];
  return child ?? null;
}

export function getList(root, sectionPath, key) {
  let node = root;
  for (const seg of sectionPath) {
    node = node?._children?.[seg];
    if (!node) return [];
  }
  return node._lists?.[String(key).toLowerCase()] || [];
}

export function applyChange(rawLines, lineIdx, newValue) {
  const line = rawLines[lineIdx];
  if (typeof line !== "string") return false;

  const { code, comment } = splitComment(line);
  const eqIdx = findTopLevelEquals(code);
  if (eqIdx === -1) return false;

  const prefix = code.slice(0, eqIdx + 1);
  const rebuilt = `${prefix} ${newValue}`.replace(/\s+$/, "");
  rawLines[lineIdx] = comment != null ? `${rebuilt} # ${comment}` : rebuilt;
  return true;
}

export function serializeConfig(rawLines) {
  return rawLines.join("\n");
}

export function getAllSources(root) {
  return (root._lists?.["source"] || []).map((e) => e.value);
}

export function findAllMatches(root, query) {
  const q = String(query).toLowerCase();
  const matches = [];

  function walk(node, path) {
    for (const [k, child] of Object.entries(node._children || {})) {
      if (child._type === "value") {
        if (k.includes(q) || String(child.value).toLowerCase().includes(q)) {
          matches.push({ path, key: k, value: child.value, line: child.line });
        }
      } else if (child._type === "section") {
        const label = [...path, k].join(".");
        if (label.includes(q)) {
          matches.push({ path, key: k, value: "[section]", line: -1 });
        }
        walk(child, [...path, k]);
      }
    }

    for (const [k, entries] of Object.entries(node._lists || {})) {
      for (const e of entries) {
        if (k.includes(q) || String(e.value).toLowerCase().includes(q)) {
          matches.push({ path, key: k, value: e.value, line: e.line });
        }
      }
    }
  }

  walk(root, []);
  return matches;
}

class HyprParser {
  constructor(text) {
    this.text = String(text).replace(/\r\n/g, "\n");
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
          loc: loc(lineNo, 0, lineNo, raw.length),
          line: lineNo,
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

function buildCompatTree(ast) {
  const root = { _type: "section", _children: {}, _lists: {}, _path: [] };
  ingestNodes(root, ast.body);
  return root;
}

function ingestNodes(cur, nodes) {
  for (const node of nodes) {
    if (node.type === "Section") {
      const name = node.name.toLowerCase();
      if (!cur._children[name]) {
        cur._children[name] = {
          _type: "section",
          _children: {},
          _lists: {},
          _path: [...cur._path, name],
          _node: node,
        };
      }
      ingestNodes(cur._children[name], node.body);
      continue;
    }

    if (node.type === "Assignment") {
      cur._children[node.key] = {
        _type: "value",
        value: node.value.raw,
        line: node.line,
        _node: node,
      };
      continue;
    }

    if (node.type === "Variable") {
      const k = `$${node.name}`;
      cur._children[k.toLowerCase()] = {
        _type: "value",
        value: node.value.raw,
        line: node.line,
        _node: node,
      };
      continue;
    }

    if (node.type === "ListEntry") {
      if (!cur._lists[node.key]) cur._lists[node.key] = [];
      cur._lists[node.key].push({
        value: node.value.raw,
        line: node.line,
        _node: node,
      });
    }
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