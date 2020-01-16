/** A thunk that is invoked with no arguments to remove a listener registration. */
export type Remover = () => void

/** General no-op function. */
export const Noop = () => {}

/** A no-op remover thunk. This is useful when doing manual plumbing to avoid having to maintain a
  * potentially undefined remover thunk. */
export const NoopRemover :Remover = Noop

/** Removes `listener` from `listeners`. */
export function removeListener<T> (listeners :T[], listener :T) {
  let ii = listeners.indexOf(listener)
  if (ii >= 0) listeners.splice(ii, 1)
}

/** Adds `listener` to `listeners`.
  * @return a `Remover` thunk that can be used to remove `listener` from `listeners`. */
export function addListener<T> (listeners :T[], listener :T) :Remover {
  listeners.push(listener)
  return () => removeListener(listeners, listener)
}

// NOTE: WebPack magically rewrites process.env.NODE_ENV for us; when we stop using WebPack we
// should provide some other way to find out if we're in development or production mode
export const developMode = process.env.NODE_ENV === "development"

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
    // minor optimization: no need to add noop remover; we know it does nothing
    if (disp !== NoopRemover) this.list.unshift(disp)
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

/** An object used as a "property map", where all properties have the same type. */
export type PMap<T> = {[key :string] :T}

/** An interface for readable properties. */
export interface RProp<T> {
  current :T
}

/** An interface for readable and updatable properties. */
export interface Prop<T> extends RProp<T> {
  update (v :T) :void
}

/** An interface for readable "vector" properties. These properties are usually views into an array
  * of bulk data, and are thus read into a temporary array provided by the caller. */
export interface RVProp<T> extends RProp<T> {
  read (into :T) :T
}

/** An interface for readable and updatable "vector" properties. */
export interface VProp<T> extends Prop<T>, RVProp<T> {}

/**
 * Provides compile-time validation of type-exhaustion, plus a runtime error.
 * @see unreachableCase */
export class UnreachableCaseError extends Error {
  constructor (val :never) {
    super(`Unreachable case: ${val}`)
  }
}

/**
 * Provides compile-time validation of type-exhaustion, plus a fallback value at runtime.
 * Usage:<pre>
 * switch (someEnum) {
 * case SomeEnum.FOO: return "Foo"
 * default: return unreachableCase(someEnum, "Untranslated")
 * }</pre>
 */
export function unreachableCase<T> (impossible :never, value :T) :T {
  return value
}

/** Maintains a set of positive integers using bits in a backing (typed array) vector. */
export class BitSet {
  private bits :Uint32Array

  /** Creates a bit set with the specified initial capacity. */
  constructor (initCapacity = 256) {
    this.bits = new Uint32Array(initCapacity/32)
  }

  /** Adds `value` to this set.
    * @return `true` if `value` was added, `false` if `value` was already in the set. */
  add (value :number) :boolean {
    if (value < 0) throw new Error(`Negative integers not allowed in bit set.`)
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
      const word = bits[bb], bpos = bb*32
      for (let mm = 0, vv = bb*32; mm < 32; mm += 1, vv += 1) {
        const mask = 1 << mm
        if ((word & mask) !== 0) fn(bpos+mm)
      }
    }
  }

  /** Returns the first value (in ascending order) for which `pred` returns true, or `-1` if no
    * value matched the predicate. */
  find (pred :(v :number) => boolean) :number {
    const bits = this.bits
    for (let bb = 0; bb < bits.length; bb += 1) {
      const word = bits[bb]
      for (let mm = 0, vv = bb*32; mm < 32; mm += 1, vv += 1) {
        const mask = 1 << mm
        if ((word & mask) !== 0 && pred(vv)) return vv
      }
    }
    return -1
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

type Interval = {millisPer :number}

/** Represents an instant in time. */
export class Timestamp {

  static readonly MILLIS  = {millisPer: 1}
  static readonly SECONDS = {millisPer: 1000}
  static readonly MINUTES = {millisPer: 60*1000}
  static readonly HOURS   = {millisPer: 60*60*1000}
  static readonly DAYS    = {millisPer: 24*60*60*1000}

  /** A sentinel value for time zero (zero millis from the epoch). */
  static zero = new Timestamp(0)

  /** Creates a timestamp with the current time. */
  static now () { return new Timestamp(Date.now()) }

  /** Returns `-1` if `a < b`, `1` if `a > b` and `0` if they are equal. */
  static compare (a :Timestamp, b :Timestamp) :number {
    return a.millis < b.millis ? -1 : a.millis > b.millis ? 1 : 0
  }

  // TODO: should we use seconds + nanos like Firebase?
  constructor (readonly millis :number) {}

  /** Returns a new timestamp which is `count` `interval`s later than `this`. */
  plus (count :number, interval :Interval) :Timestamp {
    return new Timestamp(this.millis + interval.millisPer * count)
  }

  /** Returns a new timestamp which is `count` `interval`s earlier than `this`. */
  minus (count :number, interval :Interval) :Timestamp {
    return new Timestamp(this.millis + interval.millisPer * count)
  }

  toDate () :Date { return new Date(this.millis) }
  toString () { return this.toDate().toLocaleString() }
}

// TODO: support some sentinel value that means "use a server timestamp when we decode"

// TODO: support setting an offset from client local time then have the data subsystem calibrarte
// this client's clock with the server clock so that timestamps created on the client are more
// accurate

// TODO: replace JSON.stringify with dataToString
// TODO: allow log filtering (>= level), capture & rerouting

export type Level = "debug" | "info" | "warn" | "error"

export class Logger {

  constructor (readonly maxDecimals? :number) {}

  formatArg (val :any) :string {
    try {
      const vtype = typeof val
      switch (vtype) {
      case "undefined": return "<undef>"
      case "string": return val
      case "number":
        const maxDecimals = this.maxDecimals
        if (maxDecimals === undefined) return String(val)
        else return val.toLocaleString(undefined, {maximumFractionDigits: maxDecimals})
      case "object":
        if (Array.isArray(val)) {
          let str = ""
          for (let ii = 0, ll = val.length; ii < ll; ii += 1) {
            if (ii > 0) str += ","
            str += this.formatArg(val[ii])
          }
          return str
        }
        else if (Object.getPrototypeOf(val).toString !== Object.prototype.toString) return String(val)
        else return JSON.stringify(val)
      default: return val.toString()
      }
    } catch (err) {
      return String(val)
    }
  }

  formatArgs (...args :any[]) :string {
    let str = ""
    for (let ii = 0, ll = args.length - (args.length%2); ii < ll; ii += 2) {
      if (str.length > 0) str += ", "
      str += `${args[ii]}=${this.formatArg(args[ii+1])}`
    }
    return str
  }

  logAt (level :Level, msg :string, ...args :any[]) {
    let logfn = console.log
    switch (level) {
    case "error": logfn = console.error ; break
    case "warn": logfn = console.warn ; break
    case "info": logfn = console.info ; break
    }
    const fargs = this.formatArgs(...args)
    logfn(fargs.length > 0 ? `${msg} [${fargs}]` : msg)
    if (args.length % 2 === 1) logfn(args[args.length-1])
  }

  format (msg :string, ...args :any[]) { return `${msg} [${this.formatArgs(...args)}]` }
  debug (msg :string, ...args :any[]) { this.logAt("debug", msg, ...args) }
  info (msg :string, ...args :any[]) { this.logAt("info" , msg, ...args) }
  warn (msg :string, ...args :any[]) { this.logAt("warn" , msg, ...args) }
  error (msg :string, ...args :any[]) { this.logAt("error", msg, ...args) }

}

export const log = new Logger()

/** Returns the provided value or, if undefined, the provided default. */
export function getValue<T> (value :T|undefined, defaultValue :T) :T {
  return value === undefined ? defaultValue : value
}

/** Returns an iterable that filters another iterable according to a predicate.
  * Elements which _pass_ the predicate will be returned by the iterators. */
export function filteredIterable<E> (iter :Iterable<E>, pred :(elem :E) => boolean) :Iterable<E> {
  return {
    [Symbol.iterator]: () => filteredIterator(iter[Symbol.iterator](), pred),
  }
}

/** Returns an iterator that filters another iterator according to a predicate.
  * Elements which _pass_ the predicate will be returned by the iterator. */
export function filteredIterator<E> (iter :Iterator<E>, pred :(elem :E) => boolean) :Iterator<E> {
  return {
    next: () => {
      let next = iter.next()
      while (!(next.done || pred(next.value))) next = iter.next()
      return next
    },
  }
}

/** Converts the supplied value to a string of limited length. */
export function toLimitedString (value :any, maxLength = 30) {
  if (typeof value === "number") return toFloat32String(value)
  const string = String(value)
  return string.length > maxLength ? string.substring(0, maxLength - 3) + "..." : string
}

/** Converts a number to a string with roughly the precision of a single precision float. */
export function toFloat32String (value :number) :string {
  // round numbers to six digits after decimal
  return String(Math.round(value * 1000000) / 1000000)
}

/** Returns the position at which `elem` should be inserted into `elems` to preserve the least to
  * greatest ordering of the array. Elements are compared using `cmp` which must return `<0`, `0` or
  * `>0` per the normal JavaScript array sort contract. */
export function insertPos<E> (elems :E[], elem :E, cmp :(a:E, b:E) => number) :number {
  let low = 0, high = elems.length
  while (low < high) {
    const mid = (low + high) >>> 1, cv = cmp(elem, elems[mid])
    if (cv < 0) high = mid
    else low = mid+1
  }
  return low
}

/** Splices `elem` into `elems` at an index that preserves the least to greatest ordering of the
  * array. Elements are compared using `cmp` which must return `<0`, `0` or `>0` per the normal
  * JavaScript array sort contract.
  * @return the index at which `elem` was inserted. */
export function insertSorted<E> (elems :E[], elem :E, cmp :(a:E, b:E) => number) :number {
  const pos = insertPos(elems, elem, cmp)
  elems.splice(pos, 0, elem)
  return pos
}
