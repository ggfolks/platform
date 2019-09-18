import {Remover, NoopRemover} from "./util"
import {Data, dataEquals, refEquals} from "./data"
import {Eq, Mutable, Remove, Source, Subject,
        Value, ValueFn, dispatchValue, addListener} from "./react"

//
// Reactive lists

/** A read-only view of an ordered list of elements. */
export interface ReadonlyList<E> extends Iterable<E> {
  /** The length of the list. */
  length :number
  /** Returns the element at `index` or `undefined` if index is out-of-bounds. Beware that this
    * potential `undefined` return value is not reflected in the return type. Similar to arrays, we
    * assume you're operating in bounds. */
  elemAt (index :number) :E
  /** Applies `fn` to each element of this list, in order. */
  forEach (fn :(e:E) => void) :void
  /** Returns an iterator over this list's elements. */
  [Symbol.iterator] () :IterableIterator<E>
}

/** Reports a change to an [[RList]]. */
export type ListChange<E> =
  {type :"added",   index :number, elem :E} |
  {type :"updated", index :number, elem :E, prev :E} |
  {type :"deleted", index :number, prev :E}

/** A reactive list: emits change events when elements are added, updated or deleted. A client can
  * choose to observe fine-grained list changes (via [[onChange]]) or treat the list as a
  * `Source` and simply reprocess the entire list any time it changes. */
export abstract class RList<E> extends Source<ReadonlyList<E>> implements ReadonlyList<E> {
  protected abstract get elems () :E[]

  // from ReadonlyList
  get length () :number { return this.elems.length }
  elemAt (index :number) :E { return this.elems[index] }
  forEach (fn :(e:E) => void) { this.elems.forEach(fn) }
  [Symbol.iterator] () :IterableIterator<E> { return this.elems.values() }

  /** Returns a copy of a slice of this list as a plain array.
    * @param start the start index of the slice, defaults to `0`.
    * @param length the length of the slice, defaults to all elements after `start`. */
  slice (start? :number, length? :number) :E[] { return this.elems.slice(start, length) }

  /** Maps the elements of this list (into an array) via `fn`.
    * @return a plain array containing the mapped elements. */
  mapArray<F> (fn :(e:E) => F) :F[] { return this.elems.map(fn) }

  // /** Maps this list to a new reactive list via `fn`. The structure of the mapped list will mirror
  //   * `this` list but the elements will be transformed via `fn`. Equality of the mapped list
  //   * elements will be computed via `eq` which defaults to [[refEquals]]. */
  // mapElems<F> (fn :(e:E) => F, eq :Eq<F> = refEquals) :RList<F> { throw new Error("TODO") }

  // /** Maps this list to a new reactive list via `fn`. The structure of the mapped list will mirror
  //   * `this` list but the elements will be transformed via `fn`. Equality of the mapped list
  //   * elements will be computed via [[dataEquals]]. */
  // mapDataElems<F extends Data> (fn :(e:E) => F) :RList<F> {
  //   return this.mapElems<F>(fn, dataEquals)
  // }

  /** Registers `fn` to be notified of changes to this list.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onChange (fn :ValueFn<ListChange<E>>) :Remover

  // from Source
  onEmit (fn :ValueFn<ReadonlyList<E>>) :Remover {
    return this.onChange(change => fn(this))
  }
  onValue (fn :ValueFn<ReadonlyList<E>>) :Remover {
    const remover = this.onEmit(fn)
    fn(this)
    return remover
  }
  map<U> (fn :(l:ReadonlyList<E>) => U) :Source<U> {
    return new Subject((lner, want) => {
      if (want && lner(fn(this)) === Remove) return NoopRemover
      return this.onChange(change => lner(fn(this)))
    })
  }
}

/** A mutable [[RList]] which provides an API for adding, updating and deleting elements. */
export abstract class MutableList<E> extends RList<E> {
  private _listeners :ValueFn<ListChange<E>>[] = []

  /** Creates a local mutable list. Elements will be compared for equality using `eq`, which
    * defaults to [[refEquals]]. */
  static local<E> (eq :Eq<E> = refEquals) :MutableList<E> { return new LocalMutableList<E>(eq) }

  /** Creates a local mutable list. Elements will be compared for equality using [[dataEquals]]. */
  static localData<E extends Data> () :MutableList<E> { return this.local<E>(dataEquals) }

  /** Used to compare successive values of list elements for equality. */
  abstract get eq () :Eq<E>

  /** Appends `elem` to this list, notifying observers of the change. */
  append (elem :E) { this.insert(elem, this.length) }

  /** Inserts `elem` into this list at `index`, notifying observers of the change. */
  abstract insert (elem :E, index :number) :void

  /** Replaces the element at `index` with `elem`, if it differs from the existing element at
    * `index` per [[eq]]. If so, an `updated` notification will be dispatched. */
  abstract update (index :number, elem :E) :void

  /** Deletes the element at `index`, notifying observers of the change. */
  abstract delete (index :number) :void

  /** Deletes all elements from this list, notifying observers of the changes. */
  clear () {
    // TODO: do we want bulk delete event?
    while (this.length > 0) this.delete(this.length-1)
  }

  onChange (fn :(change :ListChange<E>) => any) :Remover {
    return addListener(this._listeners, fn)
  }

  protected notifyInsert (index :number, elem :E) {
    dispatchValue(this._listeners, {type: "added", index, elem})
  }
  protected notifyUpdate (index :number, elem :E, prev :E) {
    dispatchValue(this._listeners, {type: "updated", index, elem, prev})
  }
  protected notifyDelete (index :number, prev :E) {
    dispatchValue(this._listeners, {type: "deleted", index, prev})
  }
}

class LocalMutableList<E> extends MutableList<E> {
  protected elems :E[] = []

  constructor (readonly eq :Eq<E>) { super() }

  /** Appends `elem` to this list, notifying observers of the change. */
  append (elem :E) {
    const elems = this.elems, index = elems.length
    elems.push(elem)
    this.notifyInsert(index, elem)
  }

  /** Inserts `elem` into this list at `index`, notifying observers of the change. */
  insert (elem :E, index :number) {
    const elems = this.elems
    elems.splice(index, 0, elem)
    this.notifyInsert(index, elem)
  }

  /** Replaces the element at `index` with `elem`, if it differs from the existing element at
    * `index` per [[eq]]. If so, an `updated` notification will be dispatched. */
  update (index :number, elem :E) {
    const elems = this.elems, prev = elems[index]
    if (!this.eq(elem, prev)) {
      elems[index]= elem
      this.notifyUpdate(index, elem, prev)
    }
  }

  /** Deletes the element at `index`, notifying observers of the change. */
  delete (index :number) {
    const elems = this.elems, prev = elems[index]
    elems.splice(index, 1)
    this.notifyDelete(index, prev)
  }
}

// TODO: these are just interface definitions for now, to sketch out the API

//
// Reactive sets

export type SetChange<E> = {type :"added", elem :E} | {type :"deleted", elem :E}

/** A reactive set: emits change events when entries are added or deleted. A client can choose to
  * observe fine-grained list changes (via [[onChange]]) or treat the set as a `Source` and simply
  * reprocess the entire set any time it changes. */
export abstract class RSet<E> extends Source<ReadonlySet<E>> implements ReadonlySet<E> {
  protected abstract get data () :ReadonlySet<E>

  /** The number of entries in this set. */
  get size () :number { return this.data.size }

  /** Returns whether `elem` is in this set. */
  has (elem :E) :boolean { return this.data.has(elem) }

  /** Returns an iterator over the entries (values) of this set, in insertion order. */
  values () { return this.data.values() }
  /** Applies `fn` to each entry in this set, in insertion order. */
  forEach (fn :(e:E, edup:E, s:ReadonlySet<E>) => void) { this.data.forEach(fn) }

  /** Returns an iterator over the entries of this set, in insertion order. This method only exists
    * to conform to the strange JavaScript set API. Use [[values]]. */
  keys () { return this.data.keys() }
  /** Returns an iterator over the entries ([E,E]) of this set, in insertion order. This method only
    * exists to conform to the strange JavaScript set API. Use [[values]]. */
  entries () { return this.data.entries() }

  /** Returns an iterator over the entries of this set, in insertion order. */
  [Symbol.iterator] () :IterableIterator<E> { return this.data[Symbol.iterator]() }

  /** Registers `fn` to be notified of changes to this set.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onChange (fn :(change :SetChange<E>) => any) :Remover

  // from Source
  onEmit (fn :ValueFn<ReadonlySet<E>>) :Remover {
    return this.onChange(change => fn(this.data))
  }
  onValue (fn :ValueFn<ReadonlySet<E>>) :Remover {
    const remover = this.onEmit(fn)
    fn(this.data)
    return remover
  }
  map<T> (fn :(m:ReadonlySet<E>) => T) :Source<T> {
    return new Subject((lner, want) => {
      if (want && lner(fn(this.data)) === Remove) return NoopRemover
      return this.onChange(_ => lner(fn(this.data)))
    })
  }
}

/** A mutable [[RSet]] which provides an API for added and deleting elements. */
export abstract class MutableSet<E> extends RSet<E> implements Set<E> {
  private _listeners :ValueFn<SetChange<E>>[] = []
  protected abstract get data () :Set<E>

  /** Creates a local mutable set. */
  static local<E> () :MutableSet<E> { return new LocalMutableSet() }

  /** Returns a [[Value]] that reflects whether `elem` is a member of this set. When its membership
    * changes, the value will emit a change. */
  hasValue (elem :E) :Value<boolean> {
    return Value.deriveValue(refEquals, disp => this.onChange(change => {
      if (change.elem === elem) {
        const has = change.type === "added"
        disp(has, !has)
      }
    }), () => this.has(elem))
  }

  /** Adds `elem` to this set. If it was not already a member of this set, listeners will be
    * notified of the addition. */
  abstract add (elem :E) :this

  /** Removes `elem` from this set. If it was a member of the set and was thus actually removed,
    * listeners will be notified of the deletion.
    * @return `true` if elem was in the set and was removed, `false` otherise. */
  abstract delete (elem :E) :boolean

  /** Removes all elements from this set, notifying listeners of any deletions. */
  clear () {
    // TODO: do we want a bulk delete event?
    for (const elem of this) this.delete(elem)
  }

  forEach (fn :(e:E, edup:E, s:Set<E>) => void) { this.data.forEach(fn) }

  onChange (fn :(change :SetChange<E>) => any) :Remover {
    return addListener(this._listeners, fn)
  }

  get [Symbol.toStringTag] () :string { return this.data[Symbol.toStringTag] }

  protected notifyAdd (elem :E) {
    dispatchValue(this._listeners, {type: "added", elem} as SetChange<E>)
  }
  protected notifyDelete (elem :E) {
    dispatchValue(this._listeners, {type: "deleted", elem} as SetChange<E>)
  }
}

class LocalMutableSet<E> extends MutableSet<E> {
  protected data = new Set<E>()

  add (elem :E) :this {
    const size = this.data.size
    this.data.add(elem)
    if (this.data.size !== size) this.notifyAdd(elem)
    return this
  }

  delete (elem :E) :boolean {
    const changed = this.data.delete(elem)
    if (changed) this.notifyDelete(elem)
    return changed
  }
}

//
// Reactive maps

/** Reports a change to an [[RMap]]. */
export type MapChange<K,V> =
  {type :"set", key :K, value :V, prev :V|undefined} |
  {type :"deleted", key :K, prev :V}

/** A reactive map: emits change events when entries are set or deleted. A client can choose to
  * observe fine-grained list changes (via [[onChange]]) or treat the map as a `Source` and simply
  * reprocess the entire map any time it changes. */
export abstract class RMap<K,V> extends Source<ReadonlyMap<K,V>> implements ReadonlyMap<K,V> {
  protected abstract get data () :ReadonlyMap<K,V>

  /** The number of entries in this map. */
  get size () :number { return this.data.size }

  /** Returns whether an entry exists for `key`. */
  has (key :K) :boolean { return this.data.has(key) }

  /** Returns the value associated with `key` or `undefined`. */
  get (key :K) :V|undefined { return this.data.get(key) }

  /** Returns the value associated with `key`.
    * @throws Error if no value is associated with `key`. */
  require (key :K) :V {
    const value = this.get(key)
    if (value !== undefined) return value
    throw new Error(`Missing required value for key '${key}'`)
  }

  // TODO: map &c

  /** Returns an iterator over the keys of this map, in insertion order. */
  keys () :IterableIterator<K> { return this.data.keys() }
  /** Returns an iterator over the values of this map, in insertion order. */
  values () :IterableIterator<V> { return this.data.values() }
  /** Returns an iterator over the entries (`[K,V]`) of this map, in insertion order. */
  entries () :IterableIterator<[K,V]> { return this.data.entries() }
  /** Applies `fn` to each entry in this map, in insertion order. */
  forEach (fn :(v:V, k:K, m:ReadonlyMap<K,V>) => void) { this.data.forEach(fn) }

  /** Returns an iterator over the entries (`[K,V]`) of this map, in insertion order. */
  [Symbol.iterator] () :IterableIterator<[K,V]> { return this.data[Symbol.iterator]() }

  get [Symbol.toStringTag] () :string { return this.data[Symbol.toStringTag] }

  /** Returns a [[Value]] that reflects the value of this map at `key`. When mapping changes, the
    * value will emit a change. While no mapping exists for key, the value will contain `undefined`.
    * @param eq the equality function to use to compare successive values. */
  getValue (key :K, eq :Eq<V|undefined> = refEquals) :Value<V|undefined> {
    return this.projectValue(key, v => v, eq)
  }

  /** Returns a [[Value]] that reflects a projection (via `fn)`) of the value of this map at `key`.
    * When mapping changes, `fn` will be applied to the new value to obtain the projected value, and
    * if it differs from the previously projected value, a change will be emitted. The projection
    * function will only ever be called with an actual value; while no mapping exists for key, the
    * value will contain `undefined`.
    * @param eq the equality function to use to compare successive projected values. */
  projectValue<W> (key :K, fn :(v:V) => W, eq :Eq<W|undefined> = refEquals) :Value<W|undefined> {
    return Value.deriveValue(eq, disp => this.onChange(change => {
      if (change.key === key) {
        const ovalue = change.prev === undefined ? undefined : fn(change.prev)
        const nvalue = change.type === "set" ? fn(change.value) : undefined
        if (!eq(ovalue, nvalue)) disp(nvalue, ovalue)
      }
    }), () => {
      const v = this.get(key)
      return v === undefined ? undefined : fn(v)
    })
  }

  /** Returns a reactive view of the keys of this map. The value will emit a change when mappings
    * are added or removed.
    *
    * Reactive views are not provided for [[values]] or [[entries]] because those change every time
    * anything in the map changes. Simply call `map(m => m.values())` for example. */
  keysValue () :Value<IterableIterator<K>> {
    return Value.deriveValue(keyIteratorsEqual, disp => {
      return this.onChange(c => {
        if (c.type === "deleted") disp(this.keys(), iteratorPlus(this.keys(), c.key))
        else if (c.prev === undefined) disp(this.keys(), iteratorExcept(this.keys(), c.key))
      })
    }, () => this.keys())
  }

  /** Registers `fn` to be notified of changes to this map.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onChange (fn :(change :MapChange<K,V>) => any) :Remover

  // from Source
  onEmit (fn :ValueFn<ReadonlyMap<K,V>>) :Remover {
    return this.onChange(change => fn(this.data))
  }
  onValue (fn :ValueFn<ReadonlyMap<K,V>>) :Remover {
    const remover = this.onEmit(fn)
    fn(this.data)
    return remover
  }
  map<T> (fn :(m:ReadonlyMap<K,V>) => T) :Source<T> {
    return new Subject((lner, want) => {
      if (want && lner(fn(this.data)) === Remove) return NoopRemover
      return this.onChange(_ => lner(fn(this.data)))
    })
  }
}

function iteratorExcept<K> (iter :IterableIterator<K>, omit :K) :IterableIterator<K> {
  return {
    next: () => {
      let next = iter.next()
      if (next.value === omit) next = iter.next()
      return next
    },
    [Symbol.iterator]: () => iteratorExcept(iter[Symbol.iterator](), omit)
  }
}

function iteratorPlus<K> (iter :IterableIterator<K>, add :K) :IterableIterator<K> {
  let added = false
  return {
    next: () => {
      if (added) return {done: true, value: undefined}
      let next = iter.next()
      if (!next.done) return next
      added = true
      return {value: add}
    },
    [Symbol.iterator]: () => iteratorPlus(iter[Symbol.iterator](), add)
  }
}

function keyIteratorsEqual<K> (a :IterableIterator<K>, b :IterableIterator<K>) :boolean {
  while (true) {
    const anext = a.next(), bnext = b.next()
    if (anext.done || bnext.done) return anext.done == bnext.done
    if (anext.value !== bnext.value) return false
  }
}

/** A mutable [[RMap]] which provides an API for setting and deleting elements. */
export abstract class MutableMap<K,V> extends RMap<K,V> implements Map<K,V> {
  private _listeners :ValueFn<MapChange<K,V>>[] = []
  protected abstract get data () :Map<K,V>

  /** Creates a local mutable map. */
  static local<K, V> () :MutableMap<K,V> { return new LocalMutableMap() }

  /** Associates `key` with `value` in this map. Notifies listeners of the change. */
  abstract set (key :K, value :V) :this

  /** Deletes the value associated with `key`. Notifies listeners if a mapping was in fact deleted.
    * @return `true` if a mapping was deleted, `false` if no mapping existed. */
  abstract delete (key :K) :boolean

  /** Deletes all mappings from this map. Notifies listeners of any deletions. */
  clear () {
    // TODO: do we want a bulk delete event?
    for (const key of this.keys()) this.delete(key)
  }

  /** Returns a [[Mutable]] that reflects the value of this map at `key`. If no mapping exists, it
    * contains `undefined`, otherwise it contains the mapping value. Changes to the mutable are
    * applied to the underlying map (including mapping `undefined` to deletion).
    * @param eq the equality function to use to compare successive values. */
  getMutable (key :K, eq :Eq<V|undefined> = refEquals) :Mutable<V|undefined> {
    return Mutable.deriveMutable(
      disp => this.onChange(change => {
        if (change.key === key) {
          const ovalue = change.prev, nvalue = change.type === "set" ? change.value : undefined
          if (!eq(ovalue, nvalue)) disp(nvalue, ovalue)
        }
      }),
      () => this.get(key),
      value => value ? this.set(key, value) : this.delete(key),
      eq)
  }

  forEach (fn :(v:V, k:K, m:Map<K,V>) => void) { this.data.forEach(fn) }

  onChange (fn :(change :MapChange<K,V>) => any) :Remover {
    return addListener(this._listeners, fn)
  }

  protected notifySet (key :K, value :V, prev :V|undefined) {
    dispatchValue(this._listeners, {type: "set", key, value, prev})
  }
  protected notifyDelete (key :K, prev :V) {
    dispatchValue(this._listeners, {type: "deleted", key, prev})
  }
}

class LocalMutableMap<K,V> extends MutableMap<K,V> {
  protected data = new Map<K,V>()

  set (key :K, value :V) :this {
    const data = this.data, prev = data.get(key)
    data.set(key, value)
    this.notifySet(key, value, prev)
    return this
  }

  delete (key :K) :boolean {
    const data = this.data, prev = data.get(key)
    const changed = data.delete(key)
    if (changed) this.notifyDelete(key, prev as V)
    return changed
  }
}
