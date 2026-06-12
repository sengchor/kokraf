export class SlotAllocator {
  constructor(capacity) {
    this.capacity = capacity;
    this.usedCount = 0;
    this.freeBlocks = [{ start: 0, count: capacity }];
  }

  alloc(n) {
    for (let i = 0; i < this.freeBlocks.length; i++) {
      const block = this.freeBlocks[i];
      if (block.count >= n) {
        const start = block.start;
        block.start += n;
        block.count -= n;
        if (block.count === 0) this.freeBlocks.splice(i, 1);
        this.usedCount += n;
        return start;
      }
    }
    return -1;
  }

  free(start, n) {
    this.usedCount -= n;
    this.freeBlocks.push({ start, count: n });
    this._mergeBlocks();
  }

  _mergeBlocks() {
    this.freeBlocks.sort((a, b) => a.start - b.start);
    for (let i = 0; i < this.freeBlocks.length - 1;) {
      const a = this.freeBlocks[i], b = this.freeBlocks[i + 1];
      if (a.start + a.count === b.start) {
        a.count += b.count;
        this.freeBlocks.splice(i + 1, 1);
      } else i++;
    }
  }

  get utilization() { return this.usedCount / this.capacity; }
}