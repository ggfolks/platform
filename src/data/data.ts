import {Remover} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Data, Record, dataEquals, refEquals} from "../core/data"
import {ChangeFn, Eq, Mutable, Value, ValueFn, addListener, dispatchChange} from "../core/react"
import {MutableSet, MutableMap} from "../core/rcollect"
import {Auth} from "../auth/auth"
import {WhereClause, OrderClause, PropMeta, ValueMeta, SetMeta, MapMeta, CollectionMeta, TableMeta,
        tableForView, getPropMetas} from "./meta"
import {SyncMsg, SyncType} from "./protocol"

// re-export Auth to make life easier for modules that define DObjects & DQueues & handlers
export {Auth} from "../auth/auth"

export type MetaMsg = {type :"created"}
                    | {type :"destroyed"}
                    | {type :"subscribed", id :UUID}
                    | {type :"unsubscribed", id :UUID}

export class DMutable<T> extends Mutable<T> {

  static create<T> (eq :Eq<T>, owner :DObject, idx :number, meta :ValueMeta, start :T) {
    const listeners :ValueFn<T>[] = []
    let current = start
    const update = (value :T, fromSync? :boolean) => {
      const ov = current
      if (!eq(ov, value)) {
        dispatchChange(listeners, current = value, ov)
        if (!fromSync) owner.noteWrite(
          {type: SyncType.VALSET, path: owner.path, idx, vtype: meta.vtype, value})
      }
    }
    return new DMutable(eq, lner => addListener(listeners, lner), () => current, update)
  }

  constructor (eq :Eq<T>, onChange :(fn:ChangeFn<T>) => Remover, current :() => T,
               protected readonly _update :(v:T, fromSync?:boolean) => void) {
    super(eq, onChange, current, _update)
  }

  update (newValue :T, fromSync? :boolean) { this._update(newValue, fromSync) }
}

class DMutableSet<E> extends MutableSet<E> {
  protected data = new Set<E>()

  constructor (readonly owner :DObject, readonly idx :number, readonly meta :SetMeta) { super() }

  add (elem :E, fromSync? :boolean) :this {
    const size = this.data.size
    this.data.add(elem)
    if (this.data.size !== size) {
      this.notifyAdd(elem)
      if (!fromSync) this.owner.noteWrite(
        {type: SyncType.SETADD, path: this.owner.path, idx: this.idx, elem, etype: this.meta.etype})
    }
    return this
  }

  delete (elem :E, fromSync? :boolean) :boolean {
    if (!this.data.delete(elem)) return false
    this.notifyDelete(elem)
    if (!fromSync) this.owner.noteWrite(
      {type: SyncType.SETDEL, path: this.owner.path, idx: this.idx, elem, etype: this.meta.etype})
    return true
  }
}

class DMutableMap<K,V> extends MutableMap<K,V> {
  protected data = new Map<K,V>()

  constructor (readonly owner :DObject, readonly idx :number, readonly meta :MapMeta) { super() }

  set (key :K, value :V, fromSync? :boolean) :this {
    const data = this.data, prev = data.get(key)
    data.set(key, value)
    this.notifySet(key, value, prev)
    if (!fromSync) {
      const {owner, idx} = this, {ktype, vtype} = this.meta
      owner.noteWrite({type: SyncType.MAPSET, path: owner.path, idx, key, value, ktype, vtype})
    }
    return this
  }

  delete (key :K, fromSync? :boolean) :boolean {
    const data = this.data, prev = data.get(key)
    if (!data.delete(key)) return false
    this.notifyDelete(key, prev as V)
    if (!fromSync) {
      const {owner, idx} = this
      owner.noteWrite({type: SyncType.MAPDEL, path: owner.path, idx, key, ktype: this.meta.ktype})
    }
    return true
  }
}

/** Identifies the path to an object from the root of the data store. Even path elements are object
  * property names, odd path elements are object collection keys (UUIDs). */
export type Path = Array<string | UUID>

function checkPath (path :Path) :Path {
  if (path === undefined) throw new Error(`Illegal undefined path`)
  return path
}

/** Maintains a mapping from `Path` objects to arbitrary values (of the same type). */
export class PathMap<T> {
  private value :T|undefined = undefined
  private children :{[key :string] :PathMap<T>}|undefined = undefined

  /** Sets the mapping for `path` to `value`. */
  set (path :Path, value :T) { this._add(checkPath(path), 0, value) }

  /** Looks and returns the mapping for `path`, or `undefined` if no mapping exists. */
  get (path :Path) :T|undefined { return this._get(checkPath(path), 0) }

  /** Looks up and returns the mapping for `path`, throws an error if no mapping exists. */
  require (path :Path) :T {
    const result = this._get(checkPath(path), 0)
    if (!result) throw new Error(`Missing value for ${path}`)
    return result
  }

  /** Deletes the mapping for `path`.
    * @return the previous value of the mapping. */
  delete (path :Path) :T|undefined { return this._delete(checkPath(path), 0) }

  /** Removes all mappings from this map. */
  clear () {
    this.value = undefined
    this.children = undefined
  }

  /** Applies `op` to all values in the map. Note: if `op` mutates the map, no guarantees are made
    * as to whether `op` is applied or not to added or removed values. */
  forEach (op :(v:T) => void) {
    const {value, children} = this
    if (value) op(value)
    if (children) for (const key in children) children[key].forEach(op)
  }

  private _add (path :Path, pos :number, value :T) {
    if (pos === path.length) this.value = value
    else {
      const children = this.children || (this.children = {})
      const childmap = children[path[pos]] || (children[path[pos]] = new PathMap<T>())
      childmap._add(path, pos+1, value)
    }
  }

  private _get (path :Path, pos :number) :T|undefined {
    if (pos === path.length) return this.value
    else if (!this.children) return undefined
    else {
      const childmap = this.children[path[pos]]
      return childmap ? childmap._get(path, pos+1) : undefined
    }
  }

  private _delete (path :Path, pos :number) :T|undefined {
    if (pos === path.length) {
      const ovalue = this.value
      this.value = undefined
      return ovalue
    }
    else if (!this.children) return undefined
    else {
      const childmap = this.children[path[pos]]
      return childmap ? childmap._delete(path, pos+1) : undefined
    }
  }
}

/** Defines an index on a collection of objects. */
export class DIndex<O extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly index :number,
               readonly collection :CollectionMeta, readonly where :WhereClause[],
               readonly order :OrderClause[]) {}

  get path () :Path { return this.owner.path.concat(this.name) }
}

export class DCollection<O extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectType<O>) {}

  get path () :Path { return this.owner.path.concat(this.name) }

  pathTo (key :UUID) :Path { return this.owner.path.concat([this.name, key]) }
}

export class DTable<R extends Record> {

  constructor (readonly owner :DObject, readonly name :string) {}

  get path () :Path { return this.owner.path.concat(this.name) }

  pathTo (key :UUID) :Path { return this.owner.path.concat([this.name, key]) }

  /** Creates a new record in this table with `key` and initial `data`. */
  create (key :UUID, data :Record) { this.owner.source.createRecord(this.path, key, data) }

  /** Updates the record in this table at `key` with `data`.
    * @param merge if `true` (the default) `data` may contain only a subset of the record's fields
    * and they will be merged with the existing record. */
  update (key :UUID, data :Record, merge = true) {
    this.owner.source.updateRecord(this.path, key, data, merge) }

  /** Deletes the record at `key` from this table. */
  delete (key :UUID) { this.owner.source.deleteRecord(this.path, key) }
}

/** Defines a view of the records of a table. */
export class DView<R extends Record> {

  constructor (readonly owner :DObject, readonly name :string, readonly index :number,
               readonly table :TableMeta, readonly where :WhereClause[],
               readonly order :OrderClause[]) {}

  get path () :Path { return this.owner.path.concat(this.name) }
}

export type DQueueAddr = { path :Path, index :number }

export class DQueue<M extends Record> {

  constructor (readonly owner :DObject, readonly index :number) {}

  get addr () :DQueueAddr { return {path: this.owner.path, index: this.index} }

  post (msg :M) {
    return this.owner.source.post(this.addr, msg)
  }
}

export type DHandler<O extends DObject,M> = (obj :O, msg :M, auth: Auth) => void

export type DObjectType<T extends DObject> = {
  new (source :DataSource, path :Path, state :Value<DState>) :T
}

export function findObjectType (rtype :DObjectType<any>, path :Path) :DObjectType<DObject> {
  let curtype = rtype, idx = 0
  while (idx < path.length) {
    const curmetas = getPropMetas(curtype.prototype)
    // TODO: have metas include a map by name as well?
    const colname = path[idx] as string, col = curmetas.find(m => m.name === colname)
    if (!col) throw new Error(`Missing metadata for path component [path=${path}, idx=${idx}]`)
    if (col.type !== "collection") throw new Error(
      `Expected 'collection' property at path component [path=${path}, idx=${idx}]`)
    curtype = col.otype
    idx += 2 // skip the collection key
  }
  return curtype
}

export type DState = "resolving" | "failed" | "active" | "disconnected" | "disposed"

export interface DataSource {

  /** Posts `msg` to the queue at the address `queue`. */
  post (queue :DQueueAddr, msg :Record) :void
  // TODO: optional auth for server entities that want to post to further queues with same creds?
  // TODO: variants that wait for the message to be processed? also return channels?

  /** Sends a sync request for `obj`. This is only used internally. */
  sendSync (obj :DObject, msg :SyncMsg) :void

  /** Creates record in the table at `path` with key `key` and `data`. */
  createRecord (path :Path, key :UUID, data :Record) :void
  /** Updates record with `key` in the table at `path` with `data`. */
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) :void
  /** Deletes record with `key` in the table at `path`. */
  deleteRecord (path :Path, key :UUID) :void
}

function metaMismatch (meta :PropMeta, expect :string) :never {
  throw new Error(`Metadata mismatch [meta=${JSON.stringify(meta)}], asked to create '${expect}'`)
}

export abstract class DObject {
  readonly metas = getPropMetas(Object.getPrototypeOf(this))
  private metaIdx = 0

  /** Returns the address of the queue named `name` on this object. Note: this must be called via
    * the concrete DObject subtype that declares the queue. */
  static queueAddr (path :Path, name :string) :DQueueAddr {
    const metas = getPropMetas(this.prototype)
    const qmeta = metas.find(m => m.name === name)
    if (qmeta) return {path, index: qmeta.index}
    throw new Error(`No queue named ${name} on ${this.name}`)
  }

  constructor (
    /** The data source from whence this object came. */
    readonly source :DataSource,
    /** The path to this object from the root of the data store. */
    readonly path :Path,
    /** Indicates when this object is active, disconnected, etc. */
    readonly state :Value<DState>) {}

  /** This object's key in its owning collection. */
  get key () :UUID { return this.path.length > 0 ? this.path[this.path.length-1] : UUID0 }

  /** This object's disposedness state. */
  get disposed () :Value<boolean> { return this.state.map(ds => ds === "disposed") }

  /** Whether or not the client represented by `auth` can subscribe to this object. */
  canSubscribe (auth :Auth) :boolean { return auth.isSystem }

  /** Whether or not the client represented by `auth` can read the specified property. This will
    * only be called for clients that have passed the `canSubscribe` test. */
  canRead (prop :string, auth :Auth) :boolean { return true }

  /** Whether or not the client represented by `auth` can update the specified property. This will
    * only be called for clients that have passed the `canSubscribe` and `canRead` tests. */
  canWrite (prop :string, auth :Auth) :boolean { return auth.isSystem }

  /** Whether or not the client represented by `auth` can create an object in the specified
    * collection property. This will only be called for clients that have passed the `canSubscribe`
    * and `canRead` tests. */
  canCreate (prop :string, auth :Auth) :boolean { return auth.isSystem }

  noteWrite (msg :SyncMsg) { this.source.sendSync(this, msg) }

  applySync (msg :SyncMsg, fromSync :boolean) {
    const prop = this[this.metas[msg.idx].name]
    switch (msg.type) {
    case SyncType.VALSET: (prop as DMutable<any>).update(msg.value, fromSync) ; break
    case SyncType.SETADD: (prop as DMutableSet<any>).add(msg.elem, fromSync) ; break
    case SyncType.SETDEL: (prop as DMutableSet<any>).delete(msg.elem, fromSync) ; break
    case SyncType.MAPSET: (prop as DMutableMap<any,any>).set(msg.key, msg.value, fromSync) ; break
    case SyncType.MAPDEL: (prop as DMutableMap<any,any>).delete(msg.key, fromSync) ; break
    }
  }

  toString () { return `${this.constructor.name}@${this.path}` }

  protected value<T> (initVal :T, eq :Eq<T> = refEquals) :Mutable<T> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type === "value") ? DMutable.create(eq, this, index, meta, initVal) :
      metaMismatch(meta, "value")
  }

  protected dataValue<T extends Data> (initVal :T) :Mutable<T> {
    return this.value(initVal, dataEquals)
  }

  protected set<E> () :MutableSet<E> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "set") ? metaMismatch(meta, "set") : new DMutableSet(this, index, meta)
  }

  protected map<K,V> () :MutableMap<K,V> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "map") ? metaMismatch(meta, "map") : new DMutableMap(this, index, meta)
  }

  protected collection<O extends DObject> () :DCollection<O> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "collection") ? metaMismatch(meta, "collection") : new DCollection<O>(
      this, meta.name, meta.otype)
  }

  protected table<R extends Record> () :DTable<R> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "table") ? metaMismatch(meta, "table") : new DTable<R>(this, meta.name)
  }

  protected view<R extends Record> () :DView<R> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "view") ? metaMismatch(meta, "view") : new DView<R>(
      this, meta.name, index, tableForView(this.metas, meta), meta.where, meta.order)
  }

  protected queue<M extends Record> () :DQueue<M> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "queue") ? metaMismatch(meta, "queue") : new DQueue<M>(this, index)
  }
}
