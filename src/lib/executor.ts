/**
 * 代码执行器：在受控环境中执行 LLM 生成的分析代码
 *
 * 策略：将代码编译为 Function，注入受控的 context（data + console）
 * 生产环境可升级为 quickjs-emscripten 沙箱
 */
import { DataTable, ExecutionResult, Finding } from './types';

/** 将 DataTable 转为 SignalRow[] 格式供分析函数使用 */
function tableToSignalRows(table: DataTable): Record<string, any>[] {
  const timeColIdx = table.headers.findIndex(h =>
    h.includes('时间') || h.includes('time') || h.includes('Time') || h.includes('采集')
  );

  return table.rows.map(row => {
    const obj: Record<string, any> = {};
    for (let i = 0; i < table.headers.length; i++) {
      const header = table.headers[i];
      let value = row[i];
      // 自动转数字
      if (typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num) && value.trim() !== '') value = num;
      }
      obj[header] = value;
      // 时间列特殊处理
      if (i === timeColIdx) obj['time'] = String(value);
    }
    // 确保有 time 字段
    if (!obj['time'] && timeColIdx >= 0) obj['time'] = String(row[timeColIdx]);
    if (!obj['time']) obj['time'] = `row_${table.rows.indexOf(row)}`;
    return obj;
  });
}

/** 从代码中提取 analyze 函数和辅助函数 */
function extractFunctions(code: string): string {
  // 移除 TypeScript 类型注解（简单处理）
  let cleaned = code
    // 移除 interface/type 定义块
    .replace(/^(interface|type)\s+\w+\s*\{[^}]*\}/gm, '')
    // 移除参数类型注解 (name: Type)
    .replace(/:\s*(string|number|boolean|any|void|Record<[^>]+>|Array<[^>]+>|\w+\[\]|{\s*[^}]*})/g, '')
    // 移除返回类型注解
    .replace(/\)\s*:\s*\w+(\[\])?\s*\{/g, ') {')
    // 移除泛型
    .replace(/<[^>]+>/g, '')
    // 移除 as 类型断言
    .replace(/\s+as\s+\w+/g, '')
    // 移除 export
    .replace(/^export\s+/gm, '');

  return cleaned;
}

/**
 * 执行分析代码
 */
export function executeCode(code: string, table: DataTable): ExecutionResult {
  const startTime = Date.now();
  const logs: string[] = [];
  const findings: Finding[] = [];

  try {
    const data = tableToSignalRows(table);
    const cleanedCode = extractFunctions(code);

    // 构建可执行代码
    const execCode = `
      ${cleanedCode}

      // 执行入口
      const __result = analyze(__data);
      __result;
    `;

    // 创建受控 console
    const safeConsole = {
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(msg);
      },
      warn: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[WARN] ${msg}`);
      },
      error: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
        logs.push(`[ERROR] ${msg}`);
      },
    };

    // 用 Function 构造器执行（受控作用域）
    const fn = new Function('__data', 'console', 'Math', 'JSON', 'Array', 'Object', 'Number', 'String', 'Boolean', 'Date', 'isNaN', 'parseInt', 'parseFloat', 'Infinity', 'NaN', 'undefined',
      execCode
    );

    const result = fn(data, safeConsole, Math, JSON, Array, Object, Number, String, Boolean, Date, isNaN, parseInt, parseFloat, Infinity, NaN, undefined);

    const duration = Date.now() - startTime;

    if (result && result.findings) {
      findings.push(...result.findings);
    }

    // 生成时间轴
    const timeline = findings.map((f, i) => ({
      time: f.time || `#${i + 1}`,
      event: `[${f.type}] ${f.message}`,
      row: f.details?.row,
    }));

    return {
      success: true,
      findings,
      timeline,
      summary: result?.summary || `分析完成，发现 ${findings.length} 个事件`,
      duration,
      logs,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    logs.push(`[FATAL] ${errMsg}`);

    return {
      success: false,
      findings: [{ time: '', type: 'error', message: `执行错误: ${errMsg}` }],
      timeline: [],
      summary: `执行失败: ${errMsg}`,
      duration,
      logs,
    };
  }
}
