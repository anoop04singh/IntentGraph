import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export function resultValue(result: CallToolResult): any {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}
function stable(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function target(name: string, args: Record<string, unknown>) {
  const kind = name.split('_by_')[1];
  return kind && typeof args[kind] === 'string' ? `${kind}:${args[kind]}` : '';
}
export class DemoWorkflow {
  stage: 'unlock' | 'discover' | 'activity' | 'schema' | 'query' | 'answer' = 'unlock';
  private seen = new Set<string>();
  private schemas = new Set<string>();
  private attempts = { discover: 0, schema: 0, query: 0 };
  private blocked = 0;
  querySucceeded = false;
  available(tools: Tool[]): Tool[] {
    return tools.filter(t => this.stage === 'unlock' ? t.name === 'unlock_data_access'
      : this.stage === 'discover' ? ['search_subgraphs_by_keyword', 'get_top_subgraph_deployments'].includes(t.name)
      : this.stage === 'activity' ? t.name === 'get_deployment_30day_query_counts'
      : this.stage === 'schema' ? t.name.startsWith('get_schema_by_')
      : this.stage === 'query' ? t.name.startsWith('execute_query_by_') : false);
  }
  validate(name: string, args: Record<string, unknown>, tools: Tool[]) {
    let error = '';
    if (!this.available(tools).some(t => t.name === name)) error = `This tool is unavailable at the ${this.stage} step. Follow the current pipeline stage.`;
    else if (name.startsWith('execute_query_') && !this.schemas.has(target(name,args))) error = 'Query the same identifier and identifier type whose schema was inspected. Do not switch deployments.';
    else if (this.seen.has(name + stable(args))) error = 'This identical call already ran. Use its previous result; do not repeat it.';
    if (error) { if (++this.blocked >= 2) this.stage = 'answer'; return error; }
    this.seen.add(name + stable(args));
    return '';
  }
  record(name: string, args: Record<string, unknown>, result: CallToolResult) {
    const value = resultValue(result);
    const ok = !result.isError && !value?.error && !(Array.isArray(value?.errors) && value.errors.length);
    if (name === 'unlock_data_access') { if (value?.status === 'unlocked') this.stage = 'discover'; }
    else if (name === 'search_subgraphs_by_keyword' || name === 'get_top_subgraph_deployments') {
      const empty = value?.returned === 0 || value?.total === 0 || (Array.isArray(value?.subgraphs) && !value.subgraphs.length);
      this.stage = ok && !empty ? 'activity' : ++this.attempts.discover < 2 ? 'discover' : 'answer';
    } else if (name === 'get_deployment_30day_query_counts') {
      // Activity is advisory: zero counts or unavailable metrics must not trigger a search loop.
      this.stage = 'schema';
    } else if (name.startsWith('get_schema_by_')) {
      this.attempts.schema++;
      if (ok && target(name,args) && (typeof value === 'string' ? value.trim().length > 0 : Boolean(value))) {
        this.schemas.add(target(name,args)); this.stage = 'query';
      } else this.stage = this.attempts.schema < 2 ? 'schema' : 'answer';
    } else if (name.startsWith('execute_query_')) {
      this.attempts.query++;
      if (ok && value?.data && typeof value.data === 'object') { this.querySucceeded = true; this.stage = 'answer'; }
      else this.stage = this.attempts.query < 2 ? 'query' : 'answer';
    }
  }
  instruction() {
    return `\nCurrent enforced stage: ${this.stage}. Only tools for this stage are offered. Discovery -> activity (advisory) -> schema -> query using that exact identifier -> final answer. Do not restart discovery after a query. A successful query, including empty data, ends tool use. If data looks implausible or freshness is unknown, explain that limitation in the answer; do not silently replace it or call it independently verified. On a query error, correct the query once using the schema already returned. During answer stage, summarize existing evidence and limitations, with no more tools. Do not invent data or claim all requested constraints were met if they were not.`;
  }
}
