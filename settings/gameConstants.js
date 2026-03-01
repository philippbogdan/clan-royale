export const GAME_WIDTH = 160;
export const GAME_HEIGHT = 265;

export const GRID_COLS = 10;
export const GRID_ROWS = 6;
export const GRID_COL_WIDTH = 16;
export const GRID_ROW_HEIGHT = 15;
export const GRID_ORIGIN_Y = 115;

export const GRID_CENTER_OFFSET_X = 8;
export const GRID_CENTER_OFFSET_Y = 7.5;

export const MID_X = GAME_WIDTH / 2;

export const LEFT_DEPLOY_X = 40;
export const RIGHT_DEPLOY_X = 120;
export const DEFAULT_DEPLOY_Y = 180;

export const PLAYER_GRID = {
  cols: GRID_COLS,
  rows: GRID_ROWS,
  bridges: [
    { col: 1, side: "left" },
    { col: 8, side: "right" }
  ],
  note: "row 0 = river/bridges (aggressive), row 5 = near your towers (defensive). Left bridge col 1-2, right bridge col 7-8."
};
