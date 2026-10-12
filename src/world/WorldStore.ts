import { Emitter } from '../core/emitter';
import type { Entity, WorldDocument } from '../core/types';

/**
 * Owns the serializable WorldDocument. Every mutation goes through `commit`, which records
 * a snapshot for undo/redo (documents are small: entities + shots, never geometry).
 */
type StoreEvents = {
  change: { doc: WorldDocument; label: string; source: 'commit' | 'undo' | 'redo' | 'load' | 'sequence' };
};

const clone = <T,>(v: T): T => structuredClone(v);

export class WorldStore extends Emitter<StoreEvents> {
  private _doc: WorldDocument;
  private undoStack: { label: string; doc: WorldDocument }[] = [];
  private redoStack: { label: string; doc: WorldDocument }[] = [];
  dirty = false;
  prepare?: (doc: WorldDocument) => void;
  onReject?: (message: string) => void;

  constructor(doc: WorldDocument) {
    super();
    this._doc = clone(doc);
  }

  get doc(): Readonly<WorldDocument> {
    return this._doc;
  }

  entity(id: string): Entity | undefined {
    return this._doc.entities.find((e) => e.id === id);
  }

  load(doc: WorldDocument) {
    this._doc = clone(doc);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('change', { doc: this._doc, label: 'load', source: 'load' });
  }

  /** Apply a mutation as one undoable step. Returns false if the mutation threw / was rejected. */
  commit(label: string, mutate: (doc: WorldDocument) => void | false): boolean {
    const before = clone(this._doc);
    const draft = clone(this._doc);
    try {
      if (mutate(draft) === false) return false;
      this.prepare?.(draft);
    } catch (e) {
      this.onReject?.(e instanceof Error ? e.message : String(e));
      return false;
    }
    this.undoStack.push({ label, doc: before });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this._doc = draft;
    this.dirty = true;
    this.emit('change', { doc: this._doc, label, source: 'commit' });
    return true;
  }

  /** Runtime state restore (sequence playback): changes the document without an undo step. */
  applySilently(label: string, mutate: (doc: WorldDocument) => void) {
    const draft = clone(this._doc);
    mutate(draft);
    this._doc = draft;
    this.dirty = true;
    this.emit('change', { doc: this._doc, label, source: 'sequence' });
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label; }
  get redoLabel() { return this.redoStack.at(-1)?.label; }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push({ label: step.label, doc: clone(this._doc) });
    this._doc = step.doc;
    this.dirty = true;
    this.emit('change', { doc: this._doc, label: step.label, source: 'undo' });
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push({ label: step.label, doc: clone(this._doc) });
    this._doc = step.doc;
    this.dirty = true;
    this.emit('change', { doc: this._doc, label: step.label, source: 'redo' });
  }

  snapshot(): WorldDocument {
    return clone(this._doc);
  }
}
