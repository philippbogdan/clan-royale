export default class TextOverlay {
  constructor(game) {
    this.game = game;
    this._nextId = 0;
    this._elements = new Map();

    // Create overlay div
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden;z-index:10;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;';
    document.body.appendChild(this.overlay);

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

  destroy() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this._elements.clear();
    window.removeEventListener('resize', this._onResize);
    window.__textOverlay = null;
  }
}
