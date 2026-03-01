import { Scene } from "phaser";

class LoseScene extends Scene {
  constructor() {
    super("LoseScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#2B1A0E");
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const sceneWidth = this.cameras.main.width;
    const sceneHeight = this.cameras.main.height;

    // Scanline overlay
    for (let y = 0; y < sceneHeight; y += 2) {
      this.add
        .rectangle(centerX, y, sceneWidth, 1, 0x000000)
        .setAlpha(0.12);
    }

    // Decorative bracket lines
    const bracketL = this.add
      .rectangle(centerX - 50, centerY - 25, 8, 1, 0xA33B2A)
      .setAlpha(0);
    const bracketR = this.add
      .rectangle(centerX + 50, centerY - 25, 8, 1, 0xA33B2A)
      .setAlpha(0);

    this.tweens.add({
      targets: bracketL,
      alpha: 0.6,
      x: centerX - 45,
      duration: 400,
      ease: "Back.easeOut"
    });
    this.tweens.add({
      targets: bracketR,
      alpha: 0.6,
      x: centerX + 45,
      duration: 400,
      ease: "Back.easeOut"
    });

    // Defeat title
    const title = this.add
      .bitmapText(centerX, centerY - 25, "teeny-tiny-pixls", "DEFEAT", 10)
      .setTint(0xA33B2A)
      .setOrigin(0.5, 0.5)
      .setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      duration: 600,
      ease: "Power2"
    });

    // Pulsing glow on title
    this.tweens.add({
      targets: title,
      alpha: { from: 1, to: 0.6 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: 600
    });

    // Subtitle
    this.add
      .bitmapText(centerX, centerY - 8, "teeny-tiny-pixls", "BASE DESTROYED", 5)
      .setTint(0xC4A265)
      .setOrigin(0.5, 0.5);

    // Play Again button
    const btnBg = this.add
      .rectangle(centerX, centerY + 15, 60, 12, 0x3B2312)
      .setStrokeStyle(1, 0xA33B2A, 0.8)
      .setInteractive({ useHandCursor: true });

    const btnText = this.add
      .bitmapText(centerX, centerY + 15, "teeny-tiny-pixls", "PLAY AGAIN", 5)
      .setTint(0xC4A265)
      .setOrigin(0.5, 0.5);

    btnBg.on("pointerover", () => {
      btnBg.setFillStyle(0x5C3A1E);
      btnText.setTint(0xFFF8E7);
    });
    btnBg.on("pointerout", () => {
      btnBg.setFillStyle(0x3B2312);
      btnText.setTint(0xC4A265);
    });
    btnBg.on("pointerdown", () => {
      this._restartGame();
    });
  }

  _restartGame() {
    const sceneManager = this.scene.manager;
    sceneManager.getScenes().forEach(function (scene) {
      const sceneKey = scene.scene.key;
      scene.scene.stop(sceneKey);
    });
    sceneManager.start("TitleScene");
  }
}

export default LoseScene;
