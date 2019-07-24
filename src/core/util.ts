/** A thunk that is invoked with no arguments to remove a listener registration. */
export type Remover = () => void

/** A no-op remover thunk. This is useful when doing manual plumbing to avoid having to maintain a
  * potentially undefined remover thunk. */
export const NoopRemover :Remover = () => {}

/** An interface for things that maintain external resources and should be disposed when no longer
  * needed. */
export interface Disposable {

  /** Disposes the resources used by this instance. */
  dispose () :void
}

/** Abstracts over [[Disposable]] and [[Remover]] functions. */
export type ToDispose = Remover | Disposable

/** Eases the process of creating a list of disposables, adding to it and then disposing everything
  * on it in the reverse order in which it was added. */
export class Disposer implements Disposable {
  private list :ToDispose[] = []

  /** Adds `disp` to be disposed. */
  add<D extends ToDispose> (disp :D) :D {
    this.list.unshift(disp)
    return disp
  }

  /** Removes `disp` from this disposer. Does not dispose `disp`. */
  remove (disp :ToDispose) {
    const idx = this.list.indexOf(disp)
    if (idx >= 0) this.list.splice(idx, 1)
  }

  /** Disposes everything in this disposer and clears it out. */
  dispose () {
    for (const d of this.list) {
      if (typeof d === "function") d()
      else d.dispose()
    }
    this.list.length = 0
  }
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
    const nbits = new Uint32Array(Math.max(bits.length*2, idx+1))
    nbits.set(bits)
    this.bits = nbits
    return nbits
  }
}
