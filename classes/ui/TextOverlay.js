export default class TextOverlay {
  constructor(game) {
    this.game = game;
    this._nextId = 0;
    this._elements = new Map();

    // Create overlay div
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden;z-index:10;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;';
    document.body.appendChild(this.overlay);

    // Mascot layer (z-index 20, above text overlay at 10)
    this.mascotContainer = document.createElement('div');
    this.mascotContainer.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden;z-index:20;';
    document.body.appendChild(this.mascotContainer);

    this.mascotImg = document.createElement('img');
    this.mascotImg.style.cssText = 'position:absolute;display:none;image-rendering:pixelated;';
    this.mascotContainer.appendChild(this.mascotImg);

    this._mascotClosedSrc = null;
    this._mascotOpenSrc = null;
    this._mascotVisible = false;
    this._mascotMouthOpen = false;
    // Mascot game coords: x=130 (center), y=4 (top), ~40px game width
    this._mascotGameX = 130;
    this._mascotGameY = 4;
    this._mascotGameW = 40;
    this._mascotGameH = 40;

    this._syncRect();

    this._onResize = () => this._syncRect();
    window.addEventListener('resize', this._onResize);

    window.__textOverlay = this;
  }

  _syncRect() {
    if (!this.game || !this.game.canvas) return;
    const r = this.game.canvas.getBoundingClientRect();
    this._rect = r;
    this.overlay.style.left = r.left + 'px';
    this.overlay.style.top = r.top + 'px';
    this.overlay.style.width = r.width + 'px';
    this.overlay.style.height = r.height + 'px';
    // Sync mascot container
    this.mascotContainer.style.left = r.left + 'px';
    this.mascotContainer.style.top = r.top + 'px';
    this.mascotContainer.style.width = r.width + 'px';
    this.mascotContainer.style.height = r.height + 'px';
  }

  add(gameX, gameY, text, opts = {}) {
    const id = this._nextId++;
    const el = document.createElement('div');
    const fontSize = opts.fontSize || 7;
    const color = opts.color || '#ffffff';
    const fontWeight = opts.fontWeight || 'normal';
    const alpha = opts.alpha !== undefined ? opts.alpha : 1;
    const fontFamily = opts.fontFamily || 'Arial, Helvetica, sans-serif';
    const stroke = opts.stroke || null;

    el.style.cssText = 'position:absolute;white-space:nowrap;transform:translate(-50%,-50%);line-height:1;';
    el.style.fontFamily = fontFamily;
    el.style.fontWeight = fontWeight;
    el.style.color = color;
    el.style.opacity = alpha;

    if (stroke) {
      el.style.textShadow = `-1px -1px 0 ${stroke}, 1px -1px 0 ${stroke}, -1px 1px 0 ${stroke}, 1px 1px 0 ${stroke}`;
    }

    el.textContent = text;
    this.overlay.appendChild(el);

    const entry = { el, gameX, gameY, fontSize, color, stroke, fontWeight, alpha, fontFamily };
    this._elements.set(id, entry);

    // Position immediately
    this._updateElement(id, entry);

    return id;
  }

  setText(id, text) {
    const entry = this._elements.get(id);
    if (entry) entry.el.textContent = text;
  }

  setPosition(id, x, y) {
    const entry = this._elements.get(id);
    if (entry) {
      entry.gameX = x;
      entry.gameY = y;
    }
  }

  setAlpha(id, alpha) {
    const entry = this._elements.get(id);
    if (entry) {
      entry.alpha = alpha;
      entry.el.style.opacity = alpha;
    }
  }

  setColor(id, color) {
    const entry = this._elements.get(id);
    if (entry) {
      entry.color = color;
      entry.el.style.color = color;
    }
  }

  setVisible(id, bool) {
    const entry = this._elements.get(id);
    if (entry) {
      entry.el.style.display = bool ? '' : 'none';
    }
  }

  setDimmed(dimmed) {
    this.overlay.style.opacity = dimmed ? '0.45' : '1';
  }

  remove(id) {
    const entry = this._elements.get(id);
    if (entry) {
      entry.el.remove();
      this._elements.delete(id);
    }
  }

  _updateElement(id, entry) {
    if (!this._rect) return;
    const r = this._rect;
    const leftPct = (entry.gameX / 160) * 100;
    const topPct = (entry.gameY / 265) * 100;
    entry.el.style.left = leftPct + '%';
    entry.el.style.top = topPct + '%';
    entry.el.style.fontSize = (entry.fontSize / 265) * r.height + 'px';
  }

  update() {
    this._syncRect();
    for (const [id, entry] of this._elements) {
      this._updateElement(id, entry);
    }
    this._updateMascot();
  }

  addFloating(gameX, gameY, text, opts = {}) {
    if (!this._rect) this._syncRect();
    if (!this._rect) return;

    const r = this._rect;
    const el = document.createElement('div');
    const fontSize = opts.fontSize || 8;
    const color = opts.color || '#ff4444';
    const fontWeight = opts.fontWeight || 'bold';
    const fontFamily = opts.fontFamily || 'Arial, Helvetica, sans-serif';
    const stroke = opts.stroke || '#000000';

    const screenFontSize = (fontSize / 265) * r.height;
    const leftPct = (gameX / 160) * 100;
    const topPct = (gameY / 265) * 100;

    el.style.cssText = 'position:absolute;white-space:nowrap;transform:translate(-50%,-50%);line-height:1;pointer-events:none;';
    el.style.fontFamily = fontFamily;
    el.style.fontWeight = fontWeight;
    el.style.color = color;
    el.style.fontSize = screenFontSize + 'px';
    el.style.left = leftPct + '%';
    el.style.top = topPct + '%';
    el.style.opacity = '1';
    el.style.transition = 'top 0.9s cubic-bezier(0.2,0.8,0.3,1), opacity 0.9s ease-out';

    if (stroke) {
      el.style.textShadow = `-1px -1px 0 ${stroke}, 1px -1px 0 ${stroke}, -1px 1px 0 ${stroke}, 1px 1px 0 ${stroke}`;
    }

    el.textContent = text;
    this.overlay.appendChild(el);

    // Trigger transition on next frame
    requestAnimationFrame(() => {
      const floatDist = (25 / 265) * 100;
      el.style.top = (topPct - floatDist) + '%';
      el.style.opacity = '0';
    });

    // Auto-remove after animation
    setTimeout(() => {
      el.remove();
    }, 900);
  }

  // --- Mascot DOM layer ---

  showMascot(closedSrc, openSrc) {
    this._mascotClosedSrc = closedSrc;
    this._mascotOpenSrc = openSrc;
    this._mascotVisible = true;
    this._mascotMouthOpen = false;
    this.mascotImg.src = closedSrc;
    this.mascotImg.style.display = 'block';
    this.mascotImg.style.opacity = '0.95';
    this._updateMascot();
  }

  hideMascot() {
    this._mascotVisible = false;
    this.mascotImg.style.display = 'none';
    this.mascotImg.style.opacity = '0';
  }

  setMascotOpacity(val) {
    this.mascotImg.style.opacity = String(val);
  }

  setMascotMouth(isOpen) {
    if (this._mascotMouthOpen === isOpen) return;
    this._mascotMouthOpen = isOpen;
    if (isOpen && this._mascotOpenSrc) {
      this.mascotImg.src = this._mascotOpenSrc;
    } else if (this._mascotClosedSrc) {
      this.mascotImg.src = this._mascotClosedSrc;
    }
  }

  _updateMascot() {
    if (!this._rect || !this._mascotVisible) return;
    const r = this._rect;
    // Position mascot using percentage-based coords like text elements
    // mascotGameX is center, so offset left by half width
    const leftPct = ((this._mascotGameX - this._mascotGameW / 2) / 160) * 100;
    const topPct = (this._mascotGameY / 265) * 100;
    const widthPct = (this._mascotGameW / 160) * 100;
    this.mascotImg.style.left = leftPct + '%';
    this.mascotImg.style.top = topPct + '%';
    this.mascotImg.style.width = widthPct + '%';
    this.mascotImg.style.height = 'auto';
  }

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    if (this.mascotContainer && this.mascotContainer.parentNode) {
      this.mascotContainer.parentNode.removeChild(this.mascotContainer);
    }
    this._elements.clear();
    window.removeEventListener('resize', this._onResize);
    window.__textOverlay = null;
  }
}
