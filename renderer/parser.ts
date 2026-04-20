const LIST_KEYS = new Set < string > ([
  "bind", "binde", "bindm", "bindl", "bindr", "bindc", "bindg", "bindd", "bindk",
  "unbind", "submap", "exec-once", "exec", "env", "monitor", "workspace",
  "windowrule", "windowrulev2", "windowrulev3", "layerrule", "source",
  "animation", "bezier", "permission", "gesture", "device", "touchdevice",
  "tablet",
]);

export interface LocInfo {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

export interface TextPart { type: "Text"; value: string; }
export interface VarRefPart { type: "VarRef"; name: string; }
export interface ExprPart { type: "Expr"; expr: ExprNode; }
export type ValuePart = TextPart | VarRefPart | ExprPart;

export interface ParsedValue {
  type: "Value";
  raw: string;
  parts: ValuePart[];
}

export interface NumberExpr { type: "Number"; value: number; }
export interface VarRefExpr { type: "VarRef"; name: string; }
export interface UnaryExpr { type: "Unary"; op: string; expr: ExprNode; }
export interface BinaryExpr { type: "Binary"; op: string; left: ExprNode; right: ExprNode; }
export type ExprNode = NumberExpr | VarRefExpr | UnaryExpr | BinaryExpr;

interface Token { type: "number" | "ident" | "op" | "punct"; value: string; }

export interface CommentNode { type: "Comment"; value: string; loc: LocInfo; line: number; }
export interface BlockEndNode { type: "BlockEnd"; line: number; }
export interface SectionStartNode { type: "SectionStart"; name: string; key: string | null; inlineComment: string | null; line: number; }
export interface AssignmentNode { type: "Assignment"; key: string; value: ParsedValue; loc: LocInfo; line: number; inlineComment: string | null; }
export interface VariableNode { type: "Variable"; name: string; value: ParsedValue; loc: LocInfo; line: number; inlineComment: string | null; }
export interface ListEntryASTNode { type: "ListEntry"; key: string; value: ParsedValue; loc: LocInfo; line: number; inlineComment: string | null; }
export interface RawNode { type: "Raw"; value: string; loc: LocInfo; line: number; inlineComment: string | null; }
export interface SectionASTNode {
  type: "Section";
  name: string;
  key: string | null;
  body: ASTNode[];
  line: number;
  startLine: number;
  endLine: number;
  loc: LocInfo;
  inlineComment: string | null;
}

export type ASTNode =
  | CommentNode
  | BlockEndNode
  | SectionStartNode
  | AssignmentNode
  | VariableNode
  | ListEntryASTNode
  | RawNode
  | SectionASTNode;

export interface ConfigFileAST {
  type: "ConfigFile";
  body: ASTNode[];
  lines: string[];
}

export interface SectionInstance {
  start: number;
  end: number;
  line: number;
  key: string | null;
}

export interface ValueTreeNode {
  _type: "value" | "variable";
  key: string;
  value: string;
  line: number;
  lineIdx: number;
}

export interface ListEntryTreeNode {
  _type: "list-entry";
  key: string;
  value: string;
  line: number;
  lineIdx: number;
}

export interface SectionTreeNode {
  _type: "section";
  name: string;
  _path: string[];
  _meta: unknown;
  _children: Record<string, TreeNode>;
  _lists: Record<string, ListEntryTreeNode[]>;
  _instances: SectionInstance[];
}

export type TreeNode = SectionTreeNode | ValueTreeNode;

export interface ParsedConfig {
  ast: ConfigFileAST;
  root: SectionTreeNode;
  rawLines: string[];
}

export interface DuplicateSection {
  name: string;
  path: string[];
  count: number;
  instances: SectionInstance[];
}

export interface SearchMatch {
  path: string[];
  key: string;
  value: string;
  line: number;
}

interface CommentSplit { code: string; comment: string | null; }

class HyprParser {
  private text: string;
  private lines: string[];
  private index: number;

  constructor(text: string) {
    this.text = String(text ?? "").replace(/\r\n/g, "\n");
    this.lines = this.text.split("\n");
    this.index = 0;
  }

  Parse(): ConfigFileAST {
    const body = this.ParseBlock(false);
    return { type: "ConfigFile", body, lines: this.lines };
  }

  private ParseBlock(stopOnBrace: boolean): ASTNode[] {
    const nodes: ASTNode[] = [];

    while (this.index < this.lines.length) {
      const lineNo = this.index;
      const raw = this.lines[this.index++];
      const stmt = this.ParseLine(raw, lineNo);

      if (!stmt) continue;

      if (stmt.type === "BlockEnd") {
        if (stopOnBrace) break;
        continue;
      }

      if (stmt.type === "SectionStart") {
        const body = this.ParseBlock(true);
        nodes.push({
          type: "Section",
          name: stmt.name,
          key: stmt.key ?? null,
          body,
          line: lineNo,
          startLine: lineNo,
          endLine: this.index - 1,
          loc: ConfigParser.Loc(lineNo, 0, this.index - 1, this.lines[this.index - 1]?.length ?? 0),
          inlineComment: stmt.inlineComment ?? null,
        });
        continue;
      }

      nodes.push(stmt);
    }

    return nodes;
  }

  private ParseLine(raw: string, lineNo: number): ASTNode | null {
    const { code, comment } = ConfigParser.SplitComment(raw);
    const trimmed = code.trim();

    if (!trimmed) {
      if (comment != null) {
        return { type: "Comment", value: comment, loc: ConfigParser.Loc(lineNo, 0, lineNo, raw.length), line: lineNo };
      }
      return null;
    }

    if (trimmed === "}") {
      return { type: "BlockEnd", line: lineNo };
    }

    if (trimmed.endsWith("{")) {
      const head = trimmed.slice(0, -1).trim();
      if (!head) throw this.Error(lineNo, 0, "invalid section start");

      const eqIdx = ConfigParser.FindTopLevelEquals(head);
      if (eqIdx !== -1) {
        const name = head.slice(0, eqIdx).trim().toLowerCase();
        const key = head.slice(eqIdx + 1).trim();
        return { type: "SectionStart", name, key, inlineComment: comment, line: lineNo };
      }

      return { type: "SectionStart", name: head.toLowerCase(), key: null, inlineComment: comment, line: lineNo };
    }

    const eqIdx = ConfigParser.FindTopLevelEquals(trimmed);
    if (eqIdx === -1) {
      return { type: "Raw", value: trimmed, loc: ConfigParser.Loc(lineNo, 0, lineNo, raw.length), line: lineNo, inlineComment: comment ?? null };
    }

    const keyRaw = trimmed.slice(0, eqIdx).trim();
    const valueRaw = trimmed.slice(eqIdx + 1).trim();

    if (!keyRaw) throw this.Error(lineNo, 0, "missing key before '='");

    const value = ConfigParser.ParseValue(valueRaw, lineNo);

    if (keyRaw.startsWith("$")) {
      return { type: "Variable", name: keyRaw.slice(1), value, loc: ConfigParser.Loc(lineNo, 0, lineNo, raw.length), line: lineNo, inlineComment: comment ?? null };
    }

    const lowered = keyRaw.toLowerCase();

    if (LIST_KEYS.has(lowered)) {
      return { type: "ListEntry", key: lowered, value, loc: ConfigParser.Loc(lineNo, 0, lineNo, raw.length), line: lineNo, inlineComment: comment ?? null };
    }

    return { type: "Assignment", key: lowered, value, loc: ConfigParser.Loc(lineNo, 0, lineNo, raw.length), line: lineNo, inlineComment: comment ?? null };
  }

  private Error(line: number, col: number, msg: string): SyntaxError {
    return new SyntaxError(`${msg} at ${line + 1}:${col + 1}`);
  }
}

class ConfigParser {
  static CreateSectionNode(name: string = "", path: string[] = [], meta: unknown = null): SectionTreeNode {
    return { _type: "section", name, _path: [...path], _meta: meta, _children: {}, _lists: {}, _instances: [] };
  }

  static CreateValueNode(kind: "value" | "variable", key: string, value: string, line: number): ValueTreeNode {
    return { _type: kind, key, value, line, lineIdx: line };
  }

  static BuildTree(ast: ConfigFileAST): SectionTreeNode {
    const root = ConfigParser.CreateSectionNode("", []);

    function Ingest(nodes: ASTNode[], cur: SectionTreeNode): void {
      for (const node of nodes) {
        if (node.type === "Section") {
          const name = String(node.name || "").toLowerCase();

          if (!cur._children[name] || (cur._children[name] as SectionTreeNode)._type !== "section") {
            cur._children[name] = ConfigParser.CreateSectionNode(name, [...cur._path, name]);
          }

          const child = cur._children[name] as SectionTreeNode;
          child._instances.push({ start: node.startLine, end: node.endLine, line: node.line, key: node.key ?? null });
          Ingest(node.body, child);
          continue;
        }

        if (node.type === "Assignment") {
          cur._children[node.key] = ConfigParser.CreateValueNode("value", node.key, node.value.raw, node.line);
          continue;
        }

        if (node.type === "Variable") {
          const k = `$${node.name}`.toLowerCase();
          cur._children[k] = ConfigParser.CreateValueNode("variable", k, node.value.raw, node.line);
          continue;
        }

        if (node.type === "ListEntry") {
          if (!cur._lists[node.key]) cur._lists[node.key] = [];
          cur._lists[node.key].push({ _type: "list-entry", key: node.key, value: node.value.raw, line: node.line, lineIdx: node.line });
        }
      }
    }

    Ingest(ast.body, root);
    return root;
  }

  static ParseConfig(text: string): ParsedConfig {
    const parser = new HyprParser(text);
    const ast = parser.Parse();
    const root = ConfigParser.BuildTree(ast);
    return { ast, root, rawLines: ast.lines.slice() };
  }

  static GetValue(root: SectionTreeNode, sectionPath: string[], key: string): ValueTreeNode | null {
    let node: TreeNode = root;
    for (const seg of sectionPath.map(s => String(s).toLowerCase())) {
      if ((node as SectionTreeNode)._type !== "section") return null;
      node = (node as SectionTreeNode)._children?.[seg];
      if (!node) return null;
    }
    if ((node as SectionTreeNode)._type !== "section") return null;
    const child = (node as SectionTreeNode)._children?.[String(key).toLowerCase()];
    if (!child) return null;
    if ((child as ValueTreeNode)._type !== "value" && (child as ValueTreeNode)._type !== "variable") return null;
    return child as ValueTreeNode;
  }

  static GetList(root: SectionTreeNode, sectionPath: string[], key: string): ListEntryTreeNode[] {
    let node: TreeNode = root;
    for (const seg of sectionPath.map(s => String(s).toLowerCase())) {
      if ((node as SectionTreeNode)._type !== "section") return [];
      node = (node as SectionTreeNode)._children?.[seg];
      if (!node) return [];
    }
    if ((node as SectionTreeNode)._type !== "section") return [];
    return (node as SectionTreeNode)._lists?.[String(key).toLowerCase()] || [];
  }

  static GetDuplicateSections(root: SectionTreeNode, path: string[] = []): DuplicateSection[] {
    if (!root || root._type !== "section") return [];

    let duplicates: DuplicateSection[] = [];

    for (const [name, node] of Object.entries(root._children || {})) {
      if (!node || (node as SectionTreeNode)._type !== "section") continue;
      const sNode = node as SectionTreeNode;

      if (sNode._instances.length > 1) {
        duplicates.push({ name, path: [...path, name], count: sNode._instances.length, instances: sNode._instances.slice() });
      }

      duplicates = duplicates.concat(ConfigParser.GetDuplicateSections(sNode, [...path, name]));
    }

    return duplicates;
  }

  static MergeDuplicateSections(config: ParsedConfig): string[] {
    const duplicates = ConfigParser.GetDuplicateSections(config.root);
    if (!duplicates.length) return config.rawLines.slice();

    const lines = config.rawLines.slice();
    const edits: Array<{ type: "insert" | "remove"; at?: number; lines?: string[]; depth: number; start?: number; count?: number }> = [];

    for (const dup of duplicates) {
      const [first, ...rest] = dup.instances;
      if (!first || !rest.length) continue;

      for (const inst of rest) {
        edits.push({ type: "insert", at: first.end, lines: lines.slice(inst.start + 1, inst.end), depth: dup.path.length });
        edits.push({ type: "remove", start: inst.start, count: inst.end - inst.start + 1, depth: dup.path.length });
      }
    }

    edits.sort((a, b) => {
      const aPos = a.type === "remove" ? (a.start ?? 0) : (a.at ?? 0);
      const bPos = b.type === "remove" ? (b.start ?? 0) : (b.at ?? 0);
      return bPos - aPos;
    });

    for (const edit of edits) {
      if (edit.type === "remove" && edit.start !== undefined && edit.count !== undefined) {
        lines.splice(edit.start, edit.count);
      } else if (edit.type === "insert" && edit.at !== undefined && edit.lines) {
        lines.splice(edit.at, 0, ...edit.lines);
      }
    }

    return lines;
  }

  static ApplyChange(config: ParsedConfig, sectionPath: string[], key: string, value: string): void;
  static ApplyChange(rawLines: string[], lineIdx: number, value: string): void;
  static ApplyChange(
    arg1: ParsedConfig | string[],
    arg2: string[] | number,
    arg3: string,
    arg4?: string
  ): void {
    if (Array.isArray(arg1) && typeof arg2 === "number") {
      const rawLines = arg1 as string[];
      const lineIdx = arg2;
      const value = arg3;
      if (lineIdx < 0 || lineIdx >= rawLines.length) return;
      rawLines[lineIdx] = ConfigParser.ReplaceAssignmentValue(rawLines[lineIdx], value);
      return;
    }

    const config = arg1 as ParsedConfig;
    const sectionPath = (Array.isArray(arg2) ? arg2 as string[] : []).map(s => String(s).toLowerCase());
    const key = arg3;
    const value = arg4!;

    const { root, rawLines } = config;
    if (!root || !rawLines) return;

    const normalizedKey = key.toLowerCase();
    const isList = LIST_KEYS.has(normalizedKey);

    let node: SectionTreeNode | null = root;
    let deepestExistingNode: SectionTreeNode = root;
    let deepestExistingDepth = 0;

    for (let i = 0; i < sectionPath.length; i++) {
      const seg = sectionPath[i];
      const next = node?._children?.[seg];
      if (next && (next as SectionTreeNode)._type === "section") {
        node = next as SectionTreeNode;
        deepestExistingNode = next as SectionTreeNode;
        deepestExistingDepth = i + 1;
      } else {
        node = null;
        break;
      }
    }

    if (node && node._type === "section") {
      if (!isList) {
        const existing = node._children?.[normalizedKey] as ValueTreeNode | undefined;
        if (existing && (existing._type === "value" || existing._type === "variable") && existing.lineIdx !== undefined) {
          rawLines[existing.lineIdx] = ConfigParser.ReplaceAssignmentValue(rawLines[existing.lineIdx], value);
          return;
        }
      }

      if (node._instances?.length) {
        const lastInst = node._instances[node._instances.length - 1];
        const indent = "    ".repeat(sectionPath.length);
        rawLines.splice(lastInst.end, 0, `${indent}${key} = ${value}`);
        return;
      }
    }

    if (deepestExistingNode && deepestExistingNode._type === "section" && deepestExistingNode._instances?.length) {
      const missingSegments = sectionPath.slice(deepestExistingDepth);
      const insertAt = deepestExistingNode._instances[deepestExistingNode._instances.length - 1].end;
      const linesToInsert: string[] = [];

      for (let i = 0; i < missingSegments.length; i++) {
        linesToInsert.push(`${"    ".repeat(deepestExistingDepth + i)}${missingSegments[i]} {`);
      }

      linesToInsert.push(`${"    ".repeat(sectionPath.length)}${key} = ${value}`);

      for (let i = missingSegments.length - 1; i >= 0; i--) {
        linesToInsert.push(`${"    ".repeat(deepestExistingDepth + i)}}`);
      }

      if (missingSegments.length === 0) {
        linesToInsert.length = 0;
        linesToInsert.push(`${"    ".repeat(deepestExistingDepth)}${key} = ${value}`);
      }

      rawLines.splice(insertAt, 0, ...linesToInsert);
      return;
    }

    const openLines = sectionPath.map((seg, i) => `${"    ".repeat(i)}${seg} {`);
    const closeLines = [...sectionPath].reverse().map((_, i) => `${"    ".repeat(sectionPath.length - 1 - i)}}`);
    const leafIndent = "    ".repeat(sectionPath.length);

    rawLines.push("", ...openLines, `${leafIndent}${key} = ${value}`, ...closeLines);
  }

  static ReplaceAssignmentValue(line: string, value: string): string {
    const idx = ConfigParser.FindTopLevelEquals(line);
    if (idx === -1) return line;
    const left = line.slice(0, idx + 1);
    const commentSplit = ConfigParser.SplitComment(line.slice(idx + 1));
    const trailingComment = commentSplit.comment != null ? ` # ${commentSplit.comment}` : "";
    return `${left} ${value}${trailingComment}`;
  }

  static SerializeConfig(rawLines: string[]): string {
    return rawLines.join("\n");
  }

  static GetAllSources(root: SectionTreeNode): string[] {
    return (root?._lists?.["source"] || []).map(e => e.value);
  }

  static FindAllMatches(root: SectionTreeNode, query: string): SearchMatch[] {
    const q = String(query || "").toLowerCase();
    const matches: SearchMatch[] = [];

    function Walk(node: SectionTreeNode, path: string[]): void {
      if (!node || node._type !== "section") return;

      for (const [k, child] of Object.entries(node._children || {})) {
        const typedChild = child as TreeNode;
        if (typedChild._type === "value" || typedChild._type === "variable") {
          const vChild = typedChild as ValueTreeNode;
          if (k.includes(q) || String(vChild.value ?? "").toLowerCase().includes(q)) {
            matches.push({ path, key: k, value: vChild.value, line: vChild.line });
          }
          continue;
        }

        if (typedChild._type === "section") {
          const sChild = typedChild as SectionTreeNode;
          const label = [...path, k].join(".");
          if (label.includes(q)) {
            matches.push({ path, key: k, value: "[section]", line: sChild._instances[0]?.line ?? -1 });
          }
          Walk(sChild, [...path, k]);
        }
      }

      for (const [k, entries] of Object.entries(node._lists || {})) {
        for (const e of entries) {
          if (k.includes(q) || String(e.value ?? "").toLowerCase().includes(q)) {
            matches.push({ path, key: k, value: e.value, line: e.line });
          }
        }
      }
    }

    Walk(root, []);
    return matches;
  }

  static RemoveDuplicateKeys(config: ParsedConfig): string[] {
    const lines = config.rawLines.slice();
    const removals = new Set < number > ();

    function VisitBlock(nodes: ASTNode[]): void {
      const seen = new Map < string, number> ();

      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (!node) continue;

        if (node.type === "Section") {
          VisitBlock(node.body);
          continue;
        }

        if (node.type !== "Assignment" && node.type !== "Variable") continue;

        const key = node.type === "Variable"
          ? `$${String((node as VariableNode).name).toLowerCase()}`
          : String((node as AssignmentNode).key).toLowerCase();

        if (seen.has(key)) {
          removals.add(node.line);
        } else {
          seen.set(key, node.line);
        }
      }
    }

    VisitBlock(config.ast.body);

    [...removals]
      .filter(line => Number.isInteger(line) && line >= 0 && line < lines.length)
      .sort((a, b) => b - a)
      .forEach(line => lines.splice(line, 1));

    return lines;
  }

  static NormalizeConfig(config: ParsedConfig): ParsedConfig {
    let parsed = config;
    let changed = true;

    while (changed) {
      changed = false;

      const mergedSections = ConfigParser.MergeDuplicateSections(parsed);
      if (mergedSections.join("\n") !== parsed.rawLines.join("\n")) {
        parsed = ConfigParser.ParseConfig(mergedSections.join("\n"));
        changed = true;
      }

      const dedupedKeys = ConfigParser.RemoveDuplicateKeys(parsed);
      if (dedupedKeys.join("\n") !== parsed.rawLines.join("\n")) {
        parsed = ConfigParser.ParseConfig(dedupedKeys.join("\n"));
        changed = true;
      }
    }

    return parsed;
  }

  static Loc(line: number, col: number, endLine: number, endCol: number): LocInfo {
    return { line, col, endLine, endCol };
  }

  static SplitComment(line: string): CommentSplit {
    let out = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "#") {
        if (line[i + 1] === "#") { out += "#"; i++; }
        else { return { code: out, comment: line.slice(i + 1).trim() }; }
      } else { out += ch; }
    }
    return { code: out, comment: null };
  }

  static FindTopLevelEquals(s: string): number {
    let exprDepth = 0;

    for (let i = 0; i < s.length; i++) {
      if (s[i] === "{" && s[i + 1] === "{") { exprDepth++; i++; continue; }
      if (s[i] === "}" && s[i + 1] === "}") { exprDepth = Math.max(0, exprDepth - 1); i++; continue; }
      if (s[i] === "=" && exprDepth === 0) return i;
    }

    return -1;
  }

  static ParseValue(raw: string, lineNo: number = 0): ParsedValue {
    const parts: ValuePart[] = [];
    let i = 0;
    let text = "";

    const FlushText = (): void => {
      if (text) { parts.push({ type: "Text", value: text }); text = ""; }
    };

    while (i < raw.length) {
      if (raw[i] === "$") {
        const m = raw.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)/);
        if (m) { FlushText(); parts.push({ type: "VarRef", name: m[1] }); i += m[0].length; continue; }
      }

      if (raw[i] === "{" && raw[i + 1] === "{") {
        const end = ConfigParser.FindExprEnd(raw, i + 2);
        if (end === -1) throw new SyntaxError(`unclosed expression at line ${lineNo + 1}`);
        FlushText();
        const exprText = raw.slice(i + 2, end).trim();
        parts.push({ type: "Expr", expr: ConfigParser.ParseExpression(exprText) });
        i = end + 2;
        continue;
      }

      text += raw[i++];
    }

    FlushText();
    return { type: "Value", raw, parts };
  }

  static FindExprEnd(s: string, start: number): number {
    let depth = 1;

    for (let i = start; i < s.length - 1; i++) {
      if (s[i] === "{" && s[i + 1] === "{") { depth++; i++; continue; }
      if (s[i] === "}" && s[i + 1] === "}") {
        depth--;
        if (depth === 0) return i;
        i++;
      }
    }

    return -1;
  }

  static ParseExpression(input: string): ExprNode {
    const tokens = ConfigParser.TokenizeExpr(input);
    let pos = 0;

    const Peek = (): Token | undefined => tokens[pos];

    const Consume = (type: string, value: string | null = null): Token => {
      const tok = tokens[pos];
      if (!tok || tok.type !== type || (value != null && tok.value !== value)) {
        throw new SyntaxError("unexpected token in expression");
      }
      pos++;
      return tok;
    };

    const ParsePrimary = (): ExprNode => {
      const tok = Peek();
      if (!tok) throw new SyntaxError("unexpected end of expression");

      if (tok.type === "number") { Consume("number"); return { type: "Number", value: Number(tok.value) }; }
      if (tok.type === "ident") { Consume("ident"); return { type: "VarRef", name: tok.value }; }

      if (tok.type === "op" && tok.value === "-") {
        Consume("op", "-");
        const expr = ParsePrimary();
        return { type: "Unary", op: "-", expr };
      }

      if (tok.type === "punct" && tok.value === "(") {
        Consume("punct", "(");
        const expr = ParseAddSub();
        Consume("punct", ")");
        return expr;
      }

      throw new SyntaxError(`invalid expression token: ${tok.value}`);
    };

    const ParseMulDiv = (): ExprNode => {
      let left = ParsePrimary();
      while (true) {
        const tok = Peek();
        if (tok && tok.type === "op" && (tok.value === "*" || tok.value === "/")) {
          Consume("op");
          const right = ParsePrimary();
          left = { type: "Binary", op: tok.value, left, right };
        } else { break; }
      }
      return left;
    };

    const ParseAddSub = (): ExprNode => {
      let left = ParseMulDiv();
      while (true) {
        const tok = Peek();
        if (tok && tok.type === "op" && (tok.value === "+" || tok.value === "-")) {
          Consume("op");
          const right = ParseMulDiv();
          left = { type: "Binary", op: tok.value, left, right };
        } else { break; }
      }
      return left;
    };

    const expr = ParseAddSub();
    if (pos !== tokens.length) throw new SyntaxError("unexpected trailing tokens in expression");
    return expr;
  }

  static TokenizeExpr(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < input.length) {
      const ch = input[i];

      if (/\s/.test(ch)) { i++; continue; }

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

      if ("+-*/".includes(ch)) { tokens.push({ type: "op", value: ch }); i++; continue; }
      if ("()".includes(ch)) { tokens.push({ type: "punct", value: ch }); i++; continue; }

      throw new SyntaxError(`unexpected character in expression: ${ch}`);
    }

    return tokens;
  }
}

export function parseConfig(text: string): ParsedConfig { return ConfigParser.ParseConfig(text); }
export function getValue(root: SectionTreeNode, sectionPath: string[], key: string): ValueTreeNode | null { return ConfigParser.GetValue(root, sectionPath, key); }
export function getList(root: SectionTreeNode, sectionPath: string[], key: string): ListEntryTreeNode[] { return ConfigParser.GetList(root, sectionPath, key); }
export function applyChange(config: ParsedConfig, sectionPath: string[], key: string, value: string): void { return ConfigParser.ApplyChange(config, sectionPath, key, value); }
export function serializeConfig(rawLines: string[]): string { return ConfigParser.SerializeConfig(rawLines); }
export function getAllSources(root: SectionTreeNode): string[] { return ConfigParser.GetAllSources(root); }
export function findAllMatches(root: SectionTreeNode, query: string): SearchMatch[] { return ConfigParser.FindAllMatches(root, query); }
export function getDuplicateSections(root: SectionTreeNode, path?: string[]): DuplicateSection[] { return ConfigParser.GetDuplicateSections(root, path); }
export function mergeDuplicateSections(config: ParsedConfig): string[] { return ConfigParser.MergeDuplicateSections(config); }
export function removeDuplicateKeys(config: ParsedConfig): string[] { return ConfigParser.RemoveDuplicateKeys(config); }
export function normalizeConfig(config: ParsedConfig): ParsedConfig { return ConfigParser.NormalizeConfig(config); }

export { ConfigParser, HyprParser };