# Clan Royale

A voice-controlled pixel-art strategy game where you command troops by talking to an AI battle advisor. Built on a Clash Royale-inspired game engine, Clan Royale replaces touch controls with natural voice — tell your commander to "push left lane" or "defend the towers" and watch your strategy unfold in real time.

Built for the **Mistral Worldwide Hackathon London 2025**.

## How It Works

You speak. The AI listens, thinks, and deploys.

1. **Voice Input** — ElevenLabs Conversational AI captures your spoken commands via WebRTC ("send tanks down the left lane", "defend right side")
2. **Game State Snapshot** — The ElevenLabs agent calls a client tool to read the live game state: mana, hand, troop positions, tower health
3. **Strategy Engine** — Mistral Small processes the game state + your command via structured JSON output, deciding which cards to play and where
4. **Execution** — The game API receives the strategy response and spawns troops on the battlefield
5. **Feedback Loop** — The AI voice advisor narrates what it did, warns you about enemy pushes, and suggests next moves via contextual updates

```
                         +---------+
                         |  PLAYER |
                         | (voice) |
                         +----+----+
                              |
                              v
                    +-------------------+
                    |   ElevenLabs      |
                    | Conversational AI |
                    | (WebRTC Agent)    |
                    +--------+----------+
                             |
                   +---------+---------+
                   |                   |
                   v                   v
          +----------------+   +---------------+
          | Client Tools:  |   | Contextual    |
          | get_game_state |   | Updates from  |
          | execute_actions|   | GameAPI events|
          +-------+--------+   +-------+-------+
                  |                     ^
                  v                     |
           +-------------+      +------+------+
           |  Mistral    |      |   GameAPI   |
           |  Small      |      | (monitors   |
           | (strategy   |      |  towers,    |
           |  JSON out)  |      |  mana,      |
           +------+------+      |  pushes)    |
                  |             +------+------+
                  v                    ^
           +-------------+            |
           |  Express    +------------+
           |  Proxy      |
           |  Server     |
           +------+------+
                  |
                  v
           +-------------+
           |  Phaser 3   |
           |  Game       |
           |  Engine     |
           +-------------+
```

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Game Engine | **Phaser 3** | 2D pixel-art rendering, physics, sprite animation |
| Voice AI | **ElevenLabs Conversational AI** | Real-time voice input/output via WebRTC |
| Strategy AI | **Mistral Small** (structured output) | Converts voice commands + game state into deployment decisions |
| Backend | **Express.js** | API proxy for Mistral calls and ElevenLabs signed URLs |
| Bundler | **Parcel** | Zero-config bundling for the browser client |

## Project Structure

```
clan-royale/
  index.html              # Page shell and layout
  index.js                # Phaser game bootstrap
  server/
    index.js              # Express API server (Mistral + ElevenLabs proxy)
  settings/
    config.js             # Phaser config (resolution, zoom, scenes)
  scenes/
    LoadingScene.js       # Asset loading
    TitleScene.js         # Title screen
    PlayScene.js          # Main gameplay (troops, physics, AI init)
    UIScene.js            # HUD overlay (elixir bar, health bars, timer)
    WinScene.js           # Victory screen
    LoseScene.js          # Defeat screen
    CreditsScene.js       # Credits
  classes/
    GameAPI.js            # Singleton exposing game state + actions for AI
    VoiceSession.js       # ElevenLabs WebRTC session wrapper
    ManaBank.js           # Mana/elixir resource management
    ui/
      VoiceUI.js          # Voice panel DOM (chat transcript, mic button)
    entities/
      troops/             # Troop types (tank, witch, demon, etc.)
      cards/              # Card deck and hand management
      components/         # ECS-style mixins (health, attack, movement)
      environment/        # Terrain objects (bridges, river, trees)
  weather/                # Rain particle system
  assets/                 # Sprites, tilesets, fonts
```

## Setup

### Prerequisites

- Node.js 18+
- API keys for Mistral and ElevenLabs

### Install

```bash
npm install
```

### Configure

Create a `.env` file in the project root:

```env
MISTRAL_API_KEY=your_mistral_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
```

### Run

Start both the game client and the API server:

```bash
# Terminal 1 — Game client (opens http://localhost:1234)
npm start

# Terminal 2 — API server (runs on http://localhost:3001)
node server/index.js
```

Open the game in your browser, click the microphone button, and start commanding your troops.

## Gameplay

- **13 unique troop types** with different stats, speeds, and abilities (tanks, ranged, flying, swarm)
- **Dual-lane battlefield** — split your forces or commit to one side
- **Elixir system** — troops cost mana; manage your economy or get overwhelmed
- **3-minute matches** with double elixir in the final minute
- **AI opponent** that deploys its own troops automatically
- **Voice commands** like "attack left", "defend", "send everything right", or ask "what should I do?"

## Challenge Targets

| Challenge | How We Address It |
|-----------|-------------------|
| **Supercell — Best Video Game** | Full Clash Royale-inspired game with voice AI twist |
| **ElevenLabs — Best Voice Use Case** | Real-time conversational voice control of a strategy game |
| **Track 2 — Fine-tuning** | Evaluation pipeline for Mistral strategy quality |

## Credits

- Game engine forked from [pyxld-kris/clash-royale-clone](https://github.com/pyxld-kris/clash-royale-clone)
- Original pixel art and streaming by [Dev Launchers](https://devlaunchers.com)
- Voice AI powered by [ElevenLabs](https://elevenlabs.io)
- Strategy AI powered by [Mistral AI](https://mistral.ai)
