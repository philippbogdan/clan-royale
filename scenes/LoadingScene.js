import { Scene } from "phaser";

import {
  AUDIO_ASSETS,
  IMAGE_ASSETS,
  SPRITESHEET_ASSETS
} from "../settings/assets.js";

export default class LoadingScene extends Scene {
  constructor() {
    super("LoadingScene");
  }

  init() {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const barWidth = this.cameras.main.width - 24;
    const barHeight = 25;

    const progressBox = this.add.rectangle(
      centerX,
      centerY,
      barWidth,
      barHeight,
      0x000000
    );

    const progressBar = this.add
      .rectangle(
        progressBox.x - parseInt(progressBox.width / 2, 10),
        centerY,
        barWidth,
        barHeight,
        0xffffff
      )
      .setOrigin(0, 0.5)
      .setScale(0, 1);

    this.load.on("progress", value => {
      progressBar.setScale(value, 1);
    });

    this.load.on("complete", () => {
      this.scene.start("PlayScene");
      this.loadingProgressComplete = true;
    });
  }

  preload() {
    this.load.bitmapFont(
      "teeny-tiny-pixls",
      "assets/fonts/teeny-tiny-pixls.png",
      "assets/fonts/teeny-tiny-pixls.fnt"
    );

    IMAGE_ASSETS.forEach(([key, path]) => {
      this.load.image(key, path);
    });

    SPRITESHEET_ASSETS.forEach(([key, path, config]) => {
      this.load.spritesheet(key, path, config);
    });

    AUDIO_ASSETS.forEach(([key, path]) => {
      this.load.audio(key, path);
    });

    this._createGeneratedTextures();
  }

  create() {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;

    this.add
      .bitmapText(centerX, centerY - 24, "teeny-tiny-pixls", "Loading", 10)
      .setOrigin(0.5, 0.5);
  }

  _createGeneratedTextures() {
    const waypoint = this.add.graphics();
    waypoint.fillStyle(0xffffff, 1);
    waypoint.fillCircle(10, 10, 10);
    waypoint.generateTexture("waypoint");
    waypoint.destroy();

    const particleRect = this.add.graphics();
    particleRect.fillStyle(0xffffff, 1);
    particleRect.fillRect(-2, -2, 4, 4);
    particleRect.generateTexture("particle-rect");
    particleRect.destroy();
  }
}
