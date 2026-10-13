// 用法：node src/seed.js [人數]   產生模擬受試者
//       node src/seed.js --reset-only   清除所有模擬資料
const sim = require('./simulate');
require('./auth').ensureBootstrapAdmin();
(async () => {
  const removed = sim.clearSimulated();
  console.log(`已清除模擬受試者 ${removed} 位`);
  if (process.argv.includes('--reset-only')) return;
  const n = Number(process.argv[2]) || 40;
  const ids = await sim.simulate(n, 20261014);
  console.log(`已產生模擬受試者 ${ids.length} 位（${ids[0]} ~ ${ids[ids.length - 1]}）`);
})();
