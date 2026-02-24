# 포차팡 타이쿤 - API 명세 초안 v0.1

## 1) 상점
### GET /api/shop/catalog
- query: `uid`, `country`, `city`, `segment`
- response: 탭별 SKU 목록, 추천 SKU, 가격/재화/설명

### POST /api/shop/purchase/verify
- body: `uid`, `platform`, `receipt`, `skuId`, `txId`
- response: `ok`, `grantedItems`, `walletDelta`, `serverTime`

---

## 2) 오프라인 수익
### POST /api/economy/offline/claim
- body: `uid`, `claimType` (`free`|`x2`), `sessionId`
- server logic:
  - offlineMin = min((now-lastSeenAt)/60, 1440)
  - decay: 1.0(0~120m), 0.6(121~480m), 0.25(481~1440m)
  - freeCash daily cap = 40
- response: `gold`, `freeCash`, `appliedMultiplier`, `remainingStorage`

---

## 3) 랭킹
### GET /api/rankings
- query:
  - `scope` = world|country|city|neighborhood|friends
  - `period` = daily|weekly|monthly|season
  - `type` = skill|business
  - `uid`
- response: `rows[]` (rank, userId, nickname, score, region)

### POST /api/rankings/submit
- body: `uid`, `mode`, `rawLogHash`, `clientScore`, `sessionId`
- response: `verifiedScore`, `status` (`accepted`|`flagged`)

---

## 4) 미션/패스
### GET /api/missions/daily
- query: `uid`
- response: 진행도, 보상, 남은 시간

### POST /api/pass/claim
- body: `uid`, `passTier`, `rewardId`
- response: 지급 결과, 지갑 변경

---

## 5) 최소 DB 스키마
- `users(id, country, city, neighborhood, created_at)`
- `wallets(user_id, gold, free_cash, paid_cash, updated_at)`
- `purchases(id, user_id, sku_id, price, platform, tx_id, status, created_at)`
- `offline_income_logs(id, user_id, offline_min, decay, gold, free_cash, claim_type, created_at)`
- `rank_events_raw(id, user_id, session_id, raw_log_hash, client_score, verified_score, status, created_at)`
- `ranking_snapshots(scope, period, type, rank, user_id, score, region, snapshot_at)`
- `friend_edges(user_id, friend_user_id, created_at)`

---

## 6) 보안 규칙
1. 클라 점수는 참고값, **랭킹 반영은 verifiedScore만**
2. 서버 시간 기준 계산(오프라인 수익/이벤트 종료)
3. 비정상 패턴 탐지 시 status=flagged, 임시 랭킹 제외
4. 결제는 영수증 검증 성공 시에만 지급
