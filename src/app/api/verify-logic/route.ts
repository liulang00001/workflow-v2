/**
 * API: 逻辑校验 — 基于预解析的逻辑点对比 TypeScript 代码
 * 不再重复解析自然语言，直接用 parsedLogic 对比代码
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { VERIFY_LOGIC_PROMPT } from '@/lib/verify-prompts';
import { extractJSON } from '@/lib/extract-json';

export async function POST(request: NextRequest) {
  try {
    const { parsedLogic, code } = await request.json();

    if (!parsedLogic?.logicPoints?.length) {
      return NextResponse.json({ success: false, error: '缺少已解析的逻辑点（请先解析自然语言）' }, { status: 400 });
    }
    if (!code?.trim()) {
      return NextResponse.json({ success: false, error: '缺少 TypeScript 代码' }, { status: 400 });
    }

    const { apiKey, apiBase, model } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' }, { status: 500 });
    }

    // 将逻辑点格式化为文本
    const logicPointsText = parsedLogic.logicPoints.map((lp: any, idx: number) =>
      `### ${idx + 1}. [${lp.id}] ${lp.title} (${lp.category}, ${lp.priority})
- 描述: ${lp.description}
- 期望行为: ${lp.expectedBehavior}${
  lp.constraints?.length ? `\n- 约束: ${lp.constraints.join('; ')}` : ''
}`
    ).join('\n\n');

    const userPrompt = `## 已解析的逻辑检查点（共 ${parsedLogic.totalPoints} 项）

${logicPointsText}

## 当前 TypeScript 代码

\`\`\`typescript
${code}
\`\`\`

请逐项对比以上逻辑检查点与代码的实现，输出校验结果 JSON。
注意：items 的 id 必须与逻辑点的 id 一一对应。`;

    console.log(`[verify-logic] Comparing ${parsedLogic.totalPoints} logic points against code...`);
    const llmResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: VERIFY_LOGIC_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 20000,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[verify-logic] LLM error:', errText);
      return NextResponse.json({ success: false, error: `LLM 调用失败: ${llmResponse.status}` }, { status: 502 });
    }

    const llmData = await llmResponse.json();
    const aiContent = llmData.choices?.[0]?.message?.content || '';

    // 提取 JSON（容错多种格式）
    const verifyResult = extractJSON(aiContent);
    if (!verifyResult) {
      console.error('[verify-logic] Failed to extract JSON from LLM response:', aiContent);
      return NextResponse.json({ success: false, error: 'LLM 返回格式异常，无法提取校验结果' });
    }
    console.log(`[verify-logic] Verification done: ${verifyResult.passedChecks}/${verifyResult.totalChecks} passed`);

    return NextResponse.json({ success: true, result: verifyResult });
  } catch (error) {
    console.error('[verify-logic] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
