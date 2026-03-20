'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { FlowChart, DataTable, ExecutionResult, SignalDef } from '@/lib/types';
import ResultPanel from '@/components/ResultPanel';
import LogicVerifyPanel, { VerifyResult, VerifyItem, FixReport, DiffInfo, ParsedLogic } from '@/components/LogicVerifyPanel';
import DataPreviewPanel from '@/components/DataPreviewPanel';
import { FileUp, Play, Sparkles, Code2, GitBranch, Terminal, Save, FolderOpen, Trash2, Shield, Table2 } from 'lucide-react';

interface SavedScript {
  name: string;
  fileName: string;
  updatedAt: string;
  size: number;
}

// 动态加载避免 SSR 问题
const CodeEditor = dynamic(() => import('@/components/CodeEditor'), { ssr: false });
const FlowChartView = dynamic(() => import('@/components/FlowChart'), { ssr: false });

type Tab = 'code' | 'verify' | 'flow' | 'data' | 'result';

export default function Home() {
  // === 核心状态 ===
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [flowChart, setFlowChart] = useState<FlowChart | null>(null);
  const [data, setData] = useState<DataTable | null>(null);
  const [headerOverrides, setHeaderOverrides] = useState<Record<number, string>>({});
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'generating' | 'parsing' | 'executing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('code');
  const [highlightRange, setHighlightRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 逻辑校验状态 ===
  const [codeVersion, setCodeVersion] = useState(1);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [fixReport, setFixReport] = useState<FixReport | null>(null);
  const [verifyHistory, setVerifyHistory] = useState<{ version: number; result: VerifyResult; timestamp: string }[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [diffInfo, setDiffInfo] = useState<DiffInfo | null>(null);
  const [parsedLogic, setParsedLogic] = useState<ParsedLogic | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  // === 脚本管理 ===
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const [saveName, setSaveName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  const loadScriptList = useCallback(async () => {
    try {
      const res = await fetch('/api/scripts');
      const json = await res.json();
      if (json.success) setSavedScripts(json.scripts);
    } catch {}
  }, []);

  useEffect(() => { loadScriptList(); }, [loadScriptList]);

  const handleSaveScript = useCallback(async () => {
    if (!saveName.trim() || !code.trim()) return;
    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), code }),
      });
      const json = await res.json();
      if (json.success) {
        setShowSaveInput(false);
        setSaveName('');
        loadScriptList();
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [saveName, code, loadScriptList]);

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
      setCodeVersion(1);
      setVerifyResult(null);
      setFixReport(null);
      setDiffInfo(null);
      setParsedLogic(null);
      setVerifyHistory([]);
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

  // === 脚本加载/删除 ===
  const handleLoadScript = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`);
      const json = await res.json();
      if (json.success) {
        setCode(json.code);
        setActiveTab('code');
        parseFlowChart(json.code);
      } else {
        setError(json.error);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [parseFlowChart]);

  const handleDeleteScript = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/scripts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success) loadScriptList();
    } catch {}
  }, [loadScriptList]);

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

    const headers = raw[0].map((h: any) => String(h).replace(/[\r\n]+/g, '').trim());
    const rows = raw.slice(1).map(row =>
      headers.map((_, i) => {
        const v = row[i];
        if (v === undefined || v === null) return 0;
        const num = Number(v);
        return isNaN(num) ? v : num;
      })
    );

    setData({ headers, rows, fileName: file.name });
    setHeaderOverrides({});
    setError(null);
    setActiveTab('data');
  }, []);

  /** 构建应用了编辑后表头的数据 */
  const getEffectiveData = useCallback((): DataTable | null => {
    if (!data) return null;
    const effectiveHeaders = data.headers.map((h, i) => {
      if (i in headerOverrides) return headerOverrides[i];
      return h.replace(/[\r\n]+/g, '').trim();
    });
    return { ...data, headers: effectiveHeaders };
  }, [data, headerOverrides]);

  // === 步骤 3: 执行代码 ===
  const handleExecute = useCallback(async () => {
    if (!code.trim() || !data) {
      setError('需要代码和数据才能执行');
      return;
    }
    setStatus('executing');
    setError(null);

    const effectiveData = getEffectiveData();
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, data: effectiveData }),
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
  }, [code, data, getEffectiveData]);

  // === 自然语言解析（只需一次） ===
  const handleParseNL = useCallback(async () => {
    if (!description.trim()) return;
    setIsParsing(true);

    try {
      const res = await fetch('/api/parse-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!json.success) {
        const debugInfo = json.debug ? `\n[debug] ${json.debug.preview || JSON.stringify(json.debug)}` : '';
        throw new Error(json.error + debugInfo);
      }

      setParsedLogic(json.parsedLogic);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsParsing(false);
    }
  }, [description]);

  // === 逻辑校验（复用已解析的逻辑点） ===
  const handleVerify = useCallback(async () => {
    if (!parsedLogic || !code.trim()) return;
    setIsVerifying(true);
    setVerifyResult(null);
    setFixReport(null);

    try {
      const res = await fetch('/api/verify-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsedLogic, code }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setVerifyResult(json.result);
      setVerifyHistory(prev => [...prev, {
        version: codeVersion,
        result: json.result,
        timestamp: new Date().toISOString(),
      }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsVerifying(false);
    }
  }, [parsedLogic, code, codeVersion]);

  // === 逻辑修复 ===
  const handleFix = useCallback(async (failedItems: VerifyItem[]) => {
    if (!code.trim() || failedItems.length === 0) return;
    setIsFixing(true);

    try {
      const res = await fetch('/api/fix-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          fixItems: failedItems,
          version: codeVersion,
          description,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      // 更新代码和版本
      setCode(json.code);
      setCodeVersion(json.version);
      setFixReport(json.fixReport);
      setDiffInfo(json.diff || null);

      // 自动重新解析流程图
      await parseFlowChart(json.code);

      // 修复完成后自动再次校验
      setIsFixing(false);
      setIsVerifying(true);
      setVerifyResult(null);

      const verifyRes = await fetch('/api/verify-logic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsedLogic, code: json.code }),
      });
      const verifyJson = await verifyRes.json();
      if (verifyJson.success) {
        setVerifyResult(verifyJson.result);
        setVerifyHistory(prev => [...prev, {
          version: json.version,
          result: verifyJson.result,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsVerifying(false);
      setIsFixing(false);
    }
  }, [code, codeVersion, description, parsedLogic, parseFlowChart]);

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
          <div className="p-3 border-b border-[var(--border)]">
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
                <div className={`w-2 h-2 rounded-full ${parsedLogic ? 'bg-green-400' : 'bg-gray-300'}`} />
                <span>需求解析 {parsedLogic ? `✓ (${parsedLogic.totalPoints} 逻辑点)` : '未解析'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  verifyResult ? (verifyResult.passed ? 'bg-green-400' : 'bg-red-400') : 'bg-gray-300'
                }`} />
                <span>逻辑校验 {verifyResult
                  ? (verifyResult.passed ? `✓ 全部通过` : `⚠ ${verifyResult.failedChecks}项差异`)
                  : '未校验'} <span className="text-[10px]">v{codeVersion}</span>
                </span>
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

          {/* 代码管理 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-3 flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--muted)] uppercase">历史代码</label>
              <button
                onClick={() => { setShowSaveInput(!showSaveInput); setSaveName(''); }}
                disabled={!code}
                className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition disabled:opacity-40"
              >
                <Save size={12} />
                保存当前
              </button>
            </div>

            {showSaveInput && (
              <div className="px-3 pb-2 flex gap-1">
                <input
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveScript()}
                  placeholder="输入脚本名称..."
                  className="flex-1 px-2 py-1 text-xs border border-[var(--border)] rounded bg-transparent"
                  autoFocus
                />
                <button
                  onClick={handleSaveScript}
                  disabled={!saveName.trim()}
                  className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded disabled:opacity-40"
                >
                  保存
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto px-3 pb-3">
              {savedScripts.length === 0 ? (
                <div className="text-xs text-[var(--muted)] text-center py-4">暂无保存的脚本</div>
              ) : (
                <div className="space-y-1">
                  {savedScripts.map(s => (
                    <div key={s.name} className="group flex items-center gap-1 p-2 rounded hover:bg-[var(--accent-light)] transition text-xs cursor-pointer"
                         onClick={() => handleLoadScript(s.name)}>
                      <FolderOpen size={12} className="text-[var(--muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-[var(--muted)] text-[10px]">
                          {new Date(s.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteScript(s.name); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition"
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
              onClick={() => setActiveTab('verify')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'verify' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Shield size={14} /> 逻辑校验
              {verifyResult && (
                <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded-full ${
                  verifyResult.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {verifyResult.passedChecks}/{verifyResult.totalChecks}
                </span>
              )}
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
              onClick={() => setActiveTab('data')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition ${
                activeTab === 'data' ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'
              }`}
            >
              <Table2 size={14} /> 数据
              {data && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700">
                  {data.rows.length}行
                </span>
              )}
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

            {activeTab === 'verify' && (
              <LogicVerifyPanel
                description={description}
                code={code}
                codeVersion={codeVersion}
                parsedLogic={parsedLogic}
                isParsing={isParsing}
                verifyResult={verifyResult}
                fixReport={fixReport}
                diffInfo={diffInfo}
                verifyHistory={verifyHistory}
                isVerifying={isVerifying}
                isFixing={isFixing}
                onParseNL={handleParseNL}
                onVerify={handleVerify}
                onFix={handleFix}
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

            {activeTab === 'data' && (
              <DataPreviewPanel
                data={data}
                headerOverrides={headerOverrides}
                onHeaderRename={(idx, name) => setHeaderOverrides(prev => ({ ...prev, [idx]: name }))}
                onHeaderReset={(idx) => setHeaderOverrides(prev => {
                  const next = { ...prev };
                  delete next[idx];
                  return next;
                })}
                onHeaderResetAll={() => setHeaderOverrides({})}
              />
            )}

            {activeTab === 'result' && (
              result ? (
                <ResultPanel result={result} code={code} />
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
