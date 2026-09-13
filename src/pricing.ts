import type { Config } from './config.js';
export const packageIds = ['quick', 'explore', 'standard'] as const;
export type PackageId = typeof packageIds[number];
export type AccessPackage = { id: PackageId; name: string; amount: string; seconds: number; queries: number; tool_calls: number; quoteSeconds: number; description: string };
export function accessPackages(config: Config): AccessPackage[] {
  const price = BigInt(config.PRICE_TINYBARS);
  return [
    { id: 'quick', name: 'Quick', amount: ((price + 3n) / 4n).toString(), seconds: Math.min(300, config.ACCESS_SECONDS), queries: Math.min(5,config.QUERY_LIMIT), tool_calls: Math.min(30,config.TOOL_CALL_LIMIT), quoteSeconds: 60, description: 'A focused lookup or one small query.' },
    { id: 'explore', name: 'Explore', amount: ((price + 1n) / 2n).toString(), seconds: Math.min(900,config.ACCESS_SECONDS), queries: Math.min(20,config.QUERY_LIMIT), tool_calls: Math.min(100,config.TOOL_CALL_LIMIT), quoteSeconds: 90, description: 'Broader discovery and schema exploration.' },
    { id: 'standard', name: 'Standard', amount: price.toString(), seconds: config.ACCESS_SECONDS, queries: config.QUERY_LIMIT, tool_calls: config.TOOL_CALL_LIMIT, quoteSeconds: 120, description: 'Extended access for an external agent session.' },
  ];
}
export function accessPackage(config: Config, id: PackageId = 'standard') { return accessPackages(config).find(p=>p.id===id)!; }
