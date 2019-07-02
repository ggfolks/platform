
/** An interface for things that maintain external resources and should be disposed when no longer
  * needed. */
export interface Disposable {

  /** Disposes the resources used by this instance. */
  dispose () :void
}

/** Maintains a set of integers using bits in a backing (typed array) vector. */
export class BitSet {
  private bits :Uint32Array

  /** Creates a bit set with the specified initial capacity. */
  constructor (initCapacity = 256) {
    this.bits = new Uint32Array(initCapacity/32)
  }

  /** Adds `value` to this set.
    * @return `true` if `value` was added, `false` if `value` was already in the set. */
  add (value :number) :boolean {
    const idx = value >> 5, mask = 1 << (value & 0x1F)
    const bits = this.resize(idx)
    const word = bits[idx]
    if ((word & mask) !== 0) return false
    bits[idx] = word | mask
    return true
  }

  /** Removes all values from this set. */
  clear () {
    const bits = this.bits
    for (let bb = 0; bb < bits.length; bb += 1) bits[bb] = 0
    // TODO: shrink?
  }

  /** Removes `value` from this set.
    * @return `true` if `value` was removed from the set, `false` if `value` was not in the set. */
  delete (value :number) :boolean {
    const idx = value >> 5, mask = 1 << (value & 0x1F), bits = this.bits
    if (idx >= bits.length) return false
    const word = bits[idx]
    if ((word & mask) === 0) return false
    bits[idx] = word & ~mask
    // TODO: shrink?
    return true
  }

  /** Returns whether `value` is in this set. */
  has (value :number) :boolean {
    const idx = value >> 5, mask = 1 << (value & 0x1F), bits = this.bits
    return idx < bits.length ? ((bits[idx] & mask) !== 0) : false
  }

  /** Applies `fn` to every value in this set (in ascending order). */
  forEach (fn :(v :number) => any) {
    const bits = this.bits
    for (let bb = 0; bb < bits.length; bb += 1) {
      const word = bits[bb]
      for (let mm = 0; mm < 32; mm += 1) {
        const mask = 1 << mm
        if ((word & mask) !== 0) fn(bb*32+mm)
      }
    }
  }

  private resize (idx :number) :Uint32Array {
    const bits = this.bits
    if (bits.length > idx) return bits
    const nbits = new Uint32Array(bits.length*2)
    nbits.set(bits)
    this.bits = nbits
    return nbits
  }
}
