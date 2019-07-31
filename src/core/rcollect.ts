import {Remover} from "./util"
import {Data, dataEquals, refEquals} from "./data"
import {Eq, Mutable, Source, Subject, Value, ValueFn, dispatchValue, addListener} from "./react"

//
// Reactive lists

/** Reports a change to an [[RList]]. */
export type ListChange<E> =
  {type :"added",   index :number, elem :E} |
  {type :"updated", index :number, elem :E, prev :E} |
  {type :"deleted", index :number, prev :E}

/** A reactive list: emits change events when elements are added, updated or deleted. A client can
  * choose to observe fine-grained list changes (via [[onChange]]) or treat the list as a
  * `Source` and simply reprocess the entire list any time it changes. */
export abstract class RList<E> extends Source<E[]> implements Iterable<E> {
  protected abstract get elems () :E[]

  /** The current length of this list. */
  get length () :number { return this.elems.length }

  /** Returns the element at `index`. */
  elemAt (index :number) :E { return this.elems[index] }

  /** Calls `fn` on each element of this list in order. */
  forEach (fn :(e:E) => void) { this.elems.forEach(fn) }

  /** Returns an iterator over the elements of this list. */
  [Symbol.iterator] () :IterableIterator<E> { return this.elems.values() }

  /** Returns a copy of a slice of this list as a plain array.
    * @param start the start index of the slice, defaults to `0`.
    * @param length the length of the slice, defaults to all elements after `start`. */
  slice (start? :number, length? :number) :E[] { return this.elems.slice(start, length) }

  /** Maps the elements of this list via `fn`.
    * @return a plain array containing the mapped elements. */
  mapElems<F> (fn :(e:E) => F) :F[] { return this.elems.map(fn) }

  // /** Maps this list to a new reactive list via `fn`. The structure of the mapped list will mirror
  //   * `this` list but the elements will be transformed via `fn`. Equality of the mapped list
  //   * elements will be computed via `eq` which defaults to [[refEquals]]. */
  // map<F> (fn :(e:E) => F, eq :Eq<F> = refEquals) :RList<F> { return throw new Error("TODO") }

  // /** Maps this list to a new reactive list via `fn`. The structure of the mapped list will mirror
  //   * `this` list but the elements will be transformed via `fn`. Equality of the mapped list
  //   * elements will be computed via [[dataEquals]]. */
  // mapData<F extends Data> (fn :(e:E) => F) :RList<F> { return this.map<F>(fn, dataEquals) }

  /** Registers `fn` to be notified of changes to this list.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onChange (fn :ValueFn<ListChange<E>>) :Remover

  // from Source
  onEmit (fn :ValueFn<E[]>) :Remover {
    return this.onChange(change => fn(this.elems))
  }
  onValue (fn :ValueFn<E[]>) :Remover {
    const remover = this.onEmit(fn)
    fn(this.elems)
    return remover
  }
}

// abstract class DerivedList<E> extends RList<E> {
//   private _listeners :ValueFn<ListChange<E>>[] = []
//   private _disconnect = NoopRemover

//   abstract _connectToSource () :Remover

//   _dispatchChange (change :ListChange<E>) {
//     dispatchValue(this._listeners, change)
//   }

//   onChange (listener :ValueFn<ListChange<E>>) :Remover {
//     const needConnect = this._listeners.length === 0
//     const remover = addListener(this._listeners, listener)
//     if (needConnect) this._disconnect = this._connectToSource()
//     return () => {
//       remover()
//       if (this._listeners.length === 0) {
//         this._disconnect()
//         this._disconnect = NoopRemover
//       }
//     }
//   }

//   protected get isConnected () :boolean { return this._disconnect !== NoopRemover }
// }

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

export interface RSet<E> extends Iterable<E> {

  size :number
  has (elem :E) :boolean

  add (elem :E) :this
  delete (elem :E) :boolean
  clear (): void

  // entries () :Iterator<[E,E]>
  // keys () :Iterator<E>
  // values () :Iterator<E>
  forEach (fn :(e:E) => void) :void

  onChange (fn :(change :SetChange<E>) => any) :Remover
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
    return Value.deriveValue(eq, disp => this.onChange(change => {
      if (change.key === key) {
        const ovalue = change.prev, nvalue = change.type === "set" ? change.value : undefined
        if (!eq(ovalue, nvalue)) disp(nvalue, ovalue)
      }
    }), () => this.get(key))
  }

  /** Returns a reactive view of the keys of this map. The source will immediately contain the
    * current keys and will emit a change when mappings are added or removed. */
  keysSource () :Source<K[]> {
    return new Subject((lner, want) => {
      if (want) lner(Array.from(this.keys()))
      return this.onChange(change => {
        if (change.type === "deleted" || change.prev === undefined) lner(Array.from(this.keys()))
      })
    })
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
  clear (): void {
    // TODO: do we want a bulk delete event?
    for (const key of Array.from(this.keys())) this.delete(key)
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
