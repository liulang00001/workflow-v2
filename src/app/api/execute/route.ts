/**
 * API: 执行分析代码
 */
import { NextRequest, NextResponse } from 'next/server';
import { executeCode } from '@/lib/executor';

export async function POST(request: NextRequest) {
  try {
    const { code, data } = await request.json();

    if (!code || !data) {
      return NextResponse.json({ success: false, error: '缺少代码或数据' });
    }

    console.log(`[execute] Running code (${code.length} chars) on ${data.rows.length} rows...`);
    const result = executeCode(code, data);
    console.log(`[execute] Done in ${result.duration}ms, ${result.findings.length} findings`);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[execute] Error:', error);
    return NextResponse.json({
      success: false,
      error: `执行失败: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
