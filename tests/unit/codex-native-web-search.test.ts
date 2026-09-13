import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { CodexNativeWebSearch } from "@outbound/infrastructure/ai/codex-native-web-search";
import type { CodexProcessRequest } from "@outbound/infrastructure/ai/codex-process-runner";
const input = { query: "documented support escalation", limit: 2, model: "gpt-5.6-luna", reasoningEffort: "low" as const, deadlineAt: new Date(Date.now()+60000) };
async function output(request: CodexProcessRequest, value: unknown) {
  await writeFile(request.command[request.command.indexOf("--output-last-message")+1]!, JSON.stringify(value));
}
const searchEvent = JSON.stringify({type:"item.completed",item:{type:"web_search",action:{type:"search",query:input.query}}});

test("requires an actual search and runs only the isolated native search tool", async () => {
 const search = new CodexNativeWebSearch({codexHome:"/tmp/test-home",runner:{async run(request){
  const schema = JSON.parse(await readFile(request.command[request.command.indexOf('--output-schema')+1]!, 'utf8'));
  expect(schema.properties.results.items.properties.url.format).toBeUndefined();
  expect(request.command).toContain('web_search="live"');
  expect(request.command).toContain('features.code_mode_host=true');
  for(const feature of ['shell_tool','unified_exec','apps','plugins','browser_use','computer_use','multi_agent']) expect(request.command).toContain(`features.${feature}=false`);
  expect(request.command).toContain('--ignore-user-config');
  expect(request.command).toContain('--ignore-rules');
  expect(request.command).toContain('read-only');
  expect(request.env.DATABASE_URL).toBeUndefined();
  expect(request.stdin).toContain(input.query);
  await output(request,{results:[{url:'https://example.com/source',title:'Source'}]});
  return {exitCode:0,stdout:searchEvent,stderr:''};
 }}});
 expect((await search.search(input)).results).toEqual([{url:'https://example.com/source',title:'Source'}]);
});

test("empty model output without a web call is unavailable, not an empty successful search", async () => {
 const search=new CodexNativeWebSearch({codexHome:'/tmp/test-home',runner:{async run(request){await output(request,{results:[]});return {exitCode:0,stdout:'',stderr:''};}}});
 await expect(search.search(input)).rejects.toThrow('CODEX_WEB_SEARCH_NOT_EXECUTED');
});

test("a started or failed web call is insufficient proof of search completion", async () => {
 for (const event of [{type:'item.started',item:{type:'web_search',action:{type:'search',query:input.query}}},{type:'item.completed',item:{type:'web_search',status:'failed',action:{type:'search',query:input.query}}}]) {
 const search=new CodexNativeWebSearch({codexHome:'/tmp/test-home',runner:{async run(request){await output(request,{results:[]});return {exitCode:0,stdout:JSON.stringify(event),stderr:''};}}});
 await expect(search.search(input)).rejects.toThrow('CODEX_WEB_SEARCH_NOT_EXECUTED');
 }
});

test("rejects over-limit or non-http results instead of handing them to the crawler", async () => {
 for(const results of [[{url:'file:///etc/passwd',title:'bad'}],[{url:'https://example.com/'+ 'a'.repeat(2050),title:'too long'}],Array.from({length:3},(_,i)=>({url:`https://example.com/${i}`,title:'too many'}))]) {
  const search=new CodexNativeWebSearch({codexHome:'/tmp/test-home',runner:{async run(request){await output(request,{results});return {exitCode:0,stdout:searchEvent,stderr:''};}}});
  await expect(search.search(input)).rejects.toThrow('CODEX_WEB_SEARCH_OUTPUT_INVALID');
 }
});
