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
      // Start UIScene, which will layer on top of PlayScene
      this.scene.run("UIScene");

      // helper function to generate our sprite anims
      genAnims(this);

      const gameWidth = this.game.config.width;
      const gameHeight = this.game.config.height;
      const halfGameWidth = gameWidth / 2;
      const halfGameHeight = gameHeight / 2;

      this.cardHolderWidth = gameWidth;
      this.cardHolderHeight = 46;

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

      this.player = new ControlledPlayer(this);
      this.opponent = new ComputerPlayer(this);

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
      const sfxConfig = { 'sfx-hit': { name: 'hit', volume: 0.08 }, 'sfx-spawn': { name: 'spawn', volume: 0.15 }, 'sfx-destroy': { name: 'destroy', volume: 0.20 } };
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

      // Always-on speech input: Player Voice → Text → Mistral → GameAPI → TTS
      this.speechInput = new SpeechInput(this.gameAPI);
      window.__speechInput = this.speechInput; // expose for TTS feedback prevention
      this.speechInput.start();

      // ElevenLabs voice session (optional — connects if agent ID is available)
      this.voiceSession = new VoiceSession(this.gameAPI);
      this.speechInput.onTranscript = (text, isFinal) => {
        if (this.voiceSession && this.voiceSession.isActive()) {
          try { this.voiceSession.sendText(text); } catch(e) { /* ignore */ }
        }
      };
      // Only start ElevenLabs if explicitly configured via env var
      if (window.__ELEVENLABS_AGENT_ID) {
        this.voiceSession.start(window.__ELEVENLABS_AGENT_ID);
      }

      // Check win condition whenever towers are destroyed!
      // Towers emit a "tower-destroyed" event to the scene when destroyed
      this._sceneEnding = false;
      this.events.on("tower-destroyed", () => {
        try {
          if (this._sceneEnding) return;
          if (window.__playSFX) window.__playSFX('destroy');
          // Did this player win?
          if (this.player.towers.getLength() === 0) {
            this._sceneEnding = true;
            this.events.off("tower-destroyed");
            this.physics.world.shutdown();
            this.scene.start("LoseScene");
          }

          // Did the opponent win?
          else if (this.opponent.towers.getLength() === 0) {
            this._sceneEnding = true;
            this.events.off("tower-destroyed");
            this.physics.world.shutdown();
            this.scene.start("WinScene");
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

  update(time, delta) {
    if (window.__textOverlay) window.__textOverlay.update();
    if (this.gameAPI && !this._sceneEnding) {
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
