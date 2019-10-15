/** A thunk that is invoked with no arguments to remove a listener registration. */
export type Remover = () => void

/** General no-op function. */
export const Noop = () => {}

/** A no-op remover thunk. This is useful when doing manual plumbing to avoid having to maintain a
  * potentially undefined remover thunk. */
export const NoopRemover :Remover = Noop

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

  /** Creates a timestamp with the current time. */
  static now () { return new Timestamp(Date.now()) }

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
}
// TODO: support some sentinel value that means "use a server timestamp when we decode"

// TODO: support setting an offset from client local time then have the data subsystem calibrarte
// this client's clock with the server clock so that timestamps created on the client are more
// accurate

// TODO: replace JSON.stringify with dataToString
// TODO: allow log filtering (>= level), capture & rerouting

export type Level = "debug" | "info" | "warn" | "error"

function hasToString (obj :any) {
  return typeof obj === "object" &&
    Object.getPrototypeOf(obj).toString !== Object.prototype.toString
}

export function formatArgs (...args :any[]) :string {
  let str = ""
  for (let ii = 0, ll = args.length - (args.length%2); ii < ll; ii += 2) {
    if (str.length > 0) str += ", "
    const val = args[ii+1]
    try {
      if (hasToString(val)) str += `${args[ii]}=${val}`
      else str += `${args[ii]}=${JSON.stringify(val)}`
    } catch (err) {
      str += `${args[ii]}=${val}`
    }
  }
  return str
}

export function logAt (level :Level, msg :string, ...args :any[]) {
  let logfn = console.log
  switch (level) {
  case "error": logfn = console.error ; break
  case "warn": logfn = console.warn ; break
  case "info": logfn = console.info ; break
  }
  const fargs = formatArgs(...args)
  logfn(fargs.length > 0 ? `${msg} [${fargs}]` : msg)
  if (args.length % 2 === 1) logfn(args[args.length-1])
}

export const log = {
  format: (msg :string, ...args :any[]) => `${msg} [${formatArgs(...args)}]`,
  debug: (msg :string, ...args :any[]) => logAt("debug", msg, ...args),
  info : (msg :string, ...args :any[]) => logAt("info" , msg, ...args),
  warn : (msg :string, ...args :any[]) => logAt("warn" , msg, ...args),
  error: (msg :string, ...args :any[]) => logAt("error", msg, ...args),
}

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
  // round numbers to six digits after decimal
  if (typeof value === "number") return String(Math.round(value * 1000000) / 1000000)
  const string = String(value)
  return string.length > maxLength ? string.substring(0, maxLength - 3) + "..." : string
}

/** Type for easing functions. */
export type EaseFn = (proportion :number) => number

/** An easing function that simply returns the proportion unchanged. */
export function easeLinear (proportion :number) {
  return proportion
}

/** An easing function that starts at zero velocity and accelerates, stopping suddenly. */
export function easeIn (proportion :number) {
  return proportion * proportion
}

/** An easing function that starts with a velocity and decelerates to a stop. */
export function easeOut (proportion :number) {
  return proportion * (2 - proportion)
}

/** An easing function that starts at zero velocity, accelerates until the midpoint, then
  * decelerates to a stop at the end. */
export function easeInAndOut (proportion :number) {
  return proportion * proportion * (3 - 2 * proportion)
}
