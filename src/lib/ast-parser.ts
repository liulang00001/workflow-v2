/**
 * AST 解析器：TypeScript 代码 → 流程图
 *
 * 使用 ts-morph 解析代码的控制流结构，自动生成流程图节点和边。
 * 核心映射关系：
 *   - 函数声明 → action 节点
 *   - if/else   → condition 节点 + true/false 分支边
 *   - for/while → loop 节点 + loop-back 边
 *   - return    → end 节点
 *   - 函数调用  → action 节点（引用）
 */
import { Project, SyntaxKind, Node, FunctionDeclaration, IfStatement, ForStatement, Block, SourceFile } from 'ts-morph';
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

  // 1. 提取所有顶层函数作为"模块"
  const functions = sourceFile.getFunctions();
  const analyzeFunc = functions.find(f => f.getName() === 'analyze');
  const helperFuncs = functions.filter(f => f.getName() !== 'analyze');

  // 2. 为每个辅助函数生成一个摘要节点（折叠展示）
  const helperNodeMap = new Map<string, string>();
  for (const fn of helperFuncs) {
    const id = nextNodeId();
    const name = fn.getName() || 'anonymous';
    helperNodeMap.set(name, id);
    nodes.push({
      id,
      type: 'action',
      label: name,
      description: extractFunctionSummary(fn),
      codeRange: { startLine: fn.getStartLineNumber(), endLine: fn.getEndLineNumber() },
      position: { x: 0, y: 0 }, // layout 后设置
    });
  }

  // 3. 解析 analyze 函数的控制流
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
      const lastId = parseBlock(body, nodes, edges, helperNodeMap, startId);

      // 添加结束节点
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

  // 4. 自动布局
  autoLayout(nodes, edges);

  return { nodes, edges };
}

/** 解析代码块，返回最后一个节点的 ID */
function parseBlock(
  block: Block,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperMap: Map<string, string>,
  prevId: string,
): string {
  let currentPrev = prevId;

  for (const stmt of block.getStatements()) {
    const kind = stmt.getKind();

    // if 语句 → 条件分支节点
    if (kind === SyntaxKind.IfStatement) {
      const ifStmt = stmt as IfStatement;
      currentPrev = parseIfStatement(ifStmt, nodes, edges, helperMap, currentPrev);
    }
    // for 语句 → 循环节点
    else if (kind === SyntaxKind.ForStatement) {
      const forStmt = stmt as ForStatement;
      currentPrev = parseForStatement(forStmt, nodes, edges, helperMap, currentPrev);
    }
    // continue → 跳过（循环内处理）
    else if (kind === SyntaxKind.ContinueStatement) {
      // continue 会在 loop 内处理
    }
    // return 语句
    else if (kind === SyntaxKind.ReturnStatement) {
      const retId = nextNodeId();
      nodes.push({
        id: retId,
        type: 'action',
        label: 'return',
        description: stmt.getText().substring(0, 80),
        codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      edges.push({ id: nextEdgeId(), source: currentPrev, target: retId, type: 'next' });
      currentPrev = retId;
    }
    // 表达式语句（函数调用、赋值等）
    else if (kind === SyntaxKind.ExpressionStatement) {
      const text = stmt.getText();
      // 检查是否包含辅助函数调用
      const calledHelper = findCalledHelper(text, helperMap);
      const label = calledHelper || summarizeExpression(text);

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
    // 变量声明
    else if (kind === SyntaxKind.VariableStatement) {
      const text = stmt.getText();
      const calledHelper = findCalledHelper(text, helperMap);
      const label = calledHelper || summarizeExpression(text);

      const varId = nextNodeId();
      nodes.push({
        id: varId,
        type: 'action',
        label,
        description: text.substring(0, 120),
        codeRange: { startLine: stmt.getStartLineNumber(), endLine: stmt.getEndLineNumber() },
        position: { x: 0, y: 0 },
      });
      edges.push({ id: nextEdgeId(), source: currentPrev, target: varId, type: 'next' });
      currentPrev = varId;
    }
  }

  return currentPrev;
}

/** 解析 if 语句 */
function parseIfStatement(
  ifStmt: IfStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperMap: Map<string, string>,
  prevId: string,
): string {
  const condText = ifStmt.getExpression().getText();
  const condId = nextNodeId();

  nodes.push({
    id: condId,
    type: 'condition',
    label: summarizeCondition(condText),
    description: condText,
    conditionText: condText,
    codeRange: { startLine: ifStmt.getStartLineNumber(), endLine: ifStmt.getStartLineNumber() },
    position: { x: 0, y: 0 },
  });
  edges.push({ id: nextEdgeId(), source: prevId, target: condId, type: 'next' });

  // true 分支
  const thenBlock = ifStmt.getThenStatement();
  const mergeId = nextNodeId();
  nodes.push({
    id: mergeId,
    type: 'action',
    label: '(汇合)',
    description: '',
    codeRange: { startLine: ifStmt.getEndLineNumber(), endLine: ifStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });

  if (Node.isBlock(thenBlock)) {
    const thenEndId = parseBlock(thenBlock, nodes, edges, helperMap, condId);
    // 检查 then 块是否以 continue/return 结尾（不需要连接到 merge）
    const lastStmt = thenBlock.getStatements().at(-1);
    const endsWithJump = lastStmt && (lastStmt.getKind() === SyntaxKind.ContinueStatement || lastStmt.getKind() === SyntaxKind.ReturnStatement);

    edges.push({ id: nextEdgeId(), source: condId, target: nodes.find(n => n.id === thenEndId) ? thenEndId : condId, label: '是', type: 'true' });
    if (!endsWithJump) {
      edges.push({ id: nextEdgeId(), source: thenEndId, target: mergeId, type: 'next' });
    }
  }

  // false 分支
  const elseStmt = ifStmt.getElseStatement();
  if (elseStmt) {
    if (Node.isBlock(elseStmt)) {
      const elseEndId = parseBlock(elseStmt, nodes, edges, helperMap, condId);
      edges.push({ id: nextEdgeId(), source: condId, target: elseEndId !== condId ? elseEndId : condId, label: '否', type: 'false' });
      edges.push({ id: nextEdgeId(), source: elseEndId, target: mergeId, type: 'next' });
    } else if (Node.isIfStatement(elseStmt)) {
      // else if 递归
      const elseIfEndId = parseIfStatement(elseStmt, nodes, edges, helperMap, condId);
      edges.push({ id: nextEdgeId(), source: condId, target: elseIfEndId, label: '否', type: 'false' });
    }
  } else {
    edges.push({ id: nextEdgeId(), source: condId, target: mergeId, label: '否', type: 'false' });
  }

  return mergeId;
}

/** 解析 for 语句 */
function parseForStatement(
  forStmt: ForStatement,
  nodes: FlowNode[],
  edges: FlowEdge[],
  helperMap: Map<string, string>,
  prevId: string,
): string {
  const initText = forStmt.getInitializer()?.getText() || '';
  const condText = forStmt.getCondition()?.getText() || '';
  const loopLabel = summarizeLoop(initText, condText);

  const loopId = nextNodeId();
  nodes.push({
    id: loopId,
    type: 'loop',
    label: loopLabel,
    description: `for (${initText}; ${condText}; ...)`,
    conditionText: condText,
    codeRange: { startLine: forStmt.getStartLineNumber(), endLine: forStmt.getStartLineNumber() },
    position: { x: 0, y: 0 },
  });
  edges.push({ id: nextEdgeId(), source: prevId, target: loopId, type: 'next' });

  // 循环体
  const body = forStmt.getStatement();
  if (Node.isBlock(body)) {
    const bodyEndId = parseBlock(body, nodes, edges, helperMap, loopId);
    // loop-back 边
    edges.push({ id: nextEdgeId(), source: bodyEndId, target: loopId, type: 'loop-back', label: '继续循环' });
  }

  // 循环结束出口
  const exitId = nextNodeId();
  nodes.push({
    id: exitId,
    type: 'action',
    label: '循环结束',
    description: `${loopLabel} 遍历完成`,
    codeRange: { startLine: forStmt.getEndLineNumber(), endLine: forStmt.getEndLineNumber() },
    position: { x: 0, y: 0 },
  });
  edges.push({ id: nextEdgeId(), source: loopId, target: exitId, label: '遍历完成', type: 'next' });

  return exitId;
}

// ==================== 工具函数 ====================

function extractFunctionSummary(fn: FunctionDeclaration): string {
  // 提取函数的第一行注释或首行逻辑
  const jsDocs = fn.getJsDocs();
  if (jsDocs.length > 0) return jsDocs[0].getComment()?.toString() || fn.getName() || '';

  const body = fn.getBody();
  if (body && Node.isBlock(body)) {
    const first = body.getStatements()[0];
    if (first) return first.getText().substring(0, 60);
  }
  return fn.getName() || 'function';
}

function findCalledHelper(text: string, helperMap: Map<string, string>): string | null {
  for (const [name] of helperMap) {
    if (text.includes(`${name}(`)) return name;
  }
  return null;
}

function summarizeExpression(text: string): string {
  // 精简表达式为短标签
  if (text.includes('console.log')) return 'log';
  if (text.includes('.push(')) {
    const match = text.match(/(\w+)\.push/);
    return match ? `添加到 ${match[1]}` : 'push';
  }
  if (text.includes('findings.push')) return '记录发现';
  if (text.length > 30) return text.substring(0, 28) + '..';
  return text.replace(/;$/, '');
}

function summarizeCondition(condText: string): string {
  // 将代码条件简化为人类可读标签
  if (condText.includes('!allDoorsClosed') || condText.includes('allDoorsClosed')) return '所有门是否关闭';
  if (condText.includes('isLeavingCar')) return '是否离车场景';
  if (condText.includes('checkBluetooth')) return '蓝牙是否连接';
  if (condText.includes('checkBasicConditions')) return '基础条件检查';
  if (condText.includes('checkLockPosition')) return '蓝牙定位检查';
  if (condText.includes('doorJustClosed')) return '检测到门关闭跳变';
  if (condText.includes('.passed')) return '条件是否通过';
  if (condText.length > 40) return condText.substring(0, 38) + '..';
  return condText;
}

function summarizeLoop(initText: string, condText: string): string {
  if (condText.includes('data.length')) return '遍历所有数据行';
  if (condText.includes('<= 8') || condText.includes('< 8')) return '8秒连续检查';
  if (condText.includes('<= 608') || condText.includes('600')) return '600秒定位检查';
  return `循环: ${condText.substring(0, 30)}`;
}

/** 自动布局：简单的层次布局 */
function autoLayout(nodes: FlowNode[], edges: FlowEdge[]) {
  // BFS 分层
  if (nodes.length === 0) return;

  const startNode = nodes.find(n => n.type === 'start') || nodes[0];
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
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

  // 按层分配坐标
  const levelCounts = new Map<number, number>();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    const col = levelCounts.get(level) || 0;
    levelCounts.set(level, col + 1);
    node.position = { x: 250 + col * 220, y: 60 + level * 120 };
  }
}
