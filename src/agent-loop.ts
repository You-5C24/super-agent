import { streamText, type ModelMessage } from 'ai';
import { ToolRegistry } from './tool-registry.js';
import {
  detect,
  recordCall,
  recordResult,
  resetHistory,
} from './loop-detection.js';
import { isRetryable, calculateDelay, sleep } from './retry.js';

const MAX_STEPS = 15;
const MAX_RETRIES = 3;
const TOKEN_BUDGET = 15000;

export async function agentLoop(
  model: any,
  registry: ToolRegistry,
  messages: ModelMessage[],
  system: string
) {
  let step = 0;
  let totalTokens = 0;
  resetHistory();

  while (step < MAX_STEPS) {
    step++;
    console.log(`\n--- Step ${step} ---`);

    let hasToolCall = false;
    let fullText = '';
    let shouldBreak = false;
    let lastToolCall: { name: string; input: unknown } | null = null;
    let stepResponse: any;
    let stepUsage: any;

    // 步骤级重试：包裹整个 stream 消费过程
    for (let attempt = 1; ; attempt++) {
      try {
        // 使用 Vercel AI SDK 发起一次「可流式输出」的对话请求
        const result = streamText({
          model,
          system,
          tools: registry.toAISDKFormat(),
          messages,
          maxRetries: 0,
          onError: () => {},
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'text-delta':
              process.stdout.write(part.text);
              fullText += part.text;
              break;

            case 'tool-call': {
              hasToolCall = true;
              lastToolCall = { name: part.toolName, input: part.input };
              console.log(
                `  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`
              );

              // 三层防护：循环检测
              const detection = detect(part.toolName, part.input);
              if (detection.stuck) {
                console.log(`  ${detection.message}`);
                if (detection.level === 'critical') {
                  shouldBreak = true;
                } else {
                  messages.push({
                    role: 'user',
                    content: `[系统提醒] ${detection.message}。请换一个思路解决问题，不要重复同样的操作。`,
                  });
                }
              }
              recordCall(part.toolName, part.input);
              break;
            }

            case 'tool-result':
              console.log(`  [结果: ${JSON.stringify(part.output)}]`);
              if (lastToolCall) {
                recordResult(
                  lastToolCall.name,
                  lastToolCall.input,
                  part.output
                );
              }
              break;
          }
        }

        stepResponse = await result.response;
        stepUsage = await result.usage;
        break;
      } catch (error) {
        // 三层防护：API容错
        if (attempt > MAX_RETRIES || !isRetryable(error as Error)) throw error;
        const delay = calculateDelay(attempt);
        console.log(
          `  [重试] 第 ${attempt}/${MAX_RETRIES} 次失败，${delay}ms 后重试...`
        );
        await sleep(delay);
        hasToolCall = false;
        fullText = '';
        shouldBreak = false;
        lastToolCall = null;
      }
    }

    if (shouldBreak) {
      console.log('\n[循环检测触发，Agent 已停止]');
      break;
    }

    // 拿到这一步的完整结果，追加到消息历史
    messages.push(...stepResponse.messages);

    // 三层防护：Token 预算追踪
    const inp =
      typeof stepUsage?.inputTokens === 'number'
        ? stepUsage.inputTokens
        : stepUsage?.inputTokens?.total ?? 0;
    const out =
      typeof stepUsage?.outputTokens === 'number'
        ? stepUsage.outputTokens
        : stepUsage?.outputTokens?.total ?? 0;
    totalTokens += inp + out;
    const pct = Math.round((totalTokens / TOKEN_BUDGET) * 100);
    console.log(`  [Token] ${totalTokens}/${TOKEN_BUDGET} (${pct}%)`);

    // 退出条件：Token 预算耗尽
    if (totalTokens > TOKEN_BUDGET) {
      console.log('\n[Token 预算耗尽，强制停止]');
      break;
    }

    // 退出条件：模型没有调用任何工具，说明它认为可以直接回复了
    if (!hasToolCall) {
      if (fullText) console.log();
      break;
    }

    console.log('  \u2192 继续下一步...');
  }

  // 退出条件：达到最大步数限制
  if (step >= MAX_STEPS) {
    console.log('\n[达到最大步数限制，强制停止]');
  }
}
