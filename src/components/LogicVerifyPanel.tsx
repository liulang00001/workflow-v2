'use client';

import { useState } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Info, ChevronDown, ChevronRight,
  Wrench, RefreshCw, Shield, Clock, FileSearch, Zap
} from 'lucide-react';

// === 类型定义 ===

export interface VerifyItem {
  id: string;
  category: string;
  title: string;
  nlLogic: string;
  codeLogic: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  suggestion: string;
}

export interface VerifyResult {
  passed: boolean;
  summary: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  items: VerifyItem[];
}

export interface FixReport {
  fixedItems: { id: string; title: string; description: string; linesChanged?: string; before?: string; after?: string }[];
  version: number;
  changesSummary: string;
}

export interface DiffInfo {
  similarity: number;
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
  isLikelyRewrite: boolean;
  changes: { line: number; type: 'modified' | 'added' | 'removed'; before?: string; after?: string }[];
}

export interface ParsedLogicPoint {
  id: string;
  category: string;
  title: string;
  description: string;
  expectedBehavior: string;
  constraints: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface ParsedLogic {
  totalPoints: number;
  logicPoints: ParsedLogicPoint[];
}

export interface CodeVersion {
  version: number;
  code: string;
  timestamp: string;
  source: 'generated' | 'fixed' | 'manual';
}

// === Category 显示名映射 ===
const CATEGORY_LABELS: Record<string, string> = {
  trigger_condition: '触发条件',
  judge_logic: '判断逻辑',
  time_window: '时间窗口',
  branch_handling: '分支处理',
  output_format: '输出格式',
  edge_case: '边界情况',
  data_access: '数据访问',
  loop_logic: '循环逻辑',
  helper_function: '辅助函数',
  other: '其他',
};

// === 组件 Props ===

interface LogicVerifyPanelProps {
  description: string;
  code: string;
  codeVersion: number;
  parsedLogic: ParsedLogic | null;
  isParsing: boolean;
  verifyResult: VerifyResult | null;
  fixReport: FixReport | null;
  diffInfo: DiffInfo | null;
  verifyHistory: { version: number; result: VerifyResult; timestamp: string }[];
  isVerifying: boolean;
  isFixing: boolean;
  onParseNL: () => void;
  onVerify: () => void;
  onFix: (failedItems: VerifyItem[]) => void;
}

export default function LogicVerifyPanel({
  description,
  code,
  codeVersion,
  parsedLogic,
  isParsing,
  verifyResult,
  fixReport,
  diffInfo,
  verifyHistory,
  isVerifying,
  isFixing,
  onParseNL,
  onVerify,
  onFix,
}: LogicVerifyPanelProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const failedItems = verifyResult?.items.filter(i => !i.passed) || [];
  const hasCode = !!code.trim();
  const hasDescription = !!description.trim();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部控制栏 */}
      <div className="shrink-0 p-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-[var(--accent)]" />
            <h2 className="font-bold text-sm">逻辑校验</h2>
            <span className="text-xs text-[var(--muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
              代码版本 v{codeVersion}
            </span>
            {parsedLogic && (
              <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                ✓ 已解析 {parsedLogic.totalPoints} 逻辑点
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 步骤1: 解析需求（只需一次） */}
            <button
              onClick={onParseNL}
              disabled={!hasDescription || isParsing || !!parsedLogic}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition disabled:opacity-40 ${
                parsedLogic
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-blue-500 text-white hover:opacity-90'
              }`}
            >
              {isParsing ? (
                <><RefreshCw size={13} className="animate-spin" /> 解析中...</>
              ) : parsedLogic ? (
                <><CheckCircle2 size={13} /> 1. 已解析</>
              ) : (
                <><FileSearch size={13} /> 1. 解析需求</>
              )}
            </button>

            {/* 步骤2: 对比代码（可多次） */}
            <button
              onClick={onVerify}
              disabled={!hasCode || !parsedLogic || isVerifying || isFixing || isParsing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
            >
              {isVerifying ? (
                <><RefreshCw size={13} className="animate-spin" /> 校验中...</>
              ) : (
                <><Zap size={13} /> 2. 对比代码</>
              )}
            </button>

            {/* 步骤3: 一键修复（始终显示） */}
            <button
              onClick={() => onFix(failedItems)}
              disabled={failedItems.length === 0 || isFixing || isVerifying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500 text-white rounded hover:opacity-90 transition disabled:opacity-40"
            >
              {isFixing ? (
                <><Wrench size={13} className="animate-spin" /> 修复中...</>
              ) : (
                <><Wrench size={13} /> 3. 一键修复{failedItems.length > 0 ? ` (${failedItems.length}项)` : ''}</>
              )}
            </button>
          </div>
        </div>

        {/* 缺少条件提示 */}
        {(!hasDescription || !hasCode) && (
          <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded">
            {!hasDescription && '⚠️ 请先输入自然语言描述。'}
            {!hasCode && '⚠️ 请先生成代码。'}
          </div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* 解析中 loading */}
        {isParsing && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <FileSearch size={36} className="mb-4 animate-pulse text-blue-500" />
            <p className="text-sm">正在解析自然语言需求...</p>
            <p className="text-xs mt-1">LLM 正在提取结构化逻辑检查点（仅需一次）</p>
          </div>
        )}

        {/* 已解析的逻辑点展示 */}
        {parsedLogic && !isParsing && !isVerifying && !verifyResult && (
          <div className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileSearch size={16} className="text-blue-500" />
                <span className="font-bold text-sm">已解析的逻辑检查点（{parsedLogic.totalPoints} 项）</span>
                <span className="text-[10px] text-[var(--muted)]">后续校验将复用此结果</span>
              </div>
              <div className="space-y-2">
                {parsedLogic.logicPoints.map((lp, idx) => (
                  <div key={lp.id} className="text-xs bg-white rounded px-3 py-2 border border-blue-100">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[var(--muted)]">{idx + 1}.</span>
                      <span className="font-medium">{lp.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">
                        {CATEGORY_LABELS[lp.category] || lp.category}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        lp.priority === 'high' ? 'bg-red-100 text-red-600'
                          : lp.priority === 'medium' ? 'bg-amber-100 text-amber-600'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {lp.priority === 'high' ? '高' : lp.priority === 'medium' ? '中' : '低'}
                      </span>
                    </div>
                    <div className="text-[var(--muted)]">{lp.description}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-center text-xs text-[var(--muted)]">
              点击「对比代码」将以上逻辑点与当前代码进行比对
            </div>
          </div>
        )}

        {/* 无结果状态 */}
        {!parsedLogic && !verifyResult && !isVerifying && !isParsing && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <Shield size={48} className="mb-4 opacity-30" />
            <p className="text-sm">点击「解析需求」提取逻辑检查点</p>
            <p className="text-xs mt-1">解析只需一次，后续校验和修复后的重新校验将复用结果</p>
          </div>
        )}

        {/* 校验中 loading */}
        {isVerifying && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
            <RefreshCw size={36} className="mb-4 animate-spin text-[var(--accent)]" />
            <p className="text-sm">正在对比逻辑点与代码实现...</p>
            <p className="text-xs mt-1">基于已解析的 {parsedLogic?.totalPoints || 0} 个逻辑点进行检查</p>
          </div>
        )}

        {/* 校验结果 */}
        {verifyResult && !isVerifying && (
          <>
            {/* 总览卡片 */}
            <div className={`rounded-lg p-4 ${
              verifyResult.passed
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                {verifyResult.passed ? (
                  <CheckCircle2 size={24} className="text-green-500" />
                ) : (
                  <XCircle size={24} className="text-red-500" />
                )}
                <div>
                  <div className="font-bold text-sm">
                    {verifyResult.passed ? '✅ 逻辑校验通过' : '❌ 发现逻辑差异'}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">{verifyResult.summary}</div>
                </div>
              </div>

              {/* 统计栏 */}
              <div className="flex gap-4 mt-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-blue-400" />
                  总计 {verifyResult.totalChecks} 项
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                  通过 {verifyResult.passedChecks} 项
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  差异 {verifyResult.failedChecks} 项
                </div>
              </div>

              {/* 进度条 */}
              <div className="mt-3 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all bg-green-400"
                  style={{ width: `${(verifyResult.passedChecks / verifyResult.totalChecks) * 100}%` }}
                />
              </div>
            </div>

            {/* 检查项列表 */}
            <div className="space-y-2">
              {verifyResult.items.map(item => (
                <div
                  key={item.id}
                  className={`rounded-lg border transition ${
                    item.passed
                      ? 'border-green-200 bg-green-50/50'
                      : item.severity === 'error'
                      ? 'border-red-200 bg-red-50/50'
                      : 'border-amber-200 bg-amber-50/50'
                  }`}
                >
                  {/* 检查项标题 */}
                  <button
                    onClick={() => toggleItem(item.id)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left"
                  >
                    {/* 状态图标 */}
                    {item.passed ? (
                      <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                    ) : item.severity === 'error' ? (
                      <XCircle size={16} className="text-red-500 shrink-0" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                    )}

                    {/* 标题和分类 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {CATEGORY_LABELS[item.category] || item.category}
                      </div>
                    </div>

                    {/* 展开/收起 */}
                    {expandedItems.has(item.id) ? (
                      <ChevronDown size={14} className="text-[var(--muted)] shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-[var(--muted)] shrink-0" />
                    )}
                  </button>

                  {/* 展开内容 */}
                  {expandedItems.has(item.id) && (
                    <div className="px-4 pb-4 pt-0 space-y-3 text-xs border-t border-gray-100">
                      {/* 自然语言逻辑 */}
                      <div>
                        <div className="font-bold text-[var(--muted)] uppercase mb-1 flex items-center gap-1">
                          <Info size={11} /> 需求描述中的逻辑
                        </div>
                        <div className="bg-blue-50 border border-blue-100 rounded px-3 py-2 text-blue-800">
                          {item.nlLogic}
                        </div>
                      </div>

                      {/* 代码逻辑 */}
                      <div>
                        <div className="font-bold text-[var(--muted)] uppercase mb-1 flex items-center gap-1">
                          <Info size={11} /> 代码中的实现
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800 font-mono">
                          {item.codeLogic}
                        </div>
                      </div>

                      {/* 修改建议 */}
                      {!item.passed && item.suggestion && (
                        <div>
                          <div className="font-bold text-[var(--muted)] uppercase mb-1 flex items-center gap-1">
                            <Wrench size={11} /> 修改建议
                          </div>
                          <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-800">
                            {item.suggestion}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Diff 统计 */}
            {diffInfo && (
              <div className={`rounded-lg border p-4 ${
                diffInfo.isLikelyRewrite
                  ? 'border-red-300 bg-red-50/50'
                  : 'border-emerald-200 bg-emerald-50/50'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Info size={16} className={diffInfo.isLikelyRewrite ? 'text-red-500' : 'text-emerald-500'} />
                  <span className="font-bold text-sm">
                    代码变更统计 — 相似度 {diffInfo.similarity}%
                  </span>
                  {diffInfo.isLikelyRewrite && (
                    <span className="px-2 py-0.5 text-[10px] bg-red-200 text-red-700 rounded-full font-bold">
                      ⚠ 疑似重写
                    </span>
                  )}
                </div>

                {diffInfo.isLikelyRewrite && (
                  <div className="text-xs text-red-600 mb-2 bg-red-100 px-3 py-2 rounded">
                    相似度低于 70%，LLM 可能重写了代码而非增量修复。建议检查修复结果，必要时手动回退。
                  </div>
                )}

                <div className="flex gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded bg-gray-400" />
                    未变 {diffInfo.unchanged} 行
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded bg-amber-400" />
                    修改 {diffInfo.changed} 行
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded bg-green-400" />
                    新增 {diffInfo.added} 行
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded bg-red-400" />
                    删除 {diffInfo.removed} 行
                  </div>
                </div>

                {/* 相似度进度条 */}
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      diffInfo.similarity >= 90 ? 'bg-emerald-400'
                        : diffInfo.similarity >= 70 ? 'bg-amber-400'
                        : 'bg-red-400'
                    }`}
                    style={{ width: `${diffInfo.similarity}%` }}
                  />
                </div>

                {/* 具体变更明细（折叠） */}
                {diffInfo.changes.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--fg)]">
                      查看变更明细 ({diffInfo.changes.length} 处)
                    </summary>
                    <div className="mt-2 space-y-1 max-h-40 overflow-auto">
                      {diffInfo.changes.map((c, idx) => (
                        <div key={idx} className="text-[11px] font-mono bg-white rounded px-2 py-1 border border-gray-100">
                          <span className="text-[var(--muted)]">L{c.line}</span>
                          {c.type === 'modified' && (
                            <>
                              <div className="text-red-500 line-through">{c.before}</div>
                              <div className="text-green-600">{c.after}</div>
                            </>
                          )}
                          {c.type === 'added' && <div className="text-green-600">+ {c.after}</div>}
                          {c.type === 'removed' && <div className="text-red-500">- {c.before}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* 修复报告 */}
            {fixReport && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wrench size={16} className="text-blue-500" />
                  <span className="font-bold text-sm">修复报告 (v{fixReport.version})</span>
                </div>
                <p className="text-xs text-gray-600 mb-3">{fixReport.changesSummary}</p>
                <div className="space-y-2">
                  {fixReport.fixedItems.map((fi, idx) => (
                    <div key={idx} className="text-xs">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                        <span className="font-medium">{fi.title}</span>
                        <span className="text-[var(--muted)]">— {fi.description}</span>
                      </div>
                      {/* 显示 before/after 对比 */}
                      {fi.before && fi.after && (
                        <div className="ml-5 mt-1 font-mono text-[11px] bg-white rounded px-2 py-1 border border-gray-100">
                          <div className="text-red-500 line-through">{fi.before}</div>
                          <div className="text-green-600">{fi.after}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* 校验历史 */}
        {verifyHistory.length > 0 && (
          <div className="border border-[var(--border)] rounded-lg">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
            >
              <Clock size={14} />
              校验历史 ({verifyHistory.length})
              {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {showHistory && (
              <div className="px-4 pb-3 space-y-2">
                {verifyHistory.map((h, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-xs py-1.5 border-t border-[var(--border)]">
                    <span className="text-[var(--muted)]">v{h.version}</span>
                    {h.result.passed ? (
                      <CheckCircle2 size={12} className="text-green-500" />
                    ) : (
                      <XCircle size={12} className="text-red-500" />
                    )}
                    <span>
                      {h.result.passedChecks}/{h.result.totalChecks} 通过
                    </span>
                    <span className="text-[var(--muted)] ml-auto">
                      {new Date(h.timestamp).toLocaleString('zh-CN', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
