/**
 * API: 自然语言 → TypeScript 分析代码
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_PROMPT } from '@/lib/prompts';

export async function POST(request: NextRequest) {
  try {
    const { description, signals } = await request.json();

    // 构建 user prompt
    const signalInfo = signals && signals.length > 0
      ? `\n\n可用信号：\n${signals.map((s: any) => `- ${s.name}: ${s.description}${s.values ? ' (' + Object.entries(s.values).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`).join('\n')}`
      : '';

    const userPrompt = `${description}${signalInfo}`;

    // 调用 LLM
    // TODO: 替换为实际的 LLM 调用（OpenAI / 豆包 / Claude）
    // 这里提供一个通用接口
    const { apiKey, apiBase, model } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' }, { status: 500 });
    }

    console.log('[generate] Calling LLM...');
    const llmResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[generate] LLM error:', errText);
      return NextResponse.json({ success: false, error: `LLM 调用失败: ${llmResponse.status}` }, { status: 502 });
    }

    const llmData = await llmResponse.json();
    const aiContent = llmData.choices?.[0]?.message?.content || '';

    // 提取代码块
    const codeMatch = aiContent.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : aiContent.trim();

    if (!code || code.length < 50) {
      return NextResponse.json({ success: false, error: 'LLM 返回的代码为空或过短' });
    }

    console.log(`[generate] Code generated: ${code.length} chars`);

    return NextResponse.json({ success: true, code });
  } catch (error) {
    console.error('[generate] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
