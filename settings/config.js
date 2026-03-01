import Phaser from "phaser";

import CreditsScene from "../scenes/CreditsScene.js";
import LoadingScene from "../scenes/LoadingScene.js";
import LoseScene from "../scenes/LoseScene.js";
import PlayScene from "../scenes/PlayScene.js";
import TitleScene from "../scenes/TitleScene.js";
import UIScene from "../scenes/UIScene.js";
import WinScene from "../scenes/WinScene.js";
import { GAME_HEIGHT, GAME_WIDTH } from "./gameConstants.js";

const SCENES = [
  LoadingScene,
  TitleScene,
  PlayScene,
  UIScene,
  CreditsScene,
  WinScene,
  LoseScene
];

export const config = {
  type: Phaser.AUTO,
  parent: "game-container",
  pixelArt: true,
  zoom: 3,
  backgroundColor: "#000000",
  scene: SCENES,
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
      gravity: {
        x: 0,
        y: 0
      }
    }
  },
  scale: {
    parent: "game-container",
    mode: Phaser.Scale.FIT,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  }
};
