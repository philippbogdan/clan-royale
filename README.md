# Clan Royale

Voice-driven real-time strategy game built with Phaser.

You speak commands, the AI reasons over live game state, then deploys cards on a 10x6 battlefield.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create `.env` in project root:
```env
MISTRAL_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...

# Optional
XAI_API_KEY=...
WANDB_API_KEY=...
DEEPGRAM_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
PORT=3001
CLIENT_ORIGIN=http://localhost:1234
```

3. Run backend:
```bash
node server/index.js
```

4. Run frontend:
```bash
npm start
```

5. Open `http://localhost:1234`.

## Scripts

- `npm start`: run Phaser client via Parcel.
- `npm run build`: production build.
- `node server/index.js`: run API + Deepgram websocket proxy.

## Architecture

### Client (`/classes`, `/scenes`, `/settings`)

- `scenes/PlayScene.js`: core gameplay orchestration (players, combat loops, AI turns, voice mode).
- `scenes/UIScene.js`: HUD, tactical pause overlays, health bars, spectator panels.
- `classes/GameAPI.js`: game-state serialization + action execution + queue + telemetry hooks.
- `classes/SpeechInput.js`: Deepgram STT streaming and command dispatch.
- `classes/VoiceSession.js`: ElevenLabs conversational session + TTS playback.
- `settings/gameConstants.js`: shared battlefield and coordinate constants.
- `settings/api.js`: centralized API/WS URL resolution.
- `settings/assets.js`: declarative asset manifest for loading.

### Server (`/server`)

- `server/index.js`: app composition only (Express, routes, websocket proxy).
- `server/routes/api.js`: HTTP endpoint surface.
- `server/services/strategyService.js`: strategy + orchestrator pipelines.
- `server/modelClients.js`: Mistral/Grok/W&B client wrappers.
- `server/strategyValidator.js`: schema and action validation.
- `server/prompts.js`: model prompt contracts.
- `server/deepgramProxy.js`: WS relay to Deepgram.

## Core Endpoints

- `GET /api/health`
- `GET /api/config`
- `POST /api/strategy`
- `POST /api/ai-turn`
- `POST /api/tts`
- `POST /api/record-gameplay`
- `WS /deepgram`

## Development Notes

- API base URL is centralized in `settings/api.js`.
- Grid/canvas constants live in `settings/gameConstants.js`; avoid hardcoded coordinates.
- Keep server logic modular: prompts, validation, model calls, and routes are separate by design.

## Evaluation Utilities

Under `/evaluation`:

- `run-match.js`: headless match simulation (Playwright).
- `evaluate.js`: metrics aggregation.
- `generate-training-data.js`: connector training set generation.
- `fine-tune.js`: fine-tuning job launcher.

## Troubleshooting

- If voice commands do nothing, confirm backend is running and API keys are set.
- If `POST /api/strategy` returns 500, verify `MISTRAL_API_KEY`.
- If STT fails, verify `DEEPGRAM_API_KEY` and websocket reachability on backend port.
