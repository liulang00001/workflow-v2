/**
 * API: 逻辑修复 — 根据校验差异逐项修复 TypeScript 代码
 * 核心原则：基于当前版本增量修复，而非重新生成
 */
import { getConfig } from '@/lib/config';
import { NextRequest, NextResponse } from 'next/server';
import { FIX_LOGIC_PROMPT } from '@/lib/verify-prompts';
import { extractJSON } from '@/lib/extract-json';

/**
 * 简易行级 diff：统计两段代码之间的差异
 */
function computeDiff(oldCode: string, newCode: string) {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  let unchanged = 0;
  let changed = 0;
  let added = 0;
  let removed = 0;
  const changes: { line: number; type: 'modified' | 'added' | 'removed'; before?: string; after?: string }[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === undefined) {
      added++;
      changes.push({ line: i + 1, type: 'added', after: newLine });
    } else if (newLine === undefined) {
      removed++;
      changes.push({ line: i + 1, type: 'removed', before: oldLine });
    } else if (oldLine.trim() === newLine.trim()) {
      unchanged++;
    } else {
      changed++;
      changes.push({ line: i + 1, type: 'modified', before: oldLine, after: newLine });
    }
  }

  const totalOldLines = oldLines.length;
  const similarity = totalOldLines > 0
    ? Math.round((unchanged / totalOldLines) * 100)
    : 0;

  return { unchanged, changed, added, removed, similarity, changes };
}

export async function POST(request: NextRequest) {
  try {
    const { code, fixItems, version, description } = await request.json();

    if (!code?.trim()) {
      return NextResponse.json({ success: false, error: '缺少 TypeScript 代码' }, { status: 400 });
    }
    if (!fixItems?.length) {
      return NextResponse.json({ success: false, error: '没有需要修复的项' }, { status: 400 });
    }

    const { apiKey, apiBase, model } = getConfig().llm;

    if (!apiKey) {
      return NextResponse.json({ success: false, error: '未配置 LLM apiKey（请检查 config.json）' }, { status: 500 });
    }

    const fixItemsText = fixItems.map((item: any, idx: number) =>
      `${idx + 1}. [${item.id}] ${item.title}\n   需求逻辑: ${item.nlLogic}\n   当前代码逻辑: ${item.codeLogic}\n   建议: ${item.suggestion}`
    ).join('\n\n');

    // 标注行号，帮助 LLM 精确定位
    const numberedCode = code.split('\n')
      .map((line: string, i: number) => `/* ${String(i + 1).padStart(3)} */ ${line}`)
      .join('\n');

    const userPrompt = `## 原始需求描述（仅供参考上下文，不要据此添加新功能）

${description || '(无)'}

## 当前 TypeScript 代码（版本 v${version || 1}）— 这是你修复的基准

\`\`\`typescript
${numberedCode}
\`\`\`

## 需要修复的差异项（共 ${fixItems.length} 项）

${fixItemsText}

## 要求

1. 严格基于以上代码版本进行最小改动修复
2. 输出的代码不要包含行号注释（/* 1 */ 等），输出纯净代码
3. 除了修复列出的差异项外，不要做任何其他改动
4. 在修复说明 JSON 中，用 before/after 标注每处修改的原始行和修复后的行`;

    console.log(`[fix-logic] Fixing ${fixItems.length} items on version v${version || 1}, code length: ${code.length}`);

    const llmResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: FIX_LOGIC_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.05, // 更低的温度，减少随机性
        max_tokens: 8192,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('[fix-logic] LLM error:', errText);
      return NextResponse.json({ success: false, error: `LLM 调用失败: ${llmResponse.status}` }, { status: 502 });
    }

    const llmData = await llmResponse.json();
    const aiContent = llmData.choices?.[0]?.message?.content || '';

    // 提取代码（支持多种 fence 格式）
    const codeMatch = aiContent.match(/```(?:typescript|ts)[\s]*\n?([\s\S]*?)```/);
    if (!codeMatch) {
      return NextResponse.json({ success: false, error: 'LLM 返回格式异常，无法提取修复后的代码' });
    }
    const fixedCode = codeMatch[1].trim();

    // 计算代码差异
    const diff = computeDiff(code, fixedCode);
    console.log(`[fix-logic] Diff: similarity=${diff.similarity}%, unchanged=${diff.unchanged}, changed=${diff.changed}, added=${diff.added}, removed=${diff.removed}`);

    // 相似度警告：如果改动超过 30%，可能是重写而非修复
    const isLikelyRewrite = diff.similarity < 70;
    if (isLikelyRewrite) {
      console.warn(`[fix-logic] ⚠️ Low similarity (${diff.similarity}%) — LLM may have rewritten the code instead of fixing it!`);
    }

    // 提取修复说明 JSON（容错多种格式）
    // 先去掉已匹配的 typescript 代码块，再从剩余内容提取 JSON
    const contentAfterCode = aiContent.substring(aiContent.indexOf(fixedCode) + fixedCode.length);
    let fixReport = extractJSON(contentAfterCode);
    if (!fixReport) {
      try {
        const jsonMatch = aiContent.match(/```json[\s]*\n?([\s\S]*?)```/);
        if (jsonMatch) fixReport = JSON.parse(jsonMatch[1].trim());
      } catch {
        console.warn('[fix-logic] Failed to parse fix report JSON');
      }
    }

    const newVersion = (version || 1) + 1;
    console.log(`[fix-logic] Code fixed, new version: v${newVersion}, code length: ${fixedCode.length}`);

    return NextResponse.json({
      success: true,
      code: fixedCode,
      version: newVersion,
      diff: {
        similarity: diff.similarity,
        unchanged: diff.unchanged,
        changed: diff.changed,
        added: diff.added,
        removed: diff.removed,
        isLikelyRewrite,
        changes: diff.changes.slice(0, 50), // 最多返回前50处变更
      },
      fixReport: fixReport || {
        fixedItems: fixItems.map((item: any) => ({ id: item.id, title: item.title, description: '已修复' })),
        version: newVersion,
        changesSummary: `已修复 ${fixItems.length} 项差异`,
      },
    });
  } catch (error) {
    console.error('[fix-logic] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
