// Netlify Function（新版 v2）：/api/* 全部交給 Express 後端；研究資料存在 Netlify Blobs（強一致性）
import { getStore } from '@netlify/blobs';
import lambda from '../../src/lambda.js'; // 建置時由 scripts/build.js 以 esbuild 打包成 netlify/functions/api.mjs

const handler = lambda.createHandler(() => getStore({ name: 'research', consistency: 'strong' }));

export default async (req, context) => {
  const url = new URL(req.url);
  const headers = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  if (context?.ip) headers['x-forwarded-for'] = context.ip;
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text();
  const qs = {}, mqs = {};
  for (const k of new Set(url.searchParams.keys())) { qs[k] = url.searchParams.get(k); mqs[k] = url.searchParams.getAll(k); }
  const r = await handler({
    path: url.pathname, httpMethod: req.method, headers, body: body || null, isBase64Encoded: false,
    queryStringParameters: qs, multiValueQueryStringParameters: mqs,
    requestContext: { identity: { sourceIp: context?.ip || '' } }
  }, {});
  const out = new Headers();
  for (const [k, v] of Object.entries(r.headers || {})) out.set(k, String(v));
  for (const [k, vs] of Object.entries(r.multiValueHeaders || {})) { out.delete(k); for (const v of vs) out.append(k, String(v)); }
  return new Response(r.isBase64Encoded ? Buffer.from(r.body, 'base64') : r.body, { status: r.statusCode, headers: out });
};

export const config = { path: '/api/*' };
