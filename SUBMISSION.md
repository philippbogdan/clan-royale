# Clan Royale -- Hackathon Submission

**Event**: Mistral Worldwide Hackathon London (Feb 28 - Mar 1, 2026)
**Team**: Solo

---

## What We Built

**Clan Royale** is a voice-controlled Clash Royale clone built on top of a Phaser 3 pixel art game engine. Instead of tapping cards, you speak to a battle commander AI who deploys troops for you. The AI understands game context, talks back with personality, and makes strategic decisions using Mistral structured JSON output.

**"Talk to win."** -- You say "push left lane", the commander hypes you up, and tanks roll out.

---

## Challenges Targeting

| Challenge | Prize | Why We Fit |
|-----------|-------|------------|
| **Supercell Best Video Game** | $5K Game Boy | Full playable CR clone with AI voice commander |
| **ElevenLabs Best Voice** | $5K ElevenLabs credits | ElevenLabs Conversational AI as the core gameplay interface |
| **Track 2: Fine-tuning** | $6K ElevenLabs + $15K Mistral credits | Base vs fine-tuned Mistral evaluation pipeline for strategy |

---

## Architecture

```
Player (voice/text)
    |
    v
ElevenLabs Conversational AI  <-->  Client Tools (get_game_state, execute_actions)
    |                                        |
    v                                        v
Express Server (port 3001)              GameAPI (singleton)
    |                                        |
    v                                        v
Mistral Small (JSON mode)           Phaser 3 Game Engine
    |                                   - Troops, Towers, Mana
    v                                   - Cards, Decks, Lanes
Validated Strategy Response             - Combat, Health, Effects
    |
    v
GameAPI.executeActions() --> Cards deploy in-game
```

---

## Key Technical Achievements

### 1. ElevenLabs Conversational AI as Battle Commander
- Real-time WebRTC voice session via `@elevenlabs/client` SDK
- Two client tools exposed: `get_game_state` (reads full board) and `execute_actions` (deploys cards)
- Contextual updates pushed to the agent on game events (tower damage, enemy push, mana full)
- The commander has personality -- it hypes successful plays and warns about incoming threats

### 2. Mistral Structured JSON Output for Strategy
- `mistral-small-latest` with `responseFormat: { type: 'json_object' }` for guaranteed parseable output
- Strategy system prompt covers: mana management, troop matchups, lane pressure, attack vs defense
- Server-side validation with automatic retry on malformed responses
- 10-second timeout with abort controller for real-time gameplay responsiveness

### 3. GameAPI -- Full Game State Exposure for AI
- Singleton wrapper over Phaser scene internals
- Exposes: mana, hand (cards + costs), troop positions/health, tower positions/health, game status
- Action execution: `playCard(slot, lane)`, `playCardByName(name, lane)`, `executeActions([])`
- Event system: monitors for opponent pushes (3+ troops in lane), tower damage, low health towers, mana cap
- Contextual update pipeline: game events -> human-readable text -> ElevenLabs agent context

### 4. Two Input Modes
- **Voice**: Mic button activates ElevenLabs session. Speak naturally, agent responds with voice + deploys cards via client tools
- **Text**: Type commands in Battle Chat panel. Text goes to Mistral `/api/strategy` endpoint, returns JSON actions, GameAPI executes them

### 5. Evaluation Pipeline (Track 2)
- Automated match framework: Commander model (high-level strategy) + Connector model (card deployment)
- Same commander on both sides; only variable is base Mistral vs fine-tuned Mistral as connector
- 100-match automated evaluation with metrics: win rate, mana efficiency, action validity rate
- Designed for headless fast-forward simulation

---

## Game Features

- 16 unique pixel art troops (Alien, Tank, Witch, Volcano, BattleOtter, etc.)
- Two-lane combat with waypoint pathfinding
- Mana/elixir system with double elixir at 1:00 remaining
- Tower destruction with screenshake and particles
- Combat juice: hit flash, damage numbers, deploy effects, death animations
- Health bars on all troops and towers
- 3-minute match timer with overtime
- In-game HUD: elixir bar, lane troop counts, AI status indicator, match timer
- Battle Chat panel with transcript history (player messages, AI responses, system events)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game engine | Phaser 3.22 (pixel art, 160x208 canvas at 3x zoom) |
| Voice AI | ElevenLabs Conversational AI (WebRTC) |
| Strategy AI | Mistral Small (JSON structured output) |
| Server | Express.js + CORS |
| Build | Parcel bundler |
| Art style | Pixel art with earth-tone color palette |

---

## Demo Flow

1. **Start**: Open game, click Play on title screen. Battle begins immediately.
2. **Connect voice**: Click mic button in Battle Chat panel (or type commands).
3. **Speak a command**: "Push left lane with tanks" / "Defend right, they're pushing!" / "Go all in!"
4. **AI responds**: Commander acknowledges with personality, analyzes game state, picks optimal cards.
5. **Cards deploy**: Troops appear on the battlefield. You see deployment flash + system messages.
6. **Battle plays out**: Troops walk lanes, attack towers, combat effects fire. Health bars update in real-time.
7. **AI adapts**: Contextual updates inform the commander about tower damage, enemy pushes, mana state.
8. **Win or lose**: Game over screen with VICTORY/DEFEAT + play again.

---

## Running Locally

```bash
# Terminal 1 - Backend server
cp .env.example .env  # Add MISTRAL_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID
node server/index.js

# Terminal 2 - Frontend
npm install
npm start
# Opens http://localhost:1234
```

---

## File Structure (key files)

```
server/index.js           - Express server, Mistral strategy endpoint, ElevenLabs token proxy
classes/GameAPI.js         - Game state exposure + action execution for AI
classes/VoiceSession.js    - ElevenLabs WebRTC conversation manager
classes/ui/VoiceUI.js      - Battle Chat panel (voice + text input, transcript)
scenes/UIScene.js          - In-game HUD (elixir bar, health bars, timer, AI status)
scenes/PlayScene.js        - Main game scene
classes/entities/troops/    - 16 troop types
index.html                 - Page layout with game container + voice panel
```
