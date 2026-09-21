import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'pi-cua-test-fixture', version: '1' }, { capabilities: { tools: {} } });
const events = [];
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: ['start_session', 'end_session', 'echo', 'without_session'].map(name => ({
  name, description: name,
  inputSchema: { type: 'object', properties: name === 'without_session' ? {} : { session: { type: 'string' } } },
})) }));
server.setRequestHandler(CallToolRequestSchema, request => {
  events.push(request.params);
  return { content: [], structuredContent: { events, env: { permissionMode: process.env.CUA_DRIVER_PERMISSION_MODE } } };
});
await server.connect(new StdioServerTransport());
