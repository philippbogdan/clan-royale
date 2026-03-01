import Phaser from "phaser";
import { config } from "./settings/config.js";
import TextOverlay from "./classes/ui/TextOverlay.js";

window.startGame = function() {
  try {
    const game = new Phaser.Game(config);
    game.events.on('ready', () => {
      new TextOverlay(game);
    });
  } catch(e) { console.error(e); }
};
