import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mockDir = path.resolve(__dirname, '../mock');

const catalog = JSON.parse(readFileSync(path.join(mockDir, 'catalog.json'), 'utf8'));
const ranking = JSON.parse(readFileSync(path.join(mockDir, 'ranking.json'), 'utf8'));

const txSeen = new Set();
const claimedRewards = new Set();
const claimedMissions = new Set();
const users = new Map();

function getUser(uid = 'guest') {
  if (!users.has(uid)) {
    users.set(uid, {
      uid,
      wallet: { gold: 128550, freeCash: 480, paidCash: 120 },
      baseRPM: 185,
      lastSeenAtMs: Date.now() - 260 * 60 * 1000,
      stats: {
        servedTotal: 0,
        bestCombo: 0,
        invitedFriends: 0
      }
    });
  }
  return users.get(uid);
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body, null, 2));
}

function notFound(res) {
  send(res, 404, { ok: false, error: 'NOT_FOUND' });
}

function badRequest(res, message = 'BAD_REQUEST') {
  send(res, 400, { ok: false, error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getDecay(min) {
  if (min <= 120) return 1.0;
  if (min <= 480) return 0.6;
  return 0.25;
}

function flatSkuList() {
  return Object.values(catalog).flat();
}

function getRankingRows(scope, type) {
  const src = ranking[type] || ranking.skill;

  if (src[scope]) return src[scope];

  if (scope === 'city') {
    return [
      { rank: 1, name: 'HwaniMaster', score: 90210, region: 'Seoul' },
      { rank: 2, name: 'MapoChef', score: 88910, region: 'Seoul' },
      { rank: 3, name: 'YeonnamKing', score: 87300, region: 'Seoul' }
    ];
  }

  if (scope === 'neighborhood') {
    return [
      { rank: 1, name: 'HwaniMaster', score: 55420, region: 'Yeonnam-dong' },
      { rank: 2, name: 'ManduBoss', score: 54790, region: 'Yeonnam-dong' },
      { rank: 3, name: 'BungeoAce', score: 52510, region: 'Yeonnam-dong' }
    ];
  }

  if (scope === 'friends') {
    return [
      { rank: 1, name: 'HwaniMaster', score: 110220, region: 'KR' },
      { rank: 2, name: 'Antigravity', score: 106200, region: 'KR' },
      { rank: 3, name: 'OpenClawFan', score: 99500, region: 'KR' }
    ];
  }

  return src.country || [];
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const method = req.method || 'GET';

    if (method === 'OPTIONS') return send(res, 200, { ok: true });

    if (method === 'GET' && u.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        service: 'ppocha-mock-api',
        now: new Date().toISOString()
      });
    }

    if (method === 'GET' && u.pathname === '/api/player/state') {
      const uid = u.searchParams.get('uid') || 'guest';
      const user = getUser(uid);
      return send(res, 200, {
        ok: true,
        uid,
        wallet: user.wallet,
        baseRPM: user.baseRPM,
        lastSeenAtMs: user.lastSeenAtMs,
        serverTime: Date.now()
      });
    }

    if (method === 'GET' && u.pathname === '/api/shop/catalog') {
      return send(res, 200, {
        ok: true,
        meta: {
          uid: u.searchParams.get('uid') || 'guest',
          country: u.searchParams.get('country') || 'KR',
          city: u.searchParams.get('city') || 'Seoul',
          segment: u.searchParams.get('segment') || 'default'
        },
        tabs: catalog
      });
    }

    if (method === 'POST' && u.pathname === '/api/shop/purchase/verify') {
      const body = await parseBody(req);
      const { uid = 'guest', skuId, txId } = body;
      if (!skuId) return badRequest(res, 'skuId required');

      const sku = flatSkuList().find((x) => x.id === skuId);
      if (!sku) return badRequest(res, 'invalid skuId');

      const tx = txId || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (txSeen.has(tx)) return badRequest(res, 'duplicate txId');
      txSeen.add(tx);

      const user = getUser(uid);
      const delta = { gold: 0, freeCash: 0, paidCash: 0, items: [skuId] };

      if (skuId === 'starter_pack') {
        delta.freeCash += 500;
      } else if (skuId === 'vip_month') {
        delta.freeCash += 120;
      } else {
        delta.gold += 5000;
      }

      user.wallet.gold += delta.gold;
      user.wallet.freeCash += delta.freeCash;
      user.wallet.paidCash += delta.paidCash;

      return send(res, 200, {
        ok: true,
        skuId,
        txId: tx,
        grantedItems: delta.items,
        walletDelta: delta,
        wallet: user.wallet,
        serverTime: Date.now()
      });
    }

    if (method === 'POST' && u.pathname === '/api/economy/offline/claim') {
      const body = await parseBody(req);
      const { uid = 'guest', claimType = 'free', lastSeenAtMs } = body;
      const user = getUser(uid);

      const now = Date.now();
      const seen = Number(lastSeenAtMs || user.lastSeenAtMs || now);
      const offlineMin = Math.min(Math.max(0, Math.floor((now - seen) / 60000)), 1440);
      const decay = getDecay(offlineMin);
      const multiplier = claimType === 'x2' ? 2 : 1;

      if (claimType === 'x2' && user.wallet.paidCash < 29) {
        return badRequest(res, 'not enough paid cash for x2 claim');
      }

      const gold = Math.floor(user.baseRPM * offlineMin * decay * multiplier);
      const freeCashRaw = Math.floor(offlineMin / 30);
      const freeCash = Math.min(40, freeCashRaw);

      if (claimType === 'x2') user.wallet.paidCash -= 29;
      user.wallet.gold += gold;
      user.wallet.freeCash += freeCash;
      user.lastSeenAtMs = now;

      return send(res, 200, {
        ok: true,
        uid,
        offlineMin,
        decay,
        appliedMultiplier: multiplier,
        claimType,
        rewards: { gold, freeCash },
        wallet: user.wallet,
        baseRPM: user.baseRPM,
        lastSeenAtMs: user.lastSeenAtMs,
        remainingStorage: 0,
        serverTime: now
      });
    }

    if (method === 'POST' && u.pathname === '/api/game/session/finish') {
      const body = await parseBody(req);
      const {
        uid = 'guest',
        runGold = 0,
        playedMs = 60000,
        served = 0,
        missed = 0,
        maxCombo = 0
      } = body;

      const user = getUser(uid);
      const runGoldNum = Math.max(0, Number(runGold) || 0);
      const playedMin = Math.max(1, (Number(playedMs) || 60000) / 60000);
      const perMin = runGoldNum / playedMin;
      const servedNum = Math.max(0, Number(served) || 0);
      const maxComboNum = Math.max(0, Number(maxCombo) || 0);

      user.wallet.gold += runGoldNum;
      user.baseRPM = Math.max(80, Math.round(user.baseRPM * 0.8 + perMin * 0.2));
      user.lastSeenAtMs = Date.now();

      user.stats.servedTotal += servedNum;
      user.stats.bestCombo = Math.max(user.stats.bestCombo, maxComboNum);

      return send(res, 200, {
        ok: true,
        uid,
        summary: {
          runGold: runGoldNum,
          served: servedNum,
          missed: Number(missed) || 0,
          playedMs: Number(playedMs) || 0,
          maxCombo: maxComboNum
        },
        wallet: user.wallet,
        baseRPM: user.baseRPM,
        lastSeenAtMs: user.lastSeenAtMs,
        stats: user.stats,
        serverTime: Date.now()
      });
    }

    if (method === 'GET' && u.pathname === '/api/rankings') {
      const scope = u.searchParams.get('scope') || 'country';
      const period = u.searchParams.get('period') || 'weekly';
      const type = u.searchParams.get('type') || 'skill';

      const rows = getRankingRows(scope, type);
      return send(res, 200, {
        ok: true,
        scope,
        period,
        type,
        rows
      });
    }

    if (method === 'POST' && u.pathname === '/api/rankings/submit') {
      const body = await parseBody(req);
      const { uid = 'guest', clientScore = 0, rawLogHash = '', sessionId = '' } = body;

      const scoreNum = Number(clientScore) || 0;
      const suspicious = scoreNum > 999999 || !rawLogHash || rawLogHash.length < 6;
      const verifiedScore = suspicious ? Math.floor(scoreNum * 0.35) : scoreNum + Math.floor(Math.random() * 25);

      return send(res, 200, {
        ok: true,
        uid,
        sessionId,
        verifiedScore,
        status: suspicious ? 'flagged' : 'accepted'
      });
    }

    if (method === 'GET' && u.pathname === '/api/missions/daily') {
      const uid = u.searchParams.get('uid') || 'guest';
      const user = getUser(uid);
      const missions = [
        {
          id: 'm1',
          title: '붕어빵/호떡/어묵/떡볶이 총 80개 판매',
          progress: Math.min(80, user.stats.servedTotal),
          goal: 80,
          reward: { gold: 1200 }
        },
        {
          id: 'm2',
          title: '최대 콤보 20 달성',
          progress: Math.min(20, user.stats.bestCombo),
          goal: 20,
          reward: { freeCash: 4 }
        },
        {
          id: 'm3',
          title: '친구 1명 초대',
          progress: Math.min(1, user.stats.invitedFriends),
          goal: 1,
          reward: { freeCash: 8 }
        }
      ].map((m) => ({
        ...m,
        claimed: claimedMissions.has(`${uid}:${m.id}`)
      }));

      return send(res, 200, {
        ok: true,
        uid,
        missions,
        stats: user.stats
      });
    }

    if (method === 'POST' && u.pathname === '/api/missions/claim') {
      const body = await parseBody(req);
      const { uid = 'guest', missionId } = body;
      if (!missionId) return badRequest(res, 'missionId required');

      const user = getUser(uid);
      const key = `${uid}:${missionId}`;
      if (claimedMissions.has(key)) return badRequest(res, 'mission already claimed');

      const missionMap = {
        m1: { goal: 80, progress: user.stats.servedTotal, reward: { gold: 1200 } },
        m2: { goal: 20, progress: user.stats.bestCombo, reward: { freeCash: 4 } },
        m3: { goal: 1, progress: user.stats.invitedFriends, reward: { freeCash: 8 } }
      };

      const m = missionMap[missionId];
      if (!m) return badRequest(res, 'invalid missionId');
      if ((m.progress || 0) < m.goal) return badRequest(res, 'mission not complete');

      claimedMissions.add(key);
      user.wallet.gold += m.reward.gold || 0;
      user.wallet.freeCash += m.reward.freeCash || 0;

      return send(res, 200, {
        ok: true,
        uid,
        missionId,
        reward: m.reward,
        wallet: user.wallet
      });
    }

    if (method === 'POST' && u.pathname === '/api/pass/claim') {
      const body = await parseBody(req);
      const { uid = 'guest', passTier = 'free', rewardId } = body;
      if (!rewardId) return badRequest(res, 'rewardId required');

      const key = `${uid}:${passTier}:${rewardId}`;
      if (claimedRewards.has(key)) return badRequest(res, 'reward already claimed');
      claimedRewards.add(key);

      const user = getUser(uid);
      const reward = passTier === 'premium'
        ? { gold: 5000, freeCash: 10 }
        : { gold: 1800, freeCash: 1 };

      user.wallet.gold += reward.gold;
      user.wallet.freeCash += reward.freeCash;

      return send(res, 200, {
        ok: true,
        uid,
        passTier,
        rewardId,
        reward,
        wallet: user.wallet
      });
    }

    return notFound(res);
  } catch (err) {
    return send(res, 500, { ok: false, error: 'INTERNAL_ERROR', detail: err.message });
  }
});

const PORT = Number(process.env.PORT || 8787);
server.listen(PORT, () => {
  console.log(`mock api listening on http://localhost:${PORT}`);
});
