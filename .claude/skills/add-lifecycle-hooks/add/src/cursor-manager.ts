/**
 * Manages per-group message cursors (timestamps that track which messages
 * have been processed). Supports save/rollback for crash recovery.
 */
export class CursorManager {
  private cursors: Record<string, string> = {};
  private savedCursors: Record<string, string> = {};

  advance(chatJid: string, timestamp: string): void {
    this.cursors[chatJid] = timestamp;
  }

  save(chatJid: string): void {
    this.savedCursors[chatJid] = this.cursors[chatJid] || '';
  }

  rollback(chatJid: string): void {
    if (chatJid in this.savedCursors) {
      this.cursors[chatJid] = this.savedCursors[chatJid];
      delete this.savedCursors[chatJid];
    }
  }

  clearSaved(chatJid: string): void {
    delete this.savedCursors[chatJid];
  }

  hasSaved(chatJid: string): boolean {
    return chatJid in this.savedCursors;
  }

  get(chatJid: string): string {
    return this.cursors[chatJid] || '';
  }

  getAll(): Record<string, string> {
    return { ...this.cursors };
  }

  getSavedAll(): Record<string, string> {
    return { ...this.savedCursors };
  }

  loadAll(cursors: Record<string, string>): void {
    this.cursors = { ...cursors };
  }

  loadSavedAll(saved: Record<string, string>): void {
    this.savedCursors = { ...saved };
  }
}
