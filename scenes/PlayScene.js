import { Scene } from "phaser";

import ControlledPlayer from "../classes/player/ControlledPlayer.js";
import ComputerPlayer from "../classes/player/ComputerPlayer.js";
import GameAPI from "../classes/GameAPI.js";
import SpeechInput from "../classes/SpeechInput.js";
import VoiceSession from "../classes/VoiceSession.js";
import Components from "../classes/entities/components";
import genAnims from "../helpers/generateAnimations";
import genTerrain from "../helpers/generateTerrain";
import { getApiUrl } from "../settings/api.js";
import {
  DEFAULT_DEPLOY_Y,
  GAME_HEIGHT,
  GRID_CENTER_OFFSET_Y,
  GRID_ORIGIN_Y,
  GRID_ROW_HEIGHT,
  LEFT_DEPLOY_X,
  PLAYER_GRID,
  RIGHT_DEPLOY_X
} from "../settings/gameConstants.js";
import WeatherSystem from "../weather";

const AI_LOOP_INTERVAL_MS = 5000;
const OPPONENT_AI_OFFSET_MS = 2500;
const HIT_SFX_COOLDOWN_MS = 1200;

const SFX_CONFIG = {
  "sfx-hit": { name: "hit", volume: 0.08 },
  "sfx-spawn": { name: "spawn", volume: 0.15 },
  "sfx-destroy": { name: "destroy", volume: 0.07 }
};

export default class PlayScene extends Scene {
  constructor() {
    super("PlayScene");
  }

  create() {
    try {
      this.isSpectatorMode = window.gameMode === "spectator";
      this.scene.run("UIScene");
      genAnims(this);

      this._initDimensions();
      this._setupWorldAndCamera();

      Components.HasDestructionParticles.particles = null;
      this._createBackground();
      this._createPlayers();
      this._setupCombatOverlaps();

      genTerrain(this);
      this._setupPhysicsColliders();

      this.weather = new WeatherSystem(this);
      this._setupAudio();
      this._setupGameApi();
      this._setupControlMode();
      this._setupWinConditionHandler();
    } catch (e) {
      // Initialization failed silently.
    }
  }

  _initDimensions() {
    this.gameWidth = this.game.config.width;
    this.gameHeight = this.game.config.height;
    this.halfGameWidth = this.gameWidth / 2;
    this.halfGameHeight = this.gameHeight / 2;

    this.cardHolderWidth = this.gameWidth;
    this.cardHolderHeight = this.isSpectatorMode ? 0 : 46;
  }

  _setupWorldAndCamera() {
    this.physics.world.setBounds(
      0,
      0,
      this.gameWidth,
      this.gameHeight - this.cardHolderHeight
    );

    this.camera = this.cameras.main;
    this.camera.setBounds(0, 0, this.gameWidth, this.gameHeight);
  }

  _createBackground() {
    this.background = this.add
      .sprite(this.halfGameWidth, this.halfGameHeight, "background")
      .setOrigin(0.5, 0.5)
      .setTint(0x228800);
  }

  _createPlayers() {
    if (this.isSpectatorMode) {
      this.player = new ComputerPlayer(this, "bottom");
      this.opponent = new ComputerPlayer(this);
    } else {
      this.player = new ControlledPlayer(this);
      this.opponent = new ComputerPlayer(this);
    }

    this.player.setOpponent(this.opponent);
    this.opponent.setOpponent(this.player);
  }

  _setupCombatOverlaps() {
    this._registerAggroOverlap(this.opponent.aggroAreas, this.player.troops);
    this._registerAggroOverlap(this.player.aggroAreas, this.opponent.troops);
  }

  _registerAggroOverlap(attackerAggroAreas, defenderTroops) {
    this.physics.add.overlap(
      attackerAggroAreas,
      defenderTroops,
      (aggroArea, enemyTroop) => {
        const sourceTroop = aggroArea.troop;
        if (!sourceTroop || sourceTroop.isDestroyed || enemyTroop.isDestroyed) {
          return;
        }

        sourceTroop.initiateEffect(enemyTroop);
        this._playHitSfx();
      }
    );
  }

  _setupPhysicsColliders() {
    this.physics.add.collider(this.player.walkingTroops, this.opponent.walkingTroops);
    this.physics.add.collider(this.player.walkingTroops, this.player.walkingTroops);
    this.physics.add.collider(this.opponent.walkingTroops, this.opponent.walkingTroops);

    this.physics.add.collider(this.player.flyingTroops, this.opponent.flyingTroops);
    this.physics.add.collider(this.player.flyingTroops, this.player.flyingTroops);
    this.physics.add.collider(this.opponent.flyingTroops, this.opponent.flyingTroops);

    this.physics.add.collider(this.player.walkingTroops, this.river);
    this.physics.add.collider(this.opponent.walkingTroops, this.river);
  }

  _setupAudio() {
    this._sfx = {};
    this._lastHitSfxTime = 0;
    this._setupBackgroundMusic();
    this._setupSfx();
  }

  _setupBackgroundMusic() {
    try {
      if (!this.cache.audio.exists("music")) {
        return;
      }

      this.bgMusic = this.sound.add("music", { volume: 0.15, loop: true });
      this.time.delayedCall(500, () => {
        if (this.bgMusic) {
          this.bgMusic.play();
        }
      });
    } catch (error) {
      // Background music unavailable.
    }
  }

  _setupSfx() {
    for (const [assetKey, cfg] of Object.entries(SFX_CONFIG)) {
      if (this.cache.audio.exists(assetKey)) {
        this._sfx[cfg.name] = this.sound.add(assetKey, { volume: cfg.volume });
      }
    }

    window.__playSFX = name => {
      if (this._sfx && this._sfx[name]) {
        this._sfx[name].play();
      }
    };
  }

  _playHitSfx() {
    const now = Date.now();
    if (now - this._lastHitSfxTime <= HIT_SFX_COOLDOWN_MS) {
      return;
    }

    this._lastHitSfxTime = now;
    if (window.__playSFX) {
      window.__playSFX("hit");
    }
  }

  _setupGameApi() {
    this.gameAPI = new GameAPI(this);
    window.gameAPI = this.gameAPI;
  }

  _setupControlMode() {
    if (this.isSpectatorMode) {
      this._setupSpectatorMode();
      return;
    }

    this._setupVoiceMode();
  }

  _setupSpectatorMode() {
    this._pauseNativeComputerAI(this.player);
    this._pauseNativeComputerAI(this.opponent);

    this._aiLoopPlayer = this.time.addEvent({
      delay: AI_LOOP_INTERVAL_MS,
      loop: true,
      callback: () => this._runAITurn("player"),
      callbackScope: this
    });

    this.time.delayedCall(OPPONENT_AI_OFFSET_MS, () => {
      this._aiLoopOpponent = this.time.addEvent({
        delay: AI_LOOP_INTERVAL_MS,
        loop: true,
        callback: () => this._runAITurn("opponent"),
        callbackScope: this
      });
    });
  }

  _setupVoiceMode() {
    this.speechInput = new SpeechInput(this.gameAPI);
    window.__speechInput = this.speechInput;
    this.speechInput.start();

    this.voiceSession = new VoiceSession(this.gameAPI);
    this.speechInput.onTranscript = text => {
      if (!this.voiceSession || !this.voiceSession.isActive()) {
        return;
      }

      try {
        this.voiceSession.sendText(text);
      } catch (err) {
        // Ignore send races during reconnects.
      }
    };

    if (window.__ELEVENLABS_AGENT_ID) {
      this.voiceSession.start(window.__ELEVENLABS_AGENT_ID);
    }

    if (window.opponentModelType) {
      this._pauseNativeComputerAI(this.opponent);
      this._aiLoopOpponent = this.time.addEvent({
        delay: AI_LOOP_INTERVAL_MS,
        loop: true,
        callback: () => this._runAITurn("opponent"),
        callbackScope: this
      });
    }
  }

  _setupWinConditionHandler() {
    this._sceneEnding = false;
    this.events.on("tower-destroyed", data => {
      try {
        if (this._sceneEnding) {
          return;
        }

        if (!data || !data.isKingTower) {
          return;
        }

        this._sceneEnding = true;
        this.events.off("tower-destroyed");
        this._stopBackgroundMusic();
        this.scene.stop("UIScene");
        this.physics.world.shutdown();

        if (data.owner === this.player) {
          this.scene.start("LoseScene");
        } else {
          this.scene.start("WinScene");
        }
      } catch (error) {
        // Tower-destroyed handler failed silently.
      }
    });
  }

  _pauseNativeComputerAI(player) {
    if (player && player.decisionInterval) {
      player.decisionInterval.paused = true;
    }
  }

  freezeGame() {
    this.physics.pause();
    this._tacticalFrozen = true;

    if (this.opponent && this.opponent.decisionInterval) {
      this.opponent.decisionInterval.paused = true;
    }

    this._setManaRegenPaused(this.player, true);
    this._setManaRegenPaused(this.opponent, true);
    this.tweens.pauseAll();
    this.events.emit("tactical-freeze");
  }

  unfreezeGame() {
    this._tacticalFrozen = false;
    this.physics.resume();

    if (this.opponent && this.opponent.decisionInterval) {
      this.opponent.decisionInterval.paused = false;
    }

    this._setManaRegenPaused(this.player, false);
    this._setManaRegenPaused(this.opponent, false);
    this.tweens.resumeAll();
    this.events.emit("tactical-unfreeze");
  }

  _setManaRegenPaused(player, paused) {
    if (player && player.manaBank && player.manaBank.regenEvent) {
      player.manaBank.regenEvent.paused = paused;
    }
  }

  async _runAITurn(side) {
    if (this._sceneEnding || this[`_aiRunning_${side}`]) {
      return;
    }
    this[`_aiRunning_${side}`] = true;

    try {
      const isPlayerSide = side === "player";
      const gameState = this._buildGameStateForSide(side);
      const modelType = isPlayerSide
        ? window.spectatorModelType || "base"
        : window.opponentModelType || "base";

      const response = await fetch(getApiUrl("/api/ai-turn"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameState, modelType, side })
      });

      if (!response.ok) {
        return;
      }

      const decision = await response.json();
      const actions = decision.connector && decision.connector.actions
        ? decision.connector.actions
        : [];
      if (actions.length === 0) {
        return;
      }

      this._executeAIActions(side, actions);
      this.events.emit("ai-decision", { side, decision });

      if (this.gameAPI) {
        this.gameAPI.recordDecision(gameState, actions, side);
      }
    } catch (error) {
      // AI turn failed; will retry next interval.
    } finally {
      this[`_aiRunning_${side}`] = false;
    }
  }

  _executeAIActions(side, actions) {
    if (side === "player") {
      for (const action of actions) {
        const { x, y } = this._resolveActionPosition(action);
        this.player.spawnTroopByName(action.card, x, y);
      }
      return;
    }

    for (const action of actions) {
      const col = action.col != null ? action.col : action.lane === "left" ? 2 : 7;
      const row = action.row != null ? action.row : 2;
      const { x } = GameAPI.gridToPixel(col, row);
      // Mirror Y into the top half: opponent's grid is the player grid reflected
      const playerY = GRID_ORIGIN_Y + row * GRID_ROW_HEIGHT + GRID_CENTER_OFFSET_Y;
      const y = GAME_HEIGHT - playerY;
      this.opponent.spawnTroopByName(action.card, x, y);
    }
  }

  _resolveActionPosition(action) {
    if (action.col != null && action.row != null) {
      return GameAPI.gridToPixel(action.col, action.row);
    }

    return {
      x: action.lane === "left" ? LEFT_DEPLOY_X : RIGHT_DEPLOY_X,
      y: DEFAULT_DEPLOY_Y
    };
  }

  _buildGameStateForSide(side) {
    if (side === "player") {
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
        grid: PLAYER_GRID
      };
    }

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
      grid: PLAYER_GRID
    };
  }

  update() {
    if (window.__textOverlay) {
      window.__textOverlay.update();
    }

    if (
      !this.isSpectatorMode &&
      this.player &&
      this.player.cardArea &&
      this.player.cardArea.hand
    ) {
      this.player.cardArea.hand.updateOverlays();
    }

    if (this.gameAPI && !this._sceneEnding && !this.isSpectatorMode) {
      this.gameAPI.processQueue();
    }
  }

  destroy() {
    this._stopBackgroundMusic();

    if (this._aiLoopPlayer) {
      this._aiLoopPlayer.remove();
      this._aiLoopPlayer = null;
    }
    if (this._aiLoopOpponent) {
      this._aiLoopOpponent.remove();
      this._aiLoopOpponent = null;
    }

    if (this.speechInput) {
      this.speechInput.stop();
      this.speechInput = null;
      window.__speechInput = null;
    }

    if (this.voiceSession) {
      this.voiceSession.stop().catch(() => {});
      this.voiceSession = null;
    }

    this._sfx = {};
    window.__playSFX = null;

    if (this.player) {
      this.player.destroy();
    }
    if (this.opponent) {
      this.opponent.destroy();
    }

    super.destroy();
  }

  _stopBackgroundMusic() {
    if (this.bgMusic) {
      this.bgMusic.stop();
      this.bgMusic = null;
    }
  }
}
