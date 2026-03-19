// ==================== 核心数据类型 ====================

/** 流程图节点 — 从 AST 解析自动生成 */
export interface FlowNode {
  id: string;
  type: 'start' | 'end' | 'condition' | 'action' | 'loop';
  label: string;
  /** 对应源码行号范围 */
  codeRange: { startLine: number; endLine: number };
  /** 人类可读的逻辑描述 */
  description: string;
  /** 条件节点的条件表达式文本 */
  conditionText?: string;
  position: { x: number; y: number };
}

/** 流程图边 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: 'true' | 'false' | 'next' | 'loop-back';
}

/** 从 AST 解析出的流程图 */
export interface FlowChart {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 信号定义 */
export interface SignalDef {
  name: string;
  description: string;
  values?: Record<string, string>;
}

/** 项目状态 — 整个应用的状态 */
export interface ProjectState {
  /** 用户自然语言描述 */
  description: string;
  /** LLM 生成的分析代码 */
  generatedCode: string;
  /** 从代码 AST 解析出的流程图 */
  flowChart: FlowChart | null;
  /** 信号定义列表 */
  signals: SignalDef[];
  /** 上传的数据 */
  data: DataTable | null;
  /** 执行结果 */
  result: ExecutionResult | null;
  /** 状态 */
  status: 'idle' | 'generating' | 'parsing' | 'executing' | 'done' | 'error';
  error?: string;
}

/** 上传的表格数据 */
export interface DataTable {
  headers: string[];
  rows: (string | number)[][];
  fileName: string;
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  findings: Finding[];
  timeline: TimelineEntry[];
  summary: string;
  /** 执行耗时(ms) */
  duration: number;
  /** 代码执行过程的 console 输出 */
  logs: string[];
}

/** 分析发现 */
export interface Finding {
  time: string;
  type: 'lock' | 'unlock' | 'info' | 'error';
  message: string;
  details?: Record<string, any>;
}

/** 时间轴条目 */
export interface TimelineEntry {
  time: string;
  event: string;
  row?: number;
}
