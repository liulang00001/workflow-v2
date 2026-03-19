/**
 * AST 解析器：TypeScript 代码 → 流程图
 *
 * 抽象策略（高可读性优先）：
 *   - 只为 控制流（if/for）和 辅助函数调用 生成节点
 *   - 跳过 console.log、简单赋值、变量声明等噪音语句
 *   - if 块以 continue/return 结尾时，false 分支直接连到后续节点（无汇合节点）
 *   - 辅助函数折叠为单个 action 节点，点击可跳转源码
 */
import { Project, SyntaxKind, Node, FunctionDeclaration, IfStatement, ForStatement, Block } from 'ts-morph';
import { FlowNode, FlowEdge, FlowChart } from './types';

let nodeCounter = 0;
let edgeCounter = 0;

function nextNodeId() { return `node_${++nodeCounter}`; }
function nextEdgeId() { return `edge_${++edgeCounter}`; }

/** 从 TypeScript 代码解析出流程图 */
export function parseCodeToFlowChart(code: string): FlowChart {
  nodeCounter = 0;
  edgeCounter = 0;

  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('analysis.ts', code);

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const functions = sourceFile.getFunctions();
  const analyzeFunc = functions.find(f => f.getName() === 'analyze');
  const helperFuncs = functions.filter(f => f.getName() !== 'analyze');

  // 辅助函数名集合（用于判断语句是否值得生成节点）
  const helperNames = new Set(helperFuncs.map(f => f.getName() || ''));

  // 解析 analyze 函数的控制流
  if (analyzeFunc) {
    const startId = nextNodeId();
    nodes.push({
      id: startId,
      type: 'start',
      label: '开始分析',
      description: 'analyze() 入口',
      codeRange: { startLine: analyzeFunc.getStartLineNumber(), endLine: analyzeFunc.getStartLineNumber() },
      position: { x: 0, y: 0 },
    });

    const body = analyzeFunc.getBody();
    if (body && Node.isBlock(body)) {
      const lastId = parseBlock(body, nodes, edges, helperNames, startId);

      const endId = nextNodeId();
      nodes.push({
        id: endId,
        type: 'end',
        label: '分析完成',
        description: '返回结果',
        codeRange: { startLine: analyzeFunc.getEndLineNumber(), endLine: analyzeFunc.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      if (lastId) {
        edges.push({ id: nextEdgeId(), source: lastId, target: endId, type: 'next' });
      }
    }
  }

  autoLayout(nodes, edges);
  return { nodes, edges };
}

// ==================== 判断语句是否"重要" ====================

/** 判断一条语句是否值得生成节点 */
function isSignificantStatement(text: string, helperNames: Set<string>): boolean {
  // 跳过 console.log/warn/error
  if (/^\s*console\.\w+\(/.test(text)) return false;
  // 跳过纯变量声明（没有调用辅助函数）
  if (/^(const|let|var)\s+\w+\s*=\s*\d/.test(text)) return false;
  if (/^(const|let|var)\s+\w+\s*=\s*(true|false|'|"|`)/.test(text)) return false;
  if (/^(const|let|var)\s+\w+\s*=\s*\[\]/.test(text)) return false;
  // 跳过简单赋值
  if (/^\w+\s*=\s*(true|false|\d+);?$/.test(text.trim())) return false;
  // 包含辅助函数调用 → 重要
  for (const name of helperNames) {
    if (text.includes(`${name}(`)) return true;
  }
  // findings.push → 重要
  if (text.includes('findings.push')) return true;
  // 其余跳过
  return false;
}

/** 从语句文本中提取被调用的辅助函数名 */
function findCalledHelper(text: string, helperNames: Set<string>): string | null {
  for (const name of helperNames) {
    if (text.includes(`${name}(`)) return name;
  }
  return null;
}

// ==================== 块解析（核心） ====================

/** 解析代码块，返回最后一个节点的 ID */
function parseBlock(
  block: Block,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  prevId: string,
): string {
  let currentPrev = prevId;

  for (const stmt of block.getStatements()) {
    const kind = stmt.getKind();

    if (kind === SyntaxKind.IfStatement) {
      currentPrev = parseIfStatement(stmt as IfStatement, nodes, edges, helperNames, currentPrev);
    }
    else if (kind === SyntaxKind.ForStatement) {
      currentPrev = parseForStatement(stmt as ForStatement, nodes, edges, helperNames, currentPrev);
    }
    else if (kind === SyntaxKind.ContinueStatement || kind === SyntaxKind.BreakStatement) {
      // 由上层处理
    }
    else if (kind === SyntaxKind.ReturnStatement) {
      // 只在 analyze 顶层 return 才生成节点（结束前的汇总 return）
      const text = stmt.getText();
      if (text.includes('findings') || text.includes('summary')) {
        const retId = nextNodeId();
        nodes.push({
          id: retId,
          type: 'action',
          label: '汇总结果',
          description: '返回 findings 和 summary',
          codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
          position: { x: 0, y: 0 },
        });
        edges.push({ id: nextEdgeId(), source: currentPrev, target: retId, type: 'next' });
        currentPrev = retId;
      }
    }
    else {
      // 表达式语句 / 变量声明：只保留"重要"的
      const text = stmt.getText();
      if (!isSignificantStatement(text, helperNames)) continue;

      const helper = findCalledHelper(text, helperNames);
      const label = helper
        ? `调用 ${helper}()`
        : text.includes('findings.push') ? '记录发现' : text.substring(0, 30);

      const actionId = nextNodeId();
      nodes.push({
        id: actionId,
        type: 'action',
        label,
        description: text.substring(0, 120),
        codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      edges.push({ id: nextEdgeId(), source: currentPrev, target: actionId, type: 'next' });
      currentPrev = actionId;
    }
  }

  return currentPrev;
}

// ==================== if 语句解析 ====================

function parseIfStatement(
  ifStmt: IfStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  prevId: string,
): string {
  const condText = ifStmt.getExpression().getText();
  const condId = nextNodeId();

  nodes.push({
    id: condId,
    type: 'condition',
    label: summarizeCondition(condText, helperNames),
    description: condText,
    conditionText: condText.length > 60 ? condText.substring(0, 58) + '..' : condText,
    codeRange: { startLine: ifStmt.getStartLineNumber(), endLine: ifStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });
  edges.push({ id: nextEdgeId(), source: prevId, target: condId, type: 'next' });

  const thenBlock = ifStmt.getThenStatement();
  const elseStmt = ifStmt.getElseStatement();

  // 检查 then 块是否以 continue/return/break 结尾
  const thenEndsWithJump = Node.isBlock(thenBlock) && blockEndsWithJump(thenBlock);

  if (thenEndsWithJump && !elseStmt) {
    // 常见模式：if (cond) { ...; continue; } — 不需要汇合节点
    // true 分支
    if (Node.isBlock(thenBlock)) {
      const thenEndId = parseBlock(thenBlock, nodes, edges, helperNames, condId);
      if (thenEndId !== condId) {
        // 找到 true 分支第一个子节点
        const firstThenChild = findFirstChild(condId, thenEndId, edges);
        if (firstThenChild) {
          // 把 condId → firstThenChild 的 next 边标记为 true
          markEdgeType(condId, firstThenChild, edges, '是', 'true');
        }
      } else {
        edges.push({ id: nextEdgeId(), source: condId, target: condId, label: '是', type: 'true' });
      }
    }
    // false 分支 → 连到后续（返回 condId，让后续语句从 condId 的 false 出发）
    // 用一个占位 ID，让调用方连接
    const passId = nextNodeId();
    nodes.push({
      id: passId,
      type: 'action',
      label: '继续',
      description: '',
      codeRange: { startLine: ifStmt.getEndLineNumber(), endLine: ifStmt.getEndLineNumber() },
      position: { x: 0, y: 0 },
    });
    edges.push({ id: nextEdgeId(), source: condId, target: passId, label: '否', type: 'false' });
    return passId;
  }

  // 通用处理：有汇合
  const mergeId = nextNodeId();
  nodes.push({
    id: mergeId,
    type: 'action',
    label: '▸',
    description: '',
    codeRange: { startLine: ifStmt.getEndLineNumber(), endLine: ifStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });

  // true 分支
  if (Node.isBlock(thenBlock)) {
    const thenEndId = parseBlock(thenBlock, nodes, edges, helperNames, condId);
    const firstThenChild = findFirstChild(condId, thenEndId, edges);
    if (firstThenChild) {
      markEdgeType(condId, firstThenChild, edges, '是', 'true');
    }
    if (!thenEndsWithJump) {
      edges.push({ id: nextEdgeId(), source: thenEndId, target: mergeId, type: 'next' });
    }
  }

  // false 分支
  if (elseStmt) {
    if (Node.isBlock(elseStmt)) {
      const elseEndId = parseBlock(elseStmt, nodes, edges, helperNames, condId);
      const firstElseChild = findFirstChild(condId, elseEndId, edges);
      if (firstElseChild) {
        markEdgeType(condId, firstElseChild, edges, '否', 'false');
      }
      edges.push({ id: nextEdgeId(), source: elseEndId, target: mergeId, type: 'next' });
    } else if (Node.isIfStatement(elseStmt)) {
      const elseIfEndId = parseIfStatement(elseStmt, nodes, edges, helperNames, condId);
      const firstElseChild = findFirstChild(condId, elseIfEndId, edges);
      if (firstElseChild) {
        markEdgeType(condId, firstElseChild, edges, '否', 'false');
      }
      edges.push({ id: nextEdgeId(), source: elseIfEndId, target: mergeId, type: 'next' });
    }
  } else {
    edges.push({ id: nextEdgeId(), source: condId, target: mergeId, label: '否', type: 'false' });
  }

  return mergeId;
}

// ==================== for 语句解析 ====================

function parseForStatement(
  forStmt: ForStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperNames: Set<string>,
  prevId: string,
): string {
  const initText = forStmt.getInitializer()?.getText() || '';
  const condText = forStmt.getCondition()?.getText() || '';

  const loopId = nextNodeId();
  nodes.push({
    id: loopId,
    type: 'loop',
    label: summarizeLoop(initText, condText),
    description: `for (${initText}; ${condText}; ...)`,
    conditionText: condText,
    codeRange: { startLine: forStmt.getStartLineNumber(), endLine: forStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });
  edges.push({ id: nextEdgeId(), source: prevId, target: loopId, type: 'next' });

  // 循环体
  const body = forStmt.getStatement();
  if (Node.isBlock(body)) {
    const bodyEndId = parseBlock(body, nodes, edges, helperNames, loopId);
    if (bodyEndId !== loopId) {
      edges.push({ id: nextEdgeId(), source: bodyEndId, target: loopId, type: 'loop-back', label: '继续循环' });
    }
  }

  return loopId; // 循环节点本身就是出口，后续节点直接连到它
}

// ==================== 工具函数 ====================

function blockEndsWithJump(block: Block): boolean {
  const last = block.getStatements().at(-1);
  if (!last) return false;
  const kind = last.getKind();
  if (kind === SyntaxKind.ContinueStatement || kind === SyntaxKind.ReturnStatement || kind === SyntaxKind.BreakStatement) {
    return true;
  }
  // if 块最后是 if，且 if 内以 jump 结尾
  if (kind === SyntaxKind.IfStatement) {
    const then = (last as IfStatement).getThenStatement();
    if (Node.isBlock(then)) return blockEndsWithJump(then);
  }
  return false;
}

/** 从 edges 中找到 sourceId 的第一个 next 类型子节点 */
function findFirstChild(sourceId: string, endId: string, edges: FlowEdge[]): string | null {
  for (const e of edges) {
    if (e.source === sourceId && e.type === 'next' && e.target !== sourceId) {
      return e.target;
    }
  }
  return null;
}

/** 将 source→target 的边标记为指定类型 */
function markEdgeType(source: string, target: string, edges: FlowEdge[], label: string, type: 'true' | 'false') {
  for (const e of edges) {
    if (e.source === source && e.target === target && e.type === 'next') {
      e.type = type;
      e.label = label;
      return;
    }
  }
}

/** 通用条件摘要：从代码条件自动推导人类可读标签 */
function summarizeCondition(condText: string, helperNames: Set<string>): string {
  // 优先匹配辅助函数调用
  for (const name of helperNames) {
    if (condText.includes(name)) {
      const negated = condText.includes(`!${name}`);
      const readable = camelToReadable(name);
      return negated ? `${readable}?（否）` : `${readable}?`;
    }
  }

  // 通用模式匹配
  if (condText.includes('.passed')) return '条件是否通过?';
  if (condText.includes('===') || condText.includes('!==')) {
    const match = condText.match(/(\w+)\s*[!=]==?\s*(.+)/);
    if (match) return `${match[1]} == ${match[2].substring(0, 15)}?`;
  }
  if (condText.length > 35) return condText.substring(0, 33) + '..';
  return condText + '?';
}

/** 通用循环摘要 */
function summarizeLoop(initText: string, condText: string): string {
  // 遍历数据行
  if (condText.includes('data.length') || condText.includes('.length')) return '遍历数据行';
  // 提取循环范围
  const rangeMatch = condText.match(/<=?\s*(\d+)/);
  if (rangeMatch) return `循环 ${rangeMatch[1]} 次检查`;
  return `循环`;
}

/** 驼峰命名 → 可读中文标签 */
function camelToReadable(name: string): string {
  // check/is 前缀去掉，拼接剩余
  const stripped = name
    .replace(/^(check|is|has|can|should|get|find|scan|compute|calc)/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
  if (!stripped) return name;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function extractFunctionSummary(fn: FunctionDeclaration): string {
  const jsDocs = fn.getJsDocs();
  if (jsDocs.length > 0) return jsDocs[0].getComment()?.toString() || fn.getName() || '';
  const body = fn.getBody();
  if (body && Node.isBlock(body)) {
    const first = body.getStatements()[0];
    if (first) return first.getText().substring(0, 60);
  }
  return fn.getName() || 'function';
}

// ==================== 自动布局 ====================

function autoLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  if (nodes.length === 0) return;

  const startNode = nodes.find(n => n.type === 'start') || nodes[0];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type === 'loop-back') continue; // 回边不参与分层
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  const levels = new Map<string, number>();
  const queue = [startNode.id];
  levels.set(startNode.id, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) || 0;
    const children = adjacency.get(current) || [];

    for (const child of children) {
      if (!levels.has(child)) {
        levels.set(child, level + 1);
        queue.push(child);
      }
    }
  }

  // 未被 BFS 到的节点放到最底部
  const maxLevel = Math.max(...Array.from(levels.values()), 0);
  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, maxLevel + 1);
  }

  // 按层分配坐标
  const levelCounts = new Map<number, number>();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    const col = levelCounts.get(level) || 0;
    levelCounts.set(level, col + 1);
    node.position = { x: 250 + col * 220, y: 60 + level * 100 };
  }
}
