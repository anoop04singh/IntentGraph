import 'dotenv/config';
import { z } from 'zod';

const env = z.object({
  GATEWAY_API_KEY: z.string().default(''),
  HEDERA_SELLER_ACCOUNT_ID: z.string().regex(/^$|^0\.0\.[1-9]\d*$/).default(''),
  FACILITATOR_URL: z.string().url().default('https://api.testnet.blocky402.com'),
  SUBGRAPH_MCP_URL: z.string().url().default('https://subgraphs.mcp.thegraph.com/sse'),
  PRICE_TINYBARS: z.string().regex(/^[1-9]\d*$/).default('1000000'),
  ACCESS_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  QUERY_LIMIT: z.coerce.number().int().min(1).max(10000).default(100),
  TOOL_CALL_LIMIT: z.coerce.number().int().min(1).max(50000).default(500),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  DATA_DIR: z.string().default('./data'),
  MAX_SESSIONS: z.coerce.number().int().min(1).max(10000).default(100),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.5-flash-lite'),
  DEMO_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  DEMO_DAILY_RUN_LIMIT: z.coerce.number().int().min(1).max(1000).default(30),
  DEMO_MAX_STEPS: z.coerce.number().int().min(4).max(30).default(14),
  HEDERA_PAT: z.string().default(''),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'),
}).parse(process.env);
export const config = env;
export type Config = typeof config;
export const configured = Boolean(env.GATEWAY_API_KEY && env.HEDERA_SELLER_ACCOUNT_ID);


