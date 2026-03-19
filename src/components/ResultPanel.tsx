'use client';

import { ExecutionResult } from '@/lib/types';

interface ResultPanelProps {
  result: ExecutionResult;
}

export default function ResultPanel({ result }: ResultPanelProps) {
  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      {/* 摘要 */}
      <div className={`p-3 rounded border-l-4 ${result.success ? 'bg-green-50 border-green-500 text-green-800' : 'bg-red-50 border-red-500 text-red-800'}`}>
        <div className="font-bold">{result.success ? '✅ 执行成功' : '❌ 执行失败'}</div>
        <div className="mt-1">{result.summary}</div>
        <div className="mt-1 text-xs opacity-70">耗时 {result.duration}ms</div>
      </div>

      {/* 发现列表 */}
      {result.findings.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">分析发现 ({result.findings.length})</h3>
          <div className="space-y-1">
            {result.findings.map((f, i) => (
              <div key={i} className={`p-2 rounded text-xs border-l-2 ${
                f.type === 'lock' ? 'bg-green-50 border-green-400' :
                f.type === 'unlock' ? 'bg-amber-50 border-amber-400' :
                f.type === 'error' ? 'bg-red-50 border-red-400' :
                'bg-gray-50 border-gray-300'
              }`}>
                <div className="flex items-center gap-2">
                  <span>{f.type === 'lock' ? '🔒' : f.type === 'unlock' ? '🔓' : f.type === 'error' ? '❌' : 'ℹ️'}</span>
                  <span className="font-medium">{f.message}</span>
                </div>
                {f.time && <div className="mt-0.5 text-gray-500">时间: {f.time}</div>}
                {f.details && (
                  <div className="mt-0.5 text-gray-400">
                    {Object.entries(f.details).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 时间轴 */}
      {result.timeline.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">时间轴</h3>
          <div className="relative pl-4 border-l-2 border-gray-200 space-y-2">
            {result.timeline.map((t, i) => (
              <div key={i} className="relative text-xs">
                <div className="absolute -left-[21px] w-2.5 h-2.5 rounded-full bg-blue-400 border-2 border-white" />
                <div className="font-mono text-gray-500">{t.time}</div>
                <div>{t.event}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 执行日志 */}
      {result.logs.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">执行日志 ({result.logs.length})</h3>
          <div className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono max-h-60 overflow-auto">
            {result.logs.map((log, i) => (
              <div key={i} className={log.includes('[ERROR]') ? 'text-red-400' : log.includes('[WARN]') ? 'text-yellow-400' : ''}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
