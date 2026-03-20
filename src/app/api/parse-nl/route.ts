/**
 * API: 自然语言逻辑解析 — 从需求描述中提取结构化逻辑点
 * 只需调用一次，结果由前端缓存，后续校验复用
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { PARSE_NL_PROMPT } from '@/lib/verify-prompts';
import { extractJSON } from '@/lib/extract-json';

export async function POST(request: NextRequest) {
  try {
    const { description } = await request.json();

    if (!description?.trim()) {
      return NextResponse.json({ success: false, error: '缺少自然语言描述' }, { status: 400 });
    }

    const { apiKey, apiBase, model } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' }, { status: 500 });
    }

    const userPrompt = `## 自然语言需求描述

${description}

请从以上需求描述中提取所有结构化逻辑检查点，输出 JSON。`;

    console.log('[parse-nl] Parsing natural language logic...');
    console.log(`[parse-nl] API: ${apiBase}, Model: ${model}`);

    const llmResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: PARSE_NL_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 30000,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[parse-nl] LLM HTTP error:', llmResponse.status, errText);
      return NextResponse.json({ success: false, error: `LLM 调用失败: ${llmResponse.status}` }, { status: 502 });
    }

    const llmData = await llmResponse.json();

    // 详细日志：打印响应结构
    console.log('[parse-nl] LLM response keys:', Object.keys(llmData));
    if (llmData.choices) {
      console.log('[parse-nl] choices[0] keys:', Object.keys(llmData.choices[0] || {}));
      if (llmData.choices[0]?.message) {
        console.log('[parse-nl] message keys:', Object.keys(llmData.choices[0].message));
      }
    }

    const aiContent = llmData.choices?.[0]?.message?.content || '';
    console.log(`[parse-nl] aiContent length: ${aiContent.length}`);
    console.log(`[parse-nl] aiContent preview: ${aiContent.substring(0, 300)}`);

    if (!aiContent) {
      // 尝试其他可能的响应路径
      const altContent = llmData.output?.text
        || llmData.result?.content
        || llmData.data?.choices?.[0]?.message?.content
        || '';
      console.log(`[parse-nl] Trying alt paths, altContent length: ${altContent.length}`);

      if (altContent) {
        const parsed = extractJSON(altContent);
        if (parsed) {
          console.log(`[parse-nl] Parsed from alt path: ${parsed.totalPoints} logic points`);
          return NextResponse.json({ success: true, parsedLogic: parsed });
        }
      }

      console.error('[parse-nl] No content found in LLM response:', JSON.stringify(llmData).substring(0, 500));
      return NextResponse.json({
        success: false,
        error: 'LLM 返回内容为空',
        debug: { keys: Object.keys(llmData), preview: JSON.stringify(llmData).substring(0, 300) },
      });
    }

    // 提取 JSON（容错多种格式）
    const parsedLogic = extractJSON(aiContent);
    if (!parsedLogic) {
      console.error('[parse-nl] extractJSON failed. Full content:');
      console.error(aiContent);
      return NextResponse.json({
        success: false,
        error: 'LLM 返回格式异常，无法提取逻辑解析结果',
        debug: { contentLength: aiContent.length, preview: aiContent.substring(0, 500) },
      });
    }

    // 兼容处理：确保 totalPoints 字段存在
    if (!parsedLogic.totalPoints && parsedLogic.logicPoints) {
      parsedLogic.totalPoints = parsedLogic.logicPoints.length;
    }

    console.log(`[parse-nl] Success! Parsed ${parsedLogic.totalPoints} logic points`);

    return NextResponse.json({ success: true, parsedLogic });
  } catch (error) {
    console.error('[parse-nl] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
