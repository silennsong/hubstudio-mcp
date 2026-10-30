// Minimal MCP stdio client for manual testing: node test/client.mjs '<json array of [tool,args]>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const steps = JSON.parse(process.argv[2] || '[]');
const client = new Client({ name: 'test', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['index.js'] }));
if (!steps.length) console.log((await client.listTools()).tools.map(t => t.name).join(' '));
let shot = 0;
for (const [name, args] of steps) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  for (const c of r.content) {
    if (c.type === 'image') { const f = `test/shot-${++shot}.jpg`; writeFileSync(f, Buffer.from(c.data, 'base64')); console.log(`[${name}] image -> ${f}`); }
    else console.log(`[${name}${r.isError ? ' ERROR' : ''} ${Date.now() - t0}ms]`, c.text.slice(0, 1500));
  }
}
await client.close();
