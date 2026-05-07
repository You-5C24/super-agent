import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface MCPCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>
  ) {}

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: { ...process.env, ...this.env } as Record<string, string>,
    });

    this.client = new Client({
      name: 'super-agent',
      version: '1.0.0',
    });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('MCP client is not connected');
    const result = await this.client.listTools();
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error('MCP client is not connected');
    const result = (await this.client.callTool({
      name,
      arguments: args,
    })) as MCPCallResult;
    const texts = (result.content || [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!);
    return texts.join('\n') || '(无返回内容)';
  }

  async close(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }
}

export class MockMCPClient {
  async connect(): Promise<void> {}

  async listTools(): Promise<MCPTool[]> {
    return [
      {
        name: 'list_issues',
        description: '列出 GitHub 仓库的 Issues',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者' },
            repo: { type: 'string', description: '仓库名称' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'search_repositories',
        description: '搜索 GitHub 仓库',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_file_contents',
        description: '获取仓库中文件的内容',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string', description: '仓库所有者' },
            repo: { type: 'string', description: '仓库名称' },
            path: { type: 'string', description: '文件路径' },
          },
          required: ['owner', 'repo', 'path'],
        },
      },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'list_issues':
        return JSON.stringify(
          [
            {
              number: 42,
              title: '支持 MCP 协议接入',
              state: 'open',
              labels: ['enhancement'],
            },
            {
              number: 41,
              title: '循环检测阈值可配置化',
              state: 'open',
              labels: ['feature'],
            },
            {
              number: 39,
              title: 'Token 预算用完后的优雅降级',
              state: 'closed',
              labels: ['bug'],
            },
          ],
          null,
          2
        );
      case 'search_repositories':
        return JSON.stringify(
          [
            {
              full_name: 'anthropics/anthropic-sdk-python',
              stars: 2800,
              description: 'Anthropic Python SDK',
            },
            {
              full_name: 'vercel/ai',
              stars: 12000,
              description: 'AI SDK for TypeScript',
            },
            {
              full_name: 'modelcontextprotocol/servers',
              stars: 5600,
              description: 'MCP Servers',
            },
          ],
          null,
          2
        );
      case 'get_file_contents':
        return `# README\n\nThis is a mock file content for ${args.owner}/${args.repo}/${args.path}`;
      default:
        return `未知工具: ${name}`;
    }
  }

  async close(): Promise<void> {}
}
