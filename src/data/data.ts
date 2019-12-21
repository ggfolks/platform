import {Remover, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Path} from "../core/path"
import {Data, Record, dataEquals, refEquals} from "../core/data"
import {ChangeFn, Eq, Mutable, Value, ValueFn, addListener, dispatchChange} from "../core/react"
import {MutableSet, MutableMap} from "../core/rcollect"
import {Auth} from "../auth/auth"
import {WhereClause, OrderClause, PropMeta, ValueMeta, SetMeta, MapMeta, TableMeta,
        DObjectTypeMap, tableForView, getPropMetas} from "./meta"
import {SyncMsg, ObjType} from "./protocol"

// re-export Auth to make life easier for modules that define DObjects & DQueues & handlers
export {Auth} from "../auth/auth"

export class DMutable<T> extends Mutable<T> {

  static create<T> (eq :Eq<T>, owner :DObject, idx :number, meta :ValueMeta, start :T) {
    const listeners :ValueFn<T>[] = []
    let current = start
    const update = (value :T, fromSync? :boolean) => {
      const ov = current
      if (!eq(ov, value)) {
        dispatchChange(listeners, current = value, ov)
        if (!fromSync) owner.noteWrite({type: ObjType.VALSET, idx, vtype: meta.vtype, value})
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
        {type: ObjType.SETADD, idx: this.idx, elem, etype: this.meta.etype})
    }
    return this
  }

  delete (elem :E, fromSync? :boolean) :boolean {
    if (!this.data.delete(elem)) return false
    this.notifyDelete(elem)
    if (!fromSync) this.owner.noteWrite(
      {type: ObjType.SETDEL, idx: this.idx, elem, etype: this.meta.etype})
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
      owner.noteWrite({type: ObjType.MAPSET, idx, key, value, ktype, vtype})
    }
    return this
  }

  delete (key :K, fromSync? :boolean) :boolean {
    const data = this.data, prev = data.get(key)
    if (!data.delete(key)) return false
    this.notifyDelete(key, prev as V)
    if (!fromSync) {
      const {owner, idx} = this
      owner.noteWrite({type: ObjType.MAPDEL, idx, key, ktype: this.meta.ktype})
    }
    return true
  }
}

export class DCollection<O extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectTypeMap<O>) {}

  get path () :Path { return this.owner.path.concat(this.name) }

  pathTo (key :UUID) :Path { return this.owner.path.concat([this.name, key]) }
}

export class DSingleton<O extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectType<O>) {}

  get path () :Path { return this.owner.path.concat(this.name) }
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

  post (msg :M) { return this.owner.source.post(this.addr.index, msg) }
}

export interface DContext {
  auth :Auth
  post (queue :DQueueAddr, msg :Record) :void
}

export type DHandler<O extends DObject,M> = (ctx :DContext, obj :O, msg :M) => void

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
    switch (col.type) {
    case "collection":
      curtype = col.otype(path[idx+1])
      idx += 2 // skip the collection name and key
      break
    case "singleton":
      curtype = col.otype
      idx += 1 // skip the singleton name
      break
    default:
      const etype = (idx < path.length-2) ? "collection" : "singleton"
      throw new Error(`Expected '${etype}' property at path component [path=${path}, idx=${idx}]`)
    }
  }
  return curtype
}

export type DState = "resolving" | "failed" | "active" | "disconnected" | "disposed"

export interface DataSource {

  /** Posts `msg` to the queue at `index`. */
  post (index :number, msg :Record) :void
  /** Sends a sync request for `obj`. */
  sendSync (msg :SyncMsg) :void
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
  get key () :UUID {
    if (this.path.length === 0) return UUID0 // root object
    else if (this.path.length % 2 === 1) return UUID0 // singleton object
    else return this.path[this.path.length-1] // collection object
  }

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

  noteWrite (msg :SyncMsg) { this.source.sendSync(msg) }

  /** Called on the server when this object was just resolved from persistent storage.
    * The `ctx` will contain system auth info. */
  wasResolved (ctx :DContext) {}

  /** Called on the server when a client has subscribed to this object.
    * The `ctx` will contain auth info for the subscriber. */
  noteSubscribed (ctx :DContext) {}

  /** Called on the server when a client has unsubscribed from this object.
    * The `ctx` will contain auth info for the unsubscriber. */
  noteUnsubscribed (ctx :DContext) {}

  applySync (msg :SyncMsg, fromSync :boolean) {
    const meta = this.metas[msg.idx], prop = this[meta.name]
    try {
      switch (msg.type) {
      case ObjType.VALSET: (prop as DMutable<any>).update(msg.value, fromSync) ; break
      case ObjType.SETADD: (prop as DMutableSet<any>).add(msg.elem, fromSync) ; break
      case ObjType.SETDEL: (prop as DMutableSet<any>).delete(msg.elem, fromSync) ; break
      case ObjType.MAPSET: (prop as DMutableMap<any,any>).set(msg.key, msg.value, fromSync) ; break
      case ObjType.MAPDEL: (prop as DMutableMap<any,any>).delete(msg.key, fromSync) ; break
      }
    } catch (err) {
      log.warn("Change notify failed", "obj", this, "prop", meta.name, "msg", msg, err)
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

  protected singleton<O extends DObject> () :DSingleton<O> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type !== "singleton") ? metaMismatch(meta, "singleton") : new DSingleton<O>(
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
