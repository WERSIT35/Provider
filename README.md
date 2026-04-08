# Provider Slot MVP

Initial runnable prototype for a server-authoritative slot.

## Requirements

- Node.js 18+

## Run

```bash
npm start
```

Open:

`http://localhost:3000`

## What Is Implemented

- Session init API: `POST /api/v1/session/init`
- Spin API: `POST /api/v1/spin`
- Health API: `GET /api/v1/health`
- Server-authoritative reel outcome resolution
- Basic line/scatter evaluation
- Free spins and multiplier progression
- Expanding wild reel modifier
- Browser client wired to backend APIs

## Notes

- In-memory sessions only (no database yet).
- Current math config is placeholder and not certification-ready.
