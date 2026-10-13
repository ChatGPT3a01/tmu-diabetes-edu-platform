// 共用處理器：把 Express 後端包成「事件 → 回應」，並在每次請求前後與 Netlify Blobs 同步
// 被 netlify/functions/api.mjs（正式）與本機模擬器共用
process.env.STORAGE = 'blobs'; // 必須在載入 server 之前設定
const serverless = require('serverless-http');
const sync = require('./blobsync');
const app = require('../server');

const run = serverless(app, { binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/*', 'application/octet-stream'] });
const PREFIX = '/.netlify/functions/api';

function parseReq(event) {
  let path = event.path || '/';
  if (path.startsWith(PREFIX)) path = path.slice(PREFIX.length) || '/';
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  let body = null;
  try {
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    body = raw ? JSON.parse(raw) : null;
  } catch { body = null; }
  return { path, headers, body };
}

// storeFor(event) 可替換，方便本機以模擬儲存測試
// 記憶體資料庫為模組層級：同一執行環境內的請求依序處理（Lambda 本就一次一個，這裡再加保險）
let queue = Promise.resolve();
const createHandler = storeFor => (event, context) => {
  const p = queue.then(() => handle(storeFor, event, context));
  queue = p.catch(() => {});
  return p;
};
async function handle(storeFor, event, context) {
  const store = storeFor(event);
  const req = parseReq(event);
  const ev = { ...event, path: req.path };
  for (let attempt = 1; ; attempt++) {
    await sync.begin(store, req);
    const res = await run(ev, context);
    if (res.statusCode >= 400) return res; // 失敗的請求不寫回
    try { await sync.commit(); return res; }
    catch (e) {
      if (e.code !== 'CONFLICT' || attempt >= 4) {
        console.error('[blobsync]', e);
        return { statusCode: 503, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: '系統忙碌中，請再試一次' }) };
      }
    }
  }
}

exports.createHandler = createHandler;
