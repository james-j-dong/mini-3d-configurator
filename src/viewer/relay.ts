// Forwards messages to a primary target (the render worker) while remembering them, so they can be
// replayed in order to a fallback (a main-thread engine) if the primary turns out unable to render.

type Send<T> = (message: T) => void;

export class FallbackRelay<T> {
  private target: Send<T>;
  private phase: 'trying' | 'confirmed' | 'switching' | 'switched' = 'trying';
  private log: T[] = [];

  constructor(primary: Send<T>) {
    this.target = primary;
  }

  send(message: T): void {
    if (this.phase === 'trying') {
      this.log.push(message);
      this.target(message);
    } else if (this.phase === 'switching') {
      this.log.push(message); // the fallback isn't running yet: hold it
    } else {
      this.target(message);
    }
  }

  /** The primary rendered: stop recording. */
  confirmPrimary(): void {
    if (this.phase !== 'trying') return;
    this.phase = 'confirmed';
    this.log = [];
  }

  /** Stops sending to the primary, then replays everything (including messages sent meanwhile) to the fallback. */
  async switchTo(fallback: Promise<Send<T>>): Promise<void> {
    if (this.phase !== 'trying') return;
    this.phase = 'switching';
    const send: Send<T> = await fallback;
    for (const message of this.log) send(message);
    this.log = [];
    this.target = send;
    this.phase = 'switched';
  }

  /** Messages held for a possible replay. */
  get recorded(): number {
    return this.log.length;
  }
}
