import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { CONFIG_FILE } from './loader.js';

export async function runInit() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => {
      console.log(q);
      rl.question('  > ', resolve);
    });

  console.log('\n  Super Agent 初始化向导\n');

  if (fs.existsSync(CONFIG_FILE)) {
    const overwrite = await ask(`  ${CONFIG_FILE} 已存在，覆盖? (y/N): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('  已取消\n');
      rl.close();
      return;
    }
  }

  console.log('  选择模型:\n');
  console.log('    1. deepseek-v4-flash  (推荐，快速均衡)');
  console.log('    2. deepseek-v4-pro    (最强)');
  console.log('    3. deepseek-v3-2      (稳定，便宜)\n');
  const modelChoice = (await ask('  模型 [1]: ')) || '1';
  const models: Record<string, string> = {
    '1': 'deepseek-v4-flash',
    '2': 'deepseek-v4-pro',
    '3': 'deepseek-v3-2',
  };
  const modelName = models[modelChoice] || 'deepseek-v4-flash';

  const apiKey = await ask(
    '\n  DeepSeek API Key (留空则从环境变量 DEEPSEEK_API_KEY 读取): '
  );

  const dashscopeKey = await ask(
    '\n  DashScope API Key — RAG 嵌入用 (留空则从环境变量 DASHSCOPE_API_KEY 读取，无则退化为 mock): '
  );

  const enableFeishu =
    (await ask('\n  启用飞书 Channel? (y/N): ')).toLowerCase() === 'y';
  let feishuAppId = '';
  let feishuAppSecret = '';
  if (enableFeishu) {
    feishuAppId = await ask('  飞书 App ID: ');
    feishuAppSecret = await ask('  飞书 App Secret: ');
  }

  const concurrentStr = await ask('\n  子 Agent 最大并发数 [3]: ');
  const maxConcurrent = parseInt(concurrentStr) || 3;

  const config = {
    version: '1.0',
    model: {
      provider: 'openai',
      name: modelName,
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: apiKey || '${DEEPSEEK_API_KEY}',
    },
    plugins: [{ name: 'supabase', enabled: false, config: {} }],
    channels: {
      feishu: {
        enabled: enableFeishu,
        appId: enableFeishu ? feishuAppId : '${FEISHU_APP_ID}',
        appSecret: enableFeishu ? feishuAppSecret : '${FEISHU_APP_SECRET}',
        port: 3000,
      },
    },
    agents: { maxSpawnDepth: 1, maxConcurrent, defaultTimeout: 60000 },
    security: { defaultRole: 'developer', auditLog: true, bashTimestamp: true },
    memory: { dataDir: '.' },
    rag: { enabled: true, docsDir: 'docs' },
    cron: { enabled: true, dataDir: '.' },
    session: { id: 'default' },
    usage: { trackingFile: '.usage/today.jsonl' },
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n  ✓ ${CONFIG_FILE} 已生成`);

  const envLines: string[] = [];
  if (apiKey) envLines.push(`DEEPSEEK_API_KEY=${apiKey}`);
  envLines.push(`DEEPSEEK_MODEL=${modelName}`);
  if (dashscopeKey) envLines.push(`DASHSCOPE_API_KEY=${dashscopeKey}`);
  if (enableFeishu && feishuAppId) {
    envLines.push(`FEISHU_APP_ID=${feishuAppId}`);
    envLines.push(`FEISHU_APP_SECRET=${feishuAppSecret}`);
  }
  if (envLines.length > 0) {
    fs.writeFileSync('.env', envLines.join('\n') + '\n');
    console.log('  ✓ .env 已生成');
  }

  console.log('\n  启动 Agent: pnpm start\n');
  rl.close();
}
