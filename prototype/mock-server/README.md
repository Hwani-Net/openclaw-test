# Ppocha Mock API Server

로컬에서 실행 가능한 JSON API 목업 서버입니다.

## Run

```bash
cd /home/node/projects/openclaw-test/prototype/mock-server
node server.mjs
```

기본 포트: `8787`

## Endpoints

- `GET /health`
- `GET /api/player/state?uid=6702395893`
- `GET /api/shop/catalog?uid=6702395893&country=KR&city=Seoul&segment=default`
- `POST /api/shop/purchase/verify`
- `POST /api/economy/offline/claim`
- `POST /api/game/session/finish`
- `GET /api/rankings?scope=country&period=weekly&type=skill`
- `POST /api/rankings/submit`
- `GET /api/missions/daily?uid=6702395893`
- `POST /api/pass/claim`

## Quick curl samples

```bash
curl http://localhost:8787/health

curl "http://localhost:8787/api/rankings?scope=country&period=weekly&type=business"

curl -X POST http://localhost:8787/api/economy/offline/claim \
  -H "Content-Type: application/json" \
  -d '{"uid":"6702395893","claimType":"x2"}'
```
