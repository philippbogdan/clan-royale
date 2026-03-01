import { Phaser, Scene } from "phaser";

import ControlledPlayer from "../classes/player/ControlledPlayer.js";
import ComputerPlayer from "../classes/player/ComputerPlayer.js";
import GameAPI from "../classes/GameAPI.js";
import VoiceSession from "../classes/VoiceSession.js";
import SpeechInput from "../classes/SpeechInput.js";

import Components from "../classes/entities/components";

import WeatherSystem from "../weather";

import genAnims from "../helpers/generateAnimations";
import genTerrain from "../helpers/generateTerrain";

export default class PlayScene extends Scene {
  constructor() {
    super("PlayScene");
  }

  create() {
    try {
      this.isSpectatorMode = window.gameMode === 'spectator';

      // Start UIScene, which will layer on top of PlayScene
      this.scene.run("UIScene");

      // helper function to generate our sprite anims
      genAnims(this);

      const gameWidth = this.game.config.width;
      const gameHeight = this.game.config.height;
      const halfGameWidth = gameWidth / 2;
      const halfGameHeight = gameHeight / 2;

      this.cardHolderWidth = gameWidth;
      this.cardHolderHeight = this.isSpectatorMode ? 0 : 46;

      // Set the physics world size
      this.physics.world.setBounds(
        0,
        0,
        this.game.config.width,
        this.game.config.height - this.cardHolderHeight
      );

      this.camera = this.cameras.main;
      this.camera.setBounds(
        0,
        0,
        this.game.config.width,
        this.game.config.height
      );

      /*
      this.physics.world.bounds.width,
      this.physics.world.bounds.height
    */

      // Reset stuff from previous rounds...
      Components.HasDestructionParticles.particles = null;

      // Create background, and do really simple animation
      this.background = this.add
        .sprite(halfGameWidth, halfGameHeight, "background")
        .setOrigin(0.5, 0.5)
        .setTint(0x228800);

      if (this.isSpectatorMode) {
        // Both sides are AI-controlled ComputerPlayers
        this.player = new ComputerPlayer(this, 'bottom');
        this.opponent = new ComputerPlayer(this);
      } else {
        this.player = new ControlledPlayer(this);
        this.opponent = new ComputerPlayer(this);
      }

      this.player.setOpponent(this.opponent);
      this.opponent.setOpponent(this.player);

      // Set up opponent troops attacking player troops
      this.physics.add.overlap(
        this.opponent.aggroAreas,
        this.player.troops,
        (aggroArea, enemyTroop) => {
          const thisTroop = aggroArea.troop;
          if (!thisTroop || thisTroop.isDestroyed || enemyTroop.isDestroyed) return;
          thisTroop.initiateEffect(enemyTroop);
          const now = Date.now();
          if (now - this._lastHitSfxTime > 1200) {
            this._lastHitSfxTime = now;
            if (window.__playSFX) window.__playSFX('hit');
          }
        }
      );

      // Set up player troops attacking opponent troops
      this.physics.add.overlap(
        this.player.aggroAreas,
        this.opponent.troops,
        (aggroArea, enemyTroop) => {
          const thisTroop = aggroArea.troop;
          if (!thisTroop || thisTroop.isDestroyed || enemyTroop.isDestroyed) return;
          thisTroop.initiateEffect(enemyTroop);
          const now = Date.now();
          if (now - this._lastHitSfxTime > 1200) {
            this._lastHitSfxTime = now;
            if (window.__playSFX) window.__playSFX('hit');
          }
        }
      );

      genTerrain(this);

      // add these colliders here to the groups instead of
      // in each troop creation for code cleanup.
      //this.physics.add.collider(this.player.troops, this.trees);
      //this.physics.add.collider(this.opponent.troops, this.trees);
      /*
      this.physics.add.collider(this.player.troops, this.opponent.troops);
      this.physics.add.collider(this.player.troops, this.player.troops);
      this.physics.add.collider(this.opponent.troops, this.opponent.troops);
      */
      this.physics.add.collider(
        this.player.walkingTroops,
        this.opponent.walkingTroops
      );
      this.physics.add.collider(
        this.player.walkingTroops,
        this.player.walkingTroops
      );
      this.physics.add.collider(
        this.opponent.walkingTroops,
        this.opponent.walkingTroops
      );

      this.physics.add.collider(
        this.player.flyingTroops,
        this.opponent.flyingTroops
      );
      this.physics.add.collider(
        this.player.flyingTroops,
        this.player.flyingTroops
      );
      this.physics.add.collider(
        this.opponent.flyingTroops,
        this.opponent.flyingTroops
      );

      this.physics.add.collider(this.player.walkingTroops, this.river);
      this.physics.add.collider(this.opponent.walkingTroops, this.river);

      this.weather = new WeatherSystem(this);

      // --- Background music ---
      try {
        if (this.cache.audio.exists('music')) {
          this.bgMusic = this.sound.add('music', { volume: 0.15, loop: true });
          this.time.delayedCall(500, () => {
            if (this.bgMusic) this.bgMusic.play();
          });
        }
      } catch (e) {
        console.warn('Could not start background music:', e);
      }

      // --- SFX ---
      this._sfx = {};
      this._lastHitSfxTime = 0;
      const sfxConfig = { 'sfx-hit': { name: 'hit', volume: 0.08 }, 'sfx-spawn': { name: 'spawn', volume: 0.15 }, 'sfx-destroy': { name: 'destroy', volume: 0.07 } };
      for (const [key, cfg] of Object.entries(sfxConfig)) {
        if (this.cache.audio.exists(key)) {
          this._sfx[cfg.name] = this.sound.add(key, { volume: cfg.volume });
        }
      }
      const self = this;
      window.__playSFX = (name) => {
        if (self._sfx && self._sfx[name]) self._sfx[name].play();
      };

      // Expose GameAPI for AI voice control
      this.gameAPI = new GameAPI(this);
      window.gameAPI = this.gameAPI;

      if (this.isSpectatorMode) {
        // --- Spectator mode: AI controls both sides ---

        // Disable built-in random AI for both ComputerPlayers
        if (this.player.decisionInterval) this.player.decisionInterval.paused = true;
        if (this.opponent.decisionInterval) this.opponent.decisionInterval.paused = true;

        // AI loop for PLAYER side (every 5s)
        this._aiLoopPlayer = this.time.addEvent({
          delay: 5000,
          loop: true,
          callback: () => this._runAITurn('player'),
          callbackScope: this
        });

        // AI loop for OPPONENT side (every 5s, offset by 2.5s)
        this.time.delayedCall(2500, () => {
          this._aiLoopOpponent = this.time.addEvent({
            delay: 5000,
            loop: true,
            callback: () => this._runAITurn('opponent'),
            callbackScope: this
          });
        });
      } else {
        // --- Normal player mode: voice control ---
        this.speechInput = new SpeechInput(this.gameAPI);
        window.__speechInput = this.speechInput;
        this.speechInput.start();

        this.voiceSession = new VoiceSession(this.gameAPI);
        this.speechInput.onTranscript = (text, isFinal) => {
          if (this.voiceSession && this.voiceSession.isActive()) {
            try { this.voiceSession.sendText(text); } catch(e) { /* ignore */ }
          }
        };
        if (window.__ELEVENLABS_AGENT_ID) {
          this.voiceSession.start(window.__ELEVENLABS_AGENT_ID);
        }

        // If opponent model type is set, replace random AI with API-driven AI
        if (window.opponentModelType) {
          if (this.opponent.decisionInterval) this.opponent.decisionInterval.paused = true;
          this._aiLoopOpponent = this.time.addEvent({
            delay: 5000,
            loop: true,
            callback: () => this._runAITurn('opponent'),
            callbackScope: this
          });
        }
      }

      // Check win condition whenever towers are destroyed!
      // Towers emit a "tower-destroyed" event to the scene when destroyed
      this._sceneEnding = false;
      this.events.on("tower-destroyed", (data) => {
        try {
          if (this._sceneEnding) return;
          // Tower destroy sound disabled — too harsh

          // Game ends when a king tower is destroyed
          if (data && data.isKingTower) {
            this._sceneEnding = true;
            this.events.off("tower-destroyed");
            if (this.bgMusic) {
              this.bgMusic.stop();
              this.bgMusic = null;
            }
            this.scene.stop("UIScene");
            this.physics.world.shutdown();
            if (data.owner === this.player) {
              this.scene.start("LoseScene");
            } else {
              this.scene.start("WinScene");
            }
          }
        } catch (e) {
          console.error(e);
        }
      });
    } catch (e) {
      console.error(e);
    }
  }

  freezeGame() {
    this.physics.pause();
    this._tacticalFrozen = true;
    // Pause the opponent's decision/spawn timer
    if (this.opponent && this.opponent.decisionInterval) {
      this.opponent.decisionInterval.paused = true;
    }
    // Pause mana regen for both players
    if (this.player && this.player.manaBank && this.player.manaBank.regenEvent) {
      this.player.manaBank.regenEvent.paused = true;
    }
    if (this.opponent && this.opponent.manaBank && this.opponent.manaBank.regenEvent) {
      this.opponent.manaBank.regenEvent.paused = true;
    }
    // Pause all tweens on troops so attack animations freeze
    this.tweens.pauseAll();
    this.events.emit('tactical-freeze');
  }

  unfreezeGame() {
    this._tacticalFrozen = false;
    this.physics.resume();
    // Resume the opponent's decision/spawn timer
    if (this.opponent && this.opponent.decisionInterval) {
      this.opponent.decisionInterval.paused = false;
    }
    // Resume mana regen for both players
    if (this.player && this.player.manaBank && this.player.manaBank.regenEvent) {
      this.player.manaBank.regenEvent.paused = false;
    }
    if (this.opponent && this.opponent.manaBank && this.opponent.manaBank.regenEvent) {
      this.opponent.manaBank.regenEvent.paused = false;
    }
    // Resume all tweens
    this.tweens.resumeAll();
    this.events.emit('tactical-unfreeze');
  }

  // --- Spectator AI turn logic ---

  async _runAITurn(side) {
    if (this._sceneEnding) return;
    if (this['_aiRunning_' + side]) return; // prevent overlapping calls
    this['_aiRunning_' + side] = true;

    try {
      let gameState;
      let modelType;

      if (side === 'player') {
        gameState = this._buildGameStateForSide('player');
        modelType = window.spectatorModelType || 'base';
      } else {
        gameState = this._buildGameStateForSide('opponent');
        modelType = window.opponentModelType || (this.isSpectatorMode ? 'base' : 'base');
      }

      const response = await fetch('http://localhost:3001/api/ai-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameState, modelType, side })
      });

      if (!response.ok) {
        console.error(`[AI Turn] ${side} request failed: ${response.status}`);
        return;
      }

      const decision = await response.json();
      const actions = decision.connector && decision.connector.actions ? decision.connector.actions : [];

      if (actions.length === 0) return;

      if (side === 'player') {
        // Execute on player-side ComputerPlayer
        for (const action of actions) {
          let x, y;
          if (action.col != null && action.row != null) {
            const px = GameAPI.gridToPixel(action.col, action.row);
            x = px.x; y = px.y;
          } else {
            x = action.lane === 'left' ? 40 : 120;
            y = 180;
          }
          this.player.spawnTroopByName(action.card, x, y);
        }
      } else {
        // Execute on opponent-side ComputerPlayer with mirrored rows
        for (const action of actions) {
          const mirroredRow = action.row != null ? (5 - action.row) : 2;
          const col = action.col != null ? action.col : (action.lane === 'left' ? 2 : 7);
          const px = GameAPI.gridToPixel(col, mirroredRow);
          this.opponent.spawnTroopByName(action.card, px.x, px.y);
        }
      }

      // Emit decision event for UIScene
      this.events.emit('ai-decision', { side, decision });

      // Record for training data
      if (this.gameAPI) {
        this.gameAPI.recordDecision(gameState, actions, side);
      }
    } catch (err) {
      console.error(`[AI Turn] ${side} error:`, err);
    } finally {
      this['_aiRunning_' + side] = false;
    }
  }

  _buildGameStateForSide(side) {
    if (side === 'player') {
      return {
        mana: Math.floor(this.player.manaBank.getManaAmount()),
        maxMana: 10,
        hand: this.player.getVirtualHandState(),
        myTroops: this.gameAPI._serializeTroops(this.player),
        opponentTroops: this.gameAPI._serializeTroops(this.opponent),
        myTowers: this.gameAPI._serializeTowers(this.player),
        opponentTowers: this.gameAPI._serializeTowers(this.opponent),
        gameStatus: this.gameAPI.gameStatus,
        queue: [],
        grid: { cols: 10, rows: 6, bridges: [{ col: 1, side: "left" }, { col: 8, side: "right" }] }
      };
    } else {
      // Mirrored: opponent sees itself as "my" side
      return {
        mana: Math.floor(this.opponent.manaBank.getManaAmount()),
        maxMana: 10,
        hand: this.opponent.getVirtualHandState(),
        myTroops: this.gameAPI._serializeTroops(this.opponent),
        opponentTroops: this.gameAPI._serializeTroops(this.player),
        myTowers: this.gameAPI._serializeTowers(this.opponent),
        opponentTowers: this.gameAPI._serializeTowers(this.player),
        gameStatus: this.gameAPI.gameStatus,
        queue: [],
        grid: { cols: 10, rows: 6, bridges: [{ col: 1, side: "left" }, { col: 8, side: "right" }] }
      };
    }
  }

  update(time, delta) {
    if (window.__textOverlay) window.__textOverlay.update();
    if (!this.isSpectatorMode && this.player && this.player.cardArea && this.player.cardArea.hand) {
      this.player.cardArea.hand.updateOverlays();
    }
    if (this.gameAPI && !this._sceneEnding && !this.isSpectatorMode) {
      this.gameAPI.processQueue();
    }
  }

  destroy() {
    // Stop background music
    if (this.bgMusic) {
      this.bgMusic.stop();
      this.bgMusic = null;
    }
    // Clean up SFX
    this._sfx = {};
    window.__playSFX = null;

    this.player.destroy();
    this.opponent.destroy();
    super.destroy();
  }
}
