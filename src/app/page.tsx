'use client';

import { useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { FlowChart, DataTable, ExecutionResult, SignalDef } from '@/lib/types';
import ResultPanel from '@/components/ResultPanel';
import { FileUp, Play, Sparkles, Code2, GitBranch, Terminal } from 'lucide-react';

// 动态加载避免 SSR 问题
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), { ssr: false });
const FlowChartView = dynamic(() => import('@/components/FlowChart'), { ssr: false });

type Tab = 'code' | 'flow' | 'result';

export default function Home() {
  // === 核心状态 ===
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [flowChart, setFlowChart] = useState<FlowChart | null>(null);
  const [data, setData] = useState<DataTable | null>(null);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'parsing' | 'executing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('code');
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 步骤 1: 自然语言 → 代码 ===
  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return;
    setStatus('generating');
    setError(null);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setCode(json.code);
      setActiveTab('code');

      // 自动解析流程图
      await parseFlowChart(json.code);
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  }, [description]);

  // === 步骤 2: 代码 → 流程图 (AST) ===
  const parseFlowChart = useCallback(async (codeToparse?: string) => {
    const target = codeToparse || code;
    if (!target.trim()) return;
    setStatus('parsing');

    try {
      const res = await fetch('/api/parse-ast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: target }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setFlowChart(json.flowChart);
    } catch (e) {
      console.error('AST parse error:', e);
      // 流程图解析失败不阻塞主流程
    } finally {
      setStatus('idle');
    }
  }, [code]);

  // === 文件上传 ===
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 动态加载 xlsx
    const XLSX = await import('xlsx');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (raw.length < 2) {
      setError('Excel 文件至少需要 2 行（标题 + 数据）');
      return;
    }

    const headers = raw[0].map(String);
    const rows = raw.slice(1).map(row =>
      headers.map((_, i) => {
        const v = row[i];
        if (v === undefined || v === null) return 0;
        const num = Number(v);
        return isNaN(num) ? v : num;
      })
    );

    setData({ headers, rows, fileName: file.name });
    setError(null);
  }, []);

  // === 步骤 3: 执行代码 ===
  const handleExecute = useCallback(async () => {
    if (!code.trim() || !data) {
      setError('需要代码和数据才能执行');
      return;
    }
    setStatus('executing');
    setError(null);

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, data }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setResult(json.result);
      setActiveTab('result');
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  }, [code, data]);

  // === 流程图节点点击 → 高亮代码 ===
  const handleNodeClick = useCallback((nodeId: string, codeRange: { startLine: number; endLine: number }) => {
    setHighlightRange(codeRange);
    setActiveTab('code');
  }, []);

  // === 代码编辑后重新解析流程图 ===
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
    // 防抖：编辑停止 1 秒后自动解析
  }, []);

  const handleReparseFlow = useCallback(() => {
    parseFlowChart();
  }, [parseFlowChart]);

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-[var(--border)] px-4 py-2 flex items-center gap-4 shrink-0">
        <h1 className="font-bold text-lg">Workflow Analyzer V2</h1>
        <span className="text-xs text-[var(--muted)]">自然语言 → 代码 → 流程图 → 执行</span>

        <div className="flex-1" />

        {/* 文件上传 */}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--accent-light)] transition"
        >
          <FileUp size={14} />
          {data ? `📄 ${data.fileName} (${data.rows.length}行)` : '上传数据'}
        </button>

        {/* 执行按钮 */}
        <button
          onClick={handleExecute}
          disabled={!code || !data || status === 'executing'}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
        >
          <Play size={14} />
          {status === 'executing' ? '执行中...' : '执行分析'}
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：输入面板 */}
        <div className="w-80 border-r border-[var(--border)] flex flex-col shrink-0">
          <div className="p-3 border-b border-[var(--border)]">
            <label className="text-xs font-bold text-[var(--muted)] uppercase">自然语言描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="描述你的分析需求，例如：&#10;&#10;分析蓝牙钥匙离车落锁问题：&#10;1. 识别四门一盖全关闭的时刻&#10;2. 排除上车场景&#10;3. 检查蓝牙连接状态&#10;4. 连续8秒基础条件检查&#10;5. 600秒蓝牙定位检查"
              className="w-full mt-2 p-2 text-sm border border-[var(--border)] rounded resize-none bg-transparent"
              rows={10}
            />
            <button
              onClick={handleGenerate}
              disabled={!description.trim() || status === 'generating'}
              className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-[var(--accent)] text-white rounded hover:opacity-90 transition disabled:opacity-40"
            >
              <Sparkles size={14} />
              {status === 'generating' ? '生成中...' : '生成分析代码'}
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mx-3 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
              {error}
            </div>
          )}

          {/* 状态信息 */}
          <div className="flex-1 p-3 overflow-auto">
            <div className="space-y-2 text-xs text-[var(--muted)]">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${code ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>代码 {code ? `✓ (${code.length} 字符)` : '未生成'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${flowChart ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>流程图 {flowChart ? `✓ (${flowChart.nodes.length} 节点)` : '未解析'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${data ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>数据 {data ? `✓ (${data.rows.length} 行)` : '未上传'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${result ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>结果 {result ? `✓ (${result.findings.length} 发现)` : '未执行'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：代码/流程图/结果 tab */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab 栏 */}
          <div className="flex border-b border-[var(--border)] shrink-0">
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'code' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Code2 size={14} /> 代码
            </button>
            <button
              onClick={() => { setActiveTab('flow'); if (code && !flowChart) handleReparseFlow(); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'flow' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <GitBranch size={14} /> 流程图
            </button>
            <button
              onClick={() => setActiveTab('result')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'result' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Terminal size={14} /> 结果 {result && `(${result.findings.length})`}
            </button>

            <div className="flex-1" />

            {activeTab === 'code' && (
              <button
                onClick={handleReparseFlow}
                disabled={!code || status === 'parsing'}
                className="mr-2 px-3 py-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition disabled:opacity-40"
              >
                {status === 'parsing' ? '解析中...' : '🔄 重新解析流程图'}
              </button>
            )}
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'code' && (
              <CodeEditor
                code={code}
                onChange={handleCodeChange}
                highlightRange={highlightRange}
              />
            )}

            {activeTab === 'flow' && (
              flowChart ? (
                <FlowChartView flowChart={flowChart} onNodeClick={handleNodeClick} />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--muted)]">
                  {code ? '点击"重新解析流程图"生成' : '请先生成代码'}
                </div>
              )
            )}

            {activeTab === 'result' && (
              result ? (
                <ResultPanel result={result} />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--muted)]">
                  请上传数据并执行分析
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
