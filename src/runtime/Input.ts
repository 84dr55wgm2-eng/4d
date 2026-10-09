/** Keyboard state shared by runtime systems (ignored while typing in UI fields). */
export class Input {
  private down = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  pressed(code: string) {
    return this.down.has(code);
  }

  axis(neg: string[], pos: string[]) {
    return (pos.some((c) => this.down.has(c)) ? 1 : 0) - (neg.some((c) => this.down.has(c)) ? 1 : 0);
  }

  /** Programmatic input (automation / tests drive the same path as a keyboard). */
  set(code: string, on: boolean) {
    if (on) this.down.add(code);
    else this.down.delete(code);
  }
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
