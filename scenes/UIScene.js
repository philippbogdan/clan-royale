import Phaser from "phaser";
import { Scene } from "phaser";

class UIScene extends Scene {
  constructor() {
    super("UIScene");
  }

  create() {
    let centerX = this.cameras.main.centerX;
    let centerY = this.cameras.main.centerY;
    let sceneWidth = this.cameras.main.width;
    let sceneHeight = this.cameras.main.height;

    // (Menu removed for cleaner UI)

    // ── LANE DIVIDER ──
    const dividerX = 80;
    const dotSize = 1;
    const dotGap = 4;
    for (let y = 30; y < 200; y += dotGap) {
      this.add
        .rectangle(dividerX, y, dotSize, dotSize, 0xC4A265)
        .setAlpha(0.1)
        .setOrigin(0.5, 0.5);
    }

    // ── LANE LABELS ──
    this.leftLaneLabel = this.add
      .bitmapText(40, 105, "teeny-tiny-pixls", "< LEFT >", 5)
      .setTint(0xC4A265)
      .setAlpha(0.25)
      .setOrigin(0.5, 0.5);

    this.rightLaneLabel = this.add
      .bitmapText(120, 105, "teeny-tiny-pixls", "< RIGHT >", 5)
      .setTint(0xC4A265)
      .setAlpha(0.25)
      .setOrigin(0.5, 0.5);

    // ── TROOP COUNT INDICATORS ──
    // Friendly (green) vs Enemy (red) troop counts per lane — via HTML overlay
    const overlay = window.__textOverlay;
    this._leftCountId = overlay ? overlay.add(40, 113, "", {
      fontSize: 5, color: '#F5E6C8', stroke: '#000000', fontWeight: 'bold', alpha: 0.45
    }) : null;

    this._rightCountId = overlay ? overlay.add(120, 113, "", {
      fontSize: 5, color: '#F5E6C8', stroke: '#000000', fontWeight: 'bold', alpha: 0.45
    }) : null;

    // (Status readout removed for cleaner UI)

    // (Mana bar handled by ManaBank's built-in DisplayBar)

    // ── DEPLOY QUEUE DISPLAY ──
    this.queueContainer = this.add.container(0, 0).setDepth(10001);
    this._queueSprites = [];
    this._prevQueueLength = -1;
    this._queuePulseTween = null;
    this.queueLabel = this.add
      .bitmapText(4, sceneHeight - 17, "teeny-tiny-pixls", "QUEUE", 5)
      .setTint(0xC4A265).setAlpha(0).setDepth(10001);

    // ── HEALTH BARS (drawn each frame via Graphics) ──
    this.healthBars = this.add.graphics();
    this.healthBars.setDepth(50);

    // ── MATCH TIMER ──
    this._matchTime = 180; // 3 minutes in seconds
    this._matchTimerAccum = 0;
    this._doubleElixir = false;
    this._doubleElixirShown = false;
    this._matchEnded = false;

    // Timer via HTML overlay (smooth anti-aliased text)
    // Offset position since overlay centers text via translate(-50%,-50%),
    // but original used origin(0,0) at (5,5)
    const timerOverlay = window.__textOverlay;
    this._timerOverlayId = timerOverlay ? timerOverlay.add(14, 8, "3:00", {
      fontSize: 6, color: '#DAA520', stroke: '#000000', fontWeight: 'bold', alpha: 0.9
    }) : null;

    // Double elixir flash text (hidden)
    this.doubleElixirText = this.add
      .bitmapText(centerX, 28, "teeny-tiny-pixls", "x2 ELIXIR!", 5)
      .setTint(0xDAA520)
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(95);

    this._timerPulseTween = null;

    // ── DEPLOYMENT FLASH ──
    this.deployFlash = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0xDAA520)
      .setAlpha(0)
      .setDepth(100);

    // ── AI THINKING OVERLAY ──
    this.aiThinkingBg = this.add
      .rectangle(centerX, 20, sceneWidth - 10, 11, 0x2B1A0E)
      .setAlpha(0)
      .setDepth(90);

    this.aiThinkingText = this.add
      .bitmapText(centerX, 20, "teeny-tiny-pixls", "AI ANALYZING...", 5)
      .setTint(0xC4A265)
      .setOrigin(0.5, 0.5)
      .setAlpha(0)
      .setDepth(91);

    this.aiThinkingTween = null;

    // ── VICTORY / DEFEAT OVERLAY (hidden by default) ──
    this.gameOverContainer = this.add.container(0, 0).setDepth(200).setAlpha(0);

    // Full-screen dark overlay
    this.gameOverBg = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0x2B1A0E)
      .setAlpha(0.85);
    this.gameOverContainer.add(this.gameOverBg);

    // Scanline effect on game over screen
    for (let y = 0; y < sceneHeight; y += 2) {
      const scanline = this.add
        .rectangle(centerX, y, sceneWidth, 1, 0x000000)
        .setAlpha(0.15);
      this.gameOverContainer.add(scanline);
    }

    // Result text (VICTORY or DEFEAT)
    this.gameOverTitle = this.add
      .bitmapText(centerX, centerY - 30, "teeny-tiny-pixls", "", 10)
      .setOrigin(0.5, 0.5);
    this.gameOverContainer.add(this.gameOverTitle);

    // Sub-text
    this.gameOverSub = this.add
      .bitmapText(centerX, centerY - 10, "teeny-tiny-pixls", "", 5)
      .setOrigin(0.5, 0.5)
      .setTint(0xF5E6C8);
    this.gameOverContainer.add(this.gameOverSub);

    // PLAY AGAIN button
    const btnBg = this.add
      .rectangle(centerX, centerY + 15, 60, 12, 0x3B2312)
      .setStrokeStyle(1, 0xDAA520, 0.8)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => {
        btnBg.setFillStyle(0x5C3A1E);
        btnText.setTint(0xFFF8E7);
      })
      .on("pointerout", () => {
        btnBg.setFillStyle(0x3B2312);
        btnText.setTint(0xDAA520);
      })
      .on("pointerdown", () => {
        this._restartGame();
      });
    this.gameOverContainer.add(btnBg);

    const btnText = this.add
      .bitmapText(centerX, centerY + 15, "teeny-tiny-pixls", "PLAY AGAIN", 5)
      .setTint(0xDAA520)
      .setOrigin(0.5, 0.5);
    this.gameOverContainer.add(btnText);

    // Decorative bracket lines around title
    this.gameOverBracketL = this.add
      .rectangle(centerX - 50, centerY - 30, 8, 1, 0xDAA520)
      .setAlpha(0.5);
    this.gameOverContainer.add(this.gameOverBracketL);

    this.gameOverBracketR = this.add
      .rectangle(centerX + 50, centerY - 30, 8, 1, 0xDAA520)
      .setAlpha(0.5);
    this.gameOverContainer.add(this.gameOverBracketR);

    this._gameOverShown = false;

    // ── COMMANDER MASCOT (top-right, hidden by default, appears during tactical pause) ──
    const mascotScale = 0.09; // ~36px wide from 408px source
    const mascotX = sceneWidth - 20;
    const mascotY = 4;

    // Golden glow shadow behind the king (drawn with Graphics)
    this.mascotGlow = this.add.graphics();
    this.mascotGlow.setDepth(154); // just behind mascot (155)
    this.mascotGlow.setAlpha(0);
    // Draw a soft golden radial glow: layered circles with decreasing alpha
    const glowCx = mascotX;
    const glowCy = mascotY + 20; // center vertically on mascot
    this.mascotGlow.fillStyle(0xDAA520, 0.15);
    this.mascotGlow.fillCircle(glowCx, glowCy, 28);
    this.mascotGlow.fillStyle(0xDAA520, 0.2);
    this.mascotGlow.fillCircle(glowCx, glowCy, 22);
    this.mascotGlow.fillStyle(0xDAA520, 0.25);
    this.mascotGlow.fillCircle(glowCx, glowCy, 16);
    this.mascotGlow.fillStyle(0xFFD700, 0.15);
    this.mascotGlow.fillCircle(glowCx, glowCy, 10);

    this.mascotClosed = this.add
      .image(mascotX, mascotY, "mascot-closed")
      .setScale(mascotScale)
      .setOrigin(0.5, 0)
      .setDepth(155) // above dim overlay (150)
      .setAlpha(0); // hidden by default

    this.mascotOpen = this.add
      .image(mascotX, mascotY, "mascot-open")
      .setScale(mascotScale)
      .setOrigin(0.5, 0)
      .setDepth(155)
      .setAlpha(0)
      .setVisible(false);

    this._mascotVisible = false; // tracks whether mascot is shown

    // Mouth animation state
    this._mascotMouthOpen = false;
    this._mascotMouthTimer = 0;
    this._mascotMouthInterval = 180; // ms between mouth toggles

    // ── TRANSCRIPT TEXT (below mascot, only visible during tactical pause) ──
    this.transcriptText = this.add
      .bitmapText(mascotX, mascotY + 38, "teeny-tiny-pixls", "", 5)
      .setTint(0xF5E6C8)
      .setOrigin(1, 0)
      .setDepth(155)
      .setAlpha(0);

    this._transcriptFadeTimer = 0;
    this._lastTranscriptText = "";

    // ── MIC ACTIVITY INDICATOR (green dot, top-right near mascot area) ──
    this.micIndicator = this.add.graphics();
    this.micIndicator.fillStyle(0x4ADE80, 1);
    this.micIndicator.fillCircle(0, 0, 2);
    this.micIndicator.setPosition(sceneWidth - 4, mascotY + 2);
    this.micIndicator.setDepth(155);
    this.micIndicator.setAlpha(0);
    this._micPulseTween = null;

    // ── EVENT LISTENERS ──
    this.game.registry.events.on("changedata-voiceStatus", (parent, value) => {
      this.setVoiceStatus(value);
    });

    this.game.registry.events.on("changedata-deployEvent", (parent, value) => {
      if (value) {
        this.flashDeploy();
      }
    });

    if (!this.game.registry.has("voiceStatus")) {
      this.game.registry.set("voiceStatus", "ready");
    }

    // Track troop count update throttle
    this._lastTroopCountUpdate = 0;

    // ── TACTICAL PAUSE OVERLAY ──
    // Dim overlay (darkens the screen during tactical pause)
    this.dimOverlay = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0x000000)
      .setAlpha(0)
      .setDepth(150);

    // Container for ghost preview sprites
    this.ghostContainer = this.add.container(0, 0).setDepth(160);

    // (Tactical pause text removed — dim overlay is sufficient indicator)

    // Deploy flash for tactical deploy (white/gold full screen)
    this.tacticalFlash = this.add
      .rectangle(centerX, centerY, sceneWidth, sceneHeight, 0xFFF8E7)
      .setAlpha(0)
      .setDepth(170);

    // ── TACTICAL PAUSE EVENT LISTENERS ──
    const playSceneRef = this.scene.get("PlayScene");

    playSceneRef.events.on("tactical-freeze", () => {
      // Fade in dim overlay
      this.tweens.add({
        targets: this.dimOverlay,
        alpha: 0.55,
        duration: 300,
        ease: "Power2"
      });
    });

    playSceneRef.events.on("tactical-preview", (previewData) => {
      // previewData: array of {card, lane, x, y}
      this.ghostContainer.removeAll(true);
      for (const item of previewData) {
        const spriteKey = item.card.replace("Troop", "").toLowerCase();

        // Use sprite if texture exists, otherwise a colored rectangle fallback
        let ghost;
        if (this.textures.exists(spriteKey)) {
          ghost = this.add.sprite(item.x, item.y, spriteKey)
            .setAlpha(0.8)
            .setTint(0xFFFFFF)
            .setDepth(160);
        } else {
          ghost = this.add.rectangle(item.x, item.y, 8, 8, 0xFFFFFF)
            .setAlpha(0.8)
            .setDepth(160);
        }

        // Pulsing glow effect
        this.tweens.add({
          targets: ghost,
          alpha: { from: 0.8, to: 0.4 },
          scaleX: { from: 1, to: 1.15 },
          scaleY: { from: 1, to: 1.15 },
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut"
        });

        // Lane label under ghost
        const label = this.add
          .bitmapText(item.x, item.y + 10, "teeny-tiny-pixls", item.card.replace("Troop", "").toUpperCase(), 5)
          .setTint(0xDAA520)
          .setOrigin(0.5, 0)
          .setDepth(161);

        this.ghostContainer.add(ghost);
        this.ghostContainer.add(label);
      }
    });

    playSceneRef.events.on("tactical-deploy", () => {
      // Deploy flash
      this.tacticalFlash.setAlpha(0.5);
      this.tweens.add({
        targets: this.tacticalFlash,
        alpha: 0,
        duration: 300,
        ease: "Power2"
      });

      // Remove ghosts
      this.ghostContainer.removeAll(true);

      // Fade out dim overlay
      this.tweens.add({
        targets: this.dimOverlay,
        alpha: 0,
        duration: 400,
        ease: "Power2"
      });

      // Subtle screen shake on deploy
      this.cameras.main.shake(200, 0.008);
    });
  }

  /**
   * Set the voice/AI status indicator text and color.
   */
  setVoiceStatus(status) {
    // AI Thinking overlay
    if (status === "thinking") {
      this._showAIThinking();
    } else {
      this._hideAIThinking();
    }
  }

  /**
   * Show pulsing AI ANALYZING overlay.
   */
  _showAIThinking() {
    if (this.aiThinkingTween) return;

    this.aiThinkingBg.setAlpha(0.4);
    this.aiThinkingText.setAlpha(1);

    this.aiThinkingTween = this.tweens.add({
      targets: this.aiThinkingText,
      alpha: { from: 1, to: 0.3 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
  }

  /**
   * Hide AI thinking overlay.
   */
  _hideAIThinking() {
    if (this.aiThinkingTween) {
      this.aiThinkingTween.stop();
      this.aiThinkingTween = null;
    }
    this.aiThinkingBg.setAlpha(0);
    this.aiThinkingText.setAlpha(0);
  }

  /**
   * White flash effect on deploy.
   */
  flashDeploy() {
    this.deployFlash.setFillStyle(0xDAA520);
    this.deployFlash.setAlpha(0.35);
    this.tweens.add({
      targets: this.deployFlash,
      alpha: 0,
      duration: 100,
      ease: "Power2"
    });
  }

  /**
   * Show victory/defeat overlay.
   */
  showGameOver(result) {
    if (this._gameOverShown) return;
    this._gameOverShown = true;

    if (result === "won") {
      this.gameOverTitle.setText("VICTORY");
      this.gameOverTitle.setTint(0xDAA520);
      this.gameOverSub.setText("ALL TARGETS ELIMINATED");
      this.gameOverSub.setTint(0xC4A265);
      this.gameOverBracketL.setFillStyle(0xDAA520);
      this.gameOverBracketR.setFillStyle(0xDAA520);
      this.gameOverBg.setFillStyle(0x2B1A0E);
      this.gameOverBg.setAlpha(0.8);
    } else {
      this.gameOverTitle.setText("DEFEAT");
      this.gameOverTitle.setTint(0xA33B2A);
      this.gameOverSub.setText("BASE DESTROYED");
      this.gameOverSub.setTint(0xC4A265);
      this.gameOverBracketL.setFillStyle(0xA33B2A);
      this.gameOverBracketR.setFillStyle(0xA33B2A);
      this.gameOverBg.setFillStyle(0x3B2312);
      this.gameOverBg.setAlpha(0.6);
    }

    // Fade in the game over container
    this.tweens.add({
      targets: this.gameOverContainer,
      alpha: 1,
      duration: 600,
      ease: "Power2"
    });

    // Pulsing glow on the title
    this.tweens.add({
      targets: this.gameOverTitle,
      alpha: { from: 1, to: 0.6 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });

    // Animate brackets sliding in
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    this.gameOverBracketL.setPosition(centerX - 70, centerY);
    this.gameOverBracketR.setPosition(centerX + 70, centerY);
    this.tweens.add({
      targets: this.gameOverBracketL,
      x: centerX - 50,
      y: centerY - 30,
      alpha: 0.6,
      duration: 400,
      ease: "Back.easeOut"
    });

    this.tweens.add({
      targets: this.gameOverBracketR,
      x: centerX + 50,
      y: centerY - 30,
      alpha: 0.6,
      duration: 400,
      ease: "Back.easeOut"
    });
  }

  /**
   * Restart the game.
   */
  _restartGame() {
    let sceneManager = this.scene.manager;
    sceneManager.getScenes().forEach(function(scene) {
      let sceneKey = scene.scene.key;
      scene.scene.stop(sceneKey);
    });
    sceneManager.start("TitleScene");
  }

  /**
   * Count troops in each lane for a player group.
   * Lane boundary is x=80 (divider).
   */
  _countTroopsPerLane(troopGroup) {
    let left = 0;
    let right = 0;
    if (troopGroup && troopGroup.getChildren) {
      const children = troopGroup.getChildren();
      for (let i = 0; i < children.length; i++) {
        const troop = children[i];
        if (troop && troop.active) {
          if (troop.x < 80) {
            left++;
          } else {
            right++;
          }
        }
      }
    }
    return { left, right };
  }

  // Keep UI scene on top
  update(time, delta) {
    if (parseInt(time) % 20 === 0) {
      this.scene.bringToTop();
    }

    // ── Update commander mascot (only visible during tactical pause / speaking) ──
    try {
      const isSpeaking = typeof window !== 'undefined' && window.__ttsSpeaking;
      const isDimmed = this.dimOverlay && this.dimOverlay.alpha > 0.1;
      const shouldShow = isSpeaking || isDimmed;

      if (shouldShow && !this._mascotVisible) {
        // Fade in the commander + golden glow
        this._mascotVisible = true;
        this.tweens.add({
          targets: this.mascotClosed,
          alpha: 0.95,
          duration: 200,
          ease: "Power2"
        });
        this.tweens.add({
          targets: this.mascotGlow,
          alpha: 0.9,
          duration: 300,
          ease: "Power2"
        });
      } else if (!shouldShow && this._mascotVisible) {
        // Fade out the commander + golden glow
        this._mascotVisible = false;
        this._mascotMouthOpen = false;
        this._mascotMouthTimer = 0;
        this.tweens.add({
          targets: [this.mascotClosed, this.mascotOpen],
          alpha: 0,
          duration: 300,
          ease: "Power2",
          onComplete: () => {
            this.mascotOpen.setVisible(false);
          }
        });
        this.tweens.add({
          targets: this.mascotGlow,
          alpha: 0,
          duration: 400,
          ease: "Power2"
        });
      }

      // Mouth animation (only when speaking and visible)
      if (isSpeaking && this._mascotVisible) {
        this._mascotMouthTimer += delta;
        if (this._mascotMouthTimer >= this._mascotMouthInterval) {
          this._mascotMouthTimer = 0;
          this._mascotMouthOpen = !this._mascotMouthOpen;
        }
        if (this._mascotMouthOpen) {
          this.mascotClosed.setAlpha(0);
          this.mascotOpen.setVisible(true).setAlpha(0.95);
        } else {
          this.mascotClosed.setAlpha(0.95);
          this.mascotOpen.setVisible(false).setAlpha(0);
        }
      } else if (!isSpeaking && this._mascotMouthOpen) {
        // Stop mouth animation, show closed
        this._mascotMouthOpen = false;
        this._mascotMouthTimer = 0;
        if (this._mascotVisible) {
          this.mascotClosed.setAlpha(0.95);
        }
        this.mascotOpen.setVisible(false).setAlpha(0);
      }
    } catch (e) { /* mascot not ready */ }

    // ── Update transcript display ──
    try {
      const transcript = (typeof window !== 'undefined' && window.__currentTranscript) || "";
      if (transcript && transcript !== this._lastTranscriptText) {
        // New transcript text arrived
        this._lastTranscriptText = transcript;
        let display = transcript;
        if (display.length > 25) {
          display = "..." + display.slice(display.length - 22);
        }
        this.transcriptText.setText(display);
        this.transcriptText.setAlpha(0.85);
        this._transcriptFadeTimer = 0;
      } else if (!transcript && this._lastTranscriptText) {
        // Transcript cleared — start fading
        this._lastTranscriptText = "";
        this._transcriptFadeTimer = 0;
      }

      // Fade out transcript over 2 seconds after clearing
      if (!this._lastTranscriptText && this.transcriptText.alpha > 0) {
        this._transcriptFadeTimer += delta;
        const fadeAlpha = 0.85 * Math.max(0, 1 - this._transcriptFadeTimer / 2000);
        this.transcriptText.setAlpha(fadeAlpha);
      }
    } catch (e) { /* transcript not ready */ }

    // ── Update mic activity indicator ──
    try {
      const userSpeaking = typeof window !== 'undefined' && window.__userSpeaking;
      if (userSpeaking && !this._micPulseTween) {
        this.micIndicator.setAlpha(0.9);
        this._micPulseTween = this.tweens.add({
          targets: this.micIndicator,
          alpha: { from: 0.9, to: 0.3 },
          duration: 400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut"
        });
      } else if (!userSpeaking && this._micPulseTween) {
        this._micPulseTween.stop();
        this._micPulseTween = null;
        this.micIndicator.setAlpha(0);
      }
    } catch (e) { /* mic indicator not ready */ }

    try {
      const playScene = this.scene.get("PlayScene");
      if (!playScene || !playScene.sys || !playScene.sys.isActive() || !playScene.player) return;

      // ── Update match timer ──
      if (!this._matchEnded && !this._gameOverShown) {
        this._matchTimerAccum += delta;
        if (this._matchTimerAccum >= 1000) {
          this._matchTimerAccum -= 1000;
          this._matchTime--;
          if (this._matchTime <= 0) {
            this._matchTime = 0;
            this._matchEnded = true;
            // Time's up -- whoever has more towers wins, or defender wins
            const pTowers = playScene.player.towers.children ? playScene.player.towers.getLength() : 0;
            const oTowers = playScene.opponent.towers.children ? playScene.opponent.towers.getLength() : 0;
            if (pTowers >= oTowers) {
              this.showGameOver("won");
            } else {
              this.showGameOver("lost");
            }
          }

          // Double elixir at 1:00
          if (this._matchTime === 60 && !this._doubleElixirShown) {
            this._doubleElixir = true;
            this._doubleElixirShown = true;
            // Flash x2 ELIXIR text
            this.doubleElixirText.setAlpha(1);
            this.tweens.add({
              targets: this.doubleElixirText,
              alpha: 0,
              duration: 2500,
              ease: "Power2"
            });
            // Double the mana regen rate if manaBank supports it
            if (playScene.player.manaBank && playScene.player.manaBank.regenRate !== undefined) {
              playScene.player.manaBank.regenRate *= 2;
            }
            if (playScene.opponent.manaBank && playScene.opponent.manaBank.regenRate !== undefined) {
              playScene.opponent.manaBank.regenRate *= 2;
            }
          }

          // Format timer display
          const mins = Math.floor(this._matchTime / 60);
          const secs = this._matchTime % 60;
          const timerStr = mins + ":" + (secs < 10 ? "0" : "") + secs;
          if (window.__textOverlay && this._timerOverlayId != null) {
            window.__textOverlay.setText(this._timerOverlayId, timerStr);
          }

          // Timer color when <30s or <60s
          if (this._matchTime <= 30 && this._matchTime > 0) {
            if (window.__textOverlay && this._timerOverlayId != null) {
              window.__textOverlay.setColor(this._timerOverlayId, '#A33B2A');
            }
          } else if (this._matchTime <= 60) {
            if (window.__textOverlay && this._timerOverlayId != null) {
              window.__textOverlay.setColor(this._timerOverlayId, '#C47832');
            }
          }
        }
      }

      // (Mana bar is handled by ManaBank's built-in DisplayBar)

      // ── Update deploy queue display ──
      try {
        const queue = (typeof window !== 'undefined' && window.__deployQueue) || [];
        const qLen = queue.length;

        if (qLen !== this._prevQueueLength) {
          this._prevQueueLength = qLen;

          // Stop existing pulse tween
          if (this._queuePulseTween) {
            this._queuePulseTween.stop();
            this._queuePulseTween = null;
          }

          // Clear and rebuild
          this.queueContainer.removeAll(true);
          this._queueSprites = [];

          if (qLen === 0) {
            this.queueLabel.setAlpha(0);
          } else {
            this.queueLabel.setAlpha(0.7);

            const sceneHeight = this.cameras.main.height;
            const startX = 30;
            const startY = sceneHeight - 21;
            const cardW = 12;
            const cardH = 12;
            const gap = 3;
            const maxShow = Math.min(qLen, 5);

            for (let i = 0; i < maxShow; i++) {
              const item = queue[i];
              const cx = startX + i * (cardW + gap);
              const cy = startY;

              // Card background
              const bg = this.add
                .rectangle(cx, cy, cardW, cardH, 0x3B2312)
                .setStrokeStyle(1, i === 0 ? 0xDAA520 : 0xC4A265, 0.8)
                .setOrigin(0, 0);

              // Card name (truncate to 3 chars)
              const name = (item.card || item.name || "?").replace("Troop", "").substring(0, 3).toUpperCase();
              const nameText = this.add
                .bitmapText(cx + cardW / 2, cy + 2, "teeny-tiny-pixls", name, 5)
                .setTint(0xFFF8E7)
                .setOrigin(0.5, 0);

              // Cost text below name
              const costStr = "" + (item.cost !== undefined ? item.cost : "?");
              const costText = this.add
                .bitmapText(cx + cardW / 2, cy + cardH - 4, "teeny-tiny-pixls", costStr, 5)
                .setTint(0xDAA520)
                .setOrigin(0.5, 0);

              // Progressive dimming: front item brightest, rest dimmer
              const alpha = Math.max(0.3, 0.95 - i * 0.15);
              bg.setAlpha(alpha);
              nameText.setAlpha(alpha);
              costText.setAlpha(alpha);

              this.queueContainer.add(bg);
              this.queueContainer.add(nameText);
              this.queueContainer.add(costText);

              if (i === 0) {
                this._queueSprites.push({ bg, nameText, costText });
              }
            }

            // Pulse tween on front-of-queue card
            if (maxShow > 0 && this._queueSprites.length > 0) {
              const front = this._queueSprites[0];
              this._queuePulseTween = this.tweens.add({
                targets: [front.bg, front.nameText, front.costText],
                alpha: { from: 0.95, to: 0.5 },
                duration: 800,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut"
              });
            }
          }
        }

        // Every frame: update front card stroke color based on mana
        if (qLen > 0 && this._queueSprites.length > 0) {
          const frontItem = queue[0];
          const frontCost = frontItem.cost !== undefined ? frontItem.cost : 0;
          const playScene = this.scene.get("PlayScene");
          if (playScene && playScene.player && playScene.player.manaBank) {
            const currentMana = Math.floor(playScene.player.manaBank.getManaAmount());
            const strokeColor = currentMana >= frontCost ? 0xDAA520 : 0x5C3A1E;
            this._queueSprites[0].bg.setStrokeStyle(1, strokeColor, 0.8);
          }
        }
      } catch (e) { /* queue display not ready */ }

      // ── Draw health bars on troops and towers ──
      this.healthBars.clear();

      // Helper to draw a single health bar
      const drawHealthBar = (entity, color) => {
        if (!entity || !entity.active) return;
        const hp = entity.currentHealth !== undefined ? entity.currentHealth : entity.health;
        const maxHp = entity.maxHealth || entity.baseHealth || hp;
        if (!hp || hp <= 0 || !maxHp) return;

        const pct = hp / maxHp;
        const barW = entity.isTower ? 20 : 16;
        const x = entity.x - barW / 2;
        const y = entity.y - (entity.isTower ? 16 : 12);

        // Dark brown bg with border
        this.healthBars.fillStyle(0x2B1A0E, 0.7);
        this.healthBars.fillRect(x - 1, y - 1, barW + 2, 4);
        // Colored fill
        this.healthBars.fillStyle(color, 0.9);
        this.healthBars.fillRect(x, y, Math.max(1, Math.floor(barW * pct)), 2);
      };

      // Player troops (arena green)
      if (playScene.player.troops && playScene.player.troops.getChildren) {
        playScene.player.troops.getChildren().forEach(t => drawHealthBar(t, 0x4A7B2D));
      }
      // Opponent troops (clay red)
      if (playScene.opponent && playScene.opponent.troops && playScene.opponent.troops.getChildren) {
        playScene.opponent.troops.getChildren().forEach(t => drawHealthBar(t, 0xA33B2A));
      }
      // Player towers (arena green)
      if (playScene.player.towers && playScene.player.towers.getChildren) {
        playScene.player.towers.getChildren().forEach(t => drawHealthBar(t, 0x4A7B2D));
      }
      // Opponent towers (clay red)
      if (playScene.opponent && playScene.opponent.towers && playScene.opponent.towers.getChildren) {
        playScene.opponent.towers.getChildren().forEach(t => drawHealthBar(t, 0xA33B2A));
      }

      // ── Update troop counts (throttled to every ~500ms) ──
      if (time - this._lastTroopCountUpdate > 500) {
        this._lastTroopCountUpdate = time;

        const playerTroops = this._countTroopsPerLane(playScene.player.troops);
        const enemyTroops = this._countTroopsPerLane(playScene.opponent.troops);

        // Format: friendlyCount/enemyCount per lane
        const leftStr = playerTroops.left + "v" + enemyTroops.left;
        const rightStr = playerTroops.right + "v" + enemyTroops.right;

        const ov = window.__textOverlay;
        if (ov && this._leftCountId != null) ov.setText(this._leftCountId, leftStr);
        if (ov && this._rightCountId != null) ov.setText(this._rightCountId, rightStr);

        // Highlight lane with enemy advantage in clay red
        if (ov && this._leftCountId != null) {
          if (enemyTroops.left > playerTroops.left) {
            ov.setColor(this._leftCountId, '#A33B2A');
          } else if (playerTroops.left > enemyTroops.left) {
            ov.setColor(this._leftCountId, '#4A7B2D');
          } else {
            ov.setColor(this._leftCountId, '#F5E6C8');
          }
        }

        if (ov && this._rightCountId != null) {
          if (enemyTroops.right > playerTroops.right) {
            ov.setColor(this._rightCountId, '#A33B2A');
          } else if (playerTroops.right > enemyTroops.right) {
            ov.setColor(this._rightCountId, '#4A7B2D');
          } else {
            ov.setColor(this._rightCountId, '#F5E6C8');
          }
        }
      }

      // ── Check for game over ──
      if (!this._gameOverShown) {
        if (playScene.player.towers.getLength() === 0) {
          this.showGameOver("lost");
        } else if (playScene.opponent.towers.getLength() === 0) {
          this.showGameOver("won");
        }
      }
    } catch (e) {
      // PlayScene may not be ready yet
    }
  }
}

export default UIScene;
