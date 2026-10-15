/** Speed over a sliding ~3s window. */
export class Meter {
  private samples: Array<[number, number]> = [];
  startBytes: number | undefined;

  push(bytes: number, now = Date.now()): number | undefined {
    this.startBytes ??= bytes;
    this.samples.push([now, bytes]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 3000) this.samples.shift();
    if (this.samples.length < 2) return undefined;
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = (b[0] - a[0]) / 1000;
    return dt > 0 ? (b[1] - a[1]) / dt : undefined;
  }
}
