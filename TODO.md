# TODO -- Clan Royale Hackathon Submission

## Done

- [x] Core game engine (Phaser 3 pixel art CR clone, 16 troops, two lanes, towers, mana)
- [x] GameAPI singleton -- exposes full game state + action execution for AI consumption
- [x] VoiceSession -- ElevenLabs Conversational AI integration via WebRTC with client tools
- [x] VoiceUI -- Battle Chat panel with voice toggle, text input, transcript history
- [x] Express server with Mistral strategy endpoint (`/api/strategy`) and ElevenLabs token proxy
- [x] Mistral structured JSON output with validation and automatic retry
- [x] GameAPI event system -- monitors opponent pushes, tower damage, mana cap, low health
- [x] Contextual updates pipeline (game events -> ElevenLabs agent)
- [x] Upscaled game to 3x zoom with redesigned page layout
- [x] VoiceUI redesign -- clean chat-style interface
- [x] Combat juice -- hit flash, damage numbers, deploy effects, death animations
- [x] Tower destruction screenshake + particles
- [x] Elixir bar redesign (CR purple/pink style) + health bars on all entities + match timer
- [x] Mana spend flash effect + full-mana glow pulse
- [x] Lane divider, troop count indicators, AI thinking overlay
- [x] Victory/defeat overlay with play again button
- [x] Double elixir at 1:00 remaining
- [x] Shadows on troops
- [x] SUBMISSION.md and README.md
- [x] Earth-tone color palette applied to page chrome (index.html, VoiceUI.js)
- [x] Earth-tone color palette applied to in-game HUD (UIScene.js)
- [x] Mistral strategy system prompt optimization (full troop data, validation, retry, fallback)
- [x] ElevenLabs voice experience polish -- system prompt + richer contextual updates
- [x] Evaluation pipeline skeleton for Track 2 (generate-training-data, run-match, evaluate)
- [x] UI redesign -- dark minimal aesthetic, glass-morphism voice panel
- [x] Voice transport fix -- switched from WebRTC to WebSocket to avoid LiveKit SDK crash

## In Progress

- [ ] Final end-to-end testing (voice flow, text flow, game over, restart)
- [ ] Fix ElevenLabs voice connection stability (switched to websocket transport, needs real-browser testing)

## Remaining for Submission

- [ ] Tactical Pause — cinematic deploy sequence (see below)
- [ ] Screenshots for submission (title screen, mid-battle, voice chat active, game over)
- [ ] Short demo video recording (30-60s showing voice command -> deployment -> battle)
- [ ] Confirm .env.example has all required variables documented

## Tactical Pause — Cinematic Deploy Sequence

**The big showstopper feature.** When the player speaks a command:

1. **FREEZE + DIM** — The game freezes (physics paused, mana paused, all troops stop). The game canvas dims/darkens with an overlay. This signals "the commander is thinking."
2. **AI THINKS** — The ElevenLabs agent calls get_game_state, sends to Mistral, gets back troop placements. The commander narrates what it's planning ("Dropping a tank on the left and witch behind it!").
3. **PREVIEW** — The chosen troops appear on the dimmed/frozen battlefield as bright highlighted silhouettes or glowing sprites at their deploy positions. The player sees exactly where troops will land before they drop.
4. **EPIC DEPLOY** — The game unfreezes. The preview sprites transform into real troops with a dramatic spawn animation (flash, scale-up, maybe a small screen shake). The dim overlay lifts. Battle resumes.

**End result**: Every voice command feels like calling in an airstrike. The pause creates tension, the preview builds anticipation, and the deploy is the payoff. This is the "wow moment" for the demo — it makes voice control feel cinematic rather than just functional.

## Fine-tuned vs Base Mistral Comparison (Track 2)

**Goal**: Justify fine-tuning by showing measurable improvement.

**Setup**:
- **Operator model** (the "commander"): High-level strategic brain (e.g. Mistral Large or another model). Issues commands like "push left tower", "defend right", "save mana", "all-in". Substitutes a human player.
- **Connector model** (the model under test): Translates commander's high-level intent + game state into specific card deployments (which card, which lane, which position). This is the base vs fine-tuned Mistral.

**Match format**:
- Commander + base Mistral vs Commander + fine-tuned Mistral
- 100 matches, automated (no human input)
- Both sides use identical commander model/prompt so the only variable is the connector
- Record full match replay data (every game state + every action taken + timestamps)

**Outputs**:
- Win rate comparison (base vs fine-tuned)
- Visual dashboard showing:
  - Win rate over time (cumulative chart)
  - Average mana efficiency (mana spent vs damage dealt)
  - Action validity rate (% of commands that were legal/executable)
  - Response latency comparison
  - Per-troop deployment frequency heatmap
- Match replay system: ability to replay any of the 100 matches step-by-step
- Export results as presentation-ready charts for hackathon demo

**Implementation notes**:
- Need headless game mode (no rendering, fast-forward simulation) for 100 matches
- Replay format: JSONL with timestamped game states + actions
- Replay viewer: step through states, show board, highlight deployments

## Backlog

- [ ] RAG system for AI agent — build a retrieval system so Mistral/agent can pull up detailed troop stats, abilities, descriptions, and synergies from the deck. Would help the AI make smarter strategic decisions based on actual troop data rather than just names and costs.
- [ ] Investigate Deepgram transcription drops — interim transcripts show on-screen but some never reach final/Mistral
- [ ] Dim and freeze game while player speaks + Mistral processes
- [ ] Cinematic card flight animation during tactical pause (spline curve from deck to target position, sigmoid easing, tick sounds)

## Known Issues

- WebRTC transport (livekit-client@2.17.2 + Parcel 1.x) crashes on data channel — using WebSocket transport as workaround
- Voice session reconnect limited to 2 attempts to prevent infinite loop
- Mistral can occasionally return troop names not matching the valid troop list (retry + fallback handles this)
- Text input mode requires the Express server running on port 3001
- Parcel HMR can sometimes break the Phaser game state on hot reload — full page refresh fixes it
- Game canvas doesn't fill container width (Phaser Scale.FIT + zoom:3 constrained by container height)
