import {Remover} from "../core/util"
import {UUID} from "../core/uuid"
import {Data, Record, dataEquals, refEquals} from "../core/data"
import {ChangeFn, Eq, Mutable, Value, ValueFn, addListener, dispatchChange} from "../core/react"
import {MutableSet, MutableMap} from "../core/rcollect"
import {KeyType, ValueType} from "../core/codec"
import {PropMeta, getPropMetas} from "./meta"
import {SyncMsg, SyncType} from "./protocol"

export type Auth = {
  id :UUID
  // TODO: change this to something extensible like: hasToken("admin"|"support"|"system")
  // or maybe those tokens are named "isAdmin" etc. and are jammed into this object...
  isSystem :boolean
}

export type MetaMsg = {type :"created"}
                    | {type :"destroyed"}
                    | {type :"subscribed", id :UUID}
                    | {type :"unsubscribed", id :UUID}

export class DMutable<T> extends Mutable<T> {

  static create<T> (eq :Eq<T>, owner :DObject, idx :number, vtype :ValueType, start :T) {
    const listeners :ValueFn<T>[] = []
    let current = start
    const update = (value :T, fromSync? :boolean) => {
      const ov = current
      if (!eq(ov, value)) {
        dispatchChange(listeners, current = value, ov)
        if (!fromSync) owner.noteWrite({type: SyncType.VALSET, idx, vtype, value})
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

  constructor (readonly owner :DObject,
               readonly idx :number,
               readonly etype :KeyType) { super() }

  add (elem :E, fromSync? :boolean) :this {
    const size = this.data.size
    this.data.add(elem)
    if (this.data.size !== size) {
      this.notifyAdd(elem)
      if (!fromSync) this.owner.noteWrite({
        type: SyncType.SETADD, idx: this.idx, elem, etype: this.etype})
    }
    return this
  }

  delete (elem :E, fromSync? :boolean) :boolean {
    if (!this.data.delete(elem)) return false
    this.notifyDelete(elem)
    if (!fromSync) this.owner.noteWrite({
      type: SyncType.SETDEL, idx: this.idx, elem, etype: this.etype})
    return true
  }
}

class DMutableMap<K,V> extends MutableMap<K,V> {
  protected data = new Map<K,V>()

  constructor (readonly owner :DObject, readonly idx :number,
               readonly ktype :KeyType, readonly vtype :ValueType) { super() }

  set (key :K, value :V, fromSync? :boolean) :this {
    const data = this.data, prev = data.get(key)
    data.set(key, value)
    this.notifySet(key, value, prev)
    if (!fromSync) {
      const {owner, idx, ktype, vtype} = this
      owner.noteWrite({type: SyncType.MAPSET, idx, key, value, ktype, vtype})
    }
    return this
  }

  delete (key :K, fromSync? :boolean) :boolean {
    const data = this.data, prev = data.get(key)
    if (!data.delete(key)) return false
    this.notifyDelete(key, prev as V)
    if (!fromSync) {
      const {owner, idx, ktype} = this
      owner.noteWrite({type: SyncType.MAPDEL, idx, key, ktype})
    }
    return true
  }
}

/** Identifies the path to an object from the root of the data store. Even path elements are object
  * property names, odd path elements are object collection keys (UUIDs). */
export type Path = Array<string | UUID>

/** Converts `path` to a string suitable for use in a map. */
export const pathToKey = (path :Path) => path.join(":")

export class DCollection<O extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectType<O>) {}

  pathTo (key :UUID) :Path { return this.owner.path.concat([this.name, key]) }
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

  /** The connectedness state of this data source. */
  state :Value<DState>

  post (queue :DQueueAddr, msg :Record) :void
  // TODO: optional auth for server entities that want to post to further queues with same creds?
  // TODO: variants that wait for the message to be processed? also return channels?

  sendSync (obj :DObject, msg :SyncMsg) :void
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
  get key () { return this.path[this.path.length-1] }

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

  applySync (msg :SyncMsg, fromSync = true) {
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
    return (meta.type === "value") ? DMutable.create(eq, this, index, meta.vtype, initVal) :
      metaMismatch(meta, "value")
  }

  protected dataValue<T extends Data> (initVal :T) :Mutable<T> {
    return this.value(initVal, dataEquals)
  }

  protected set<E> () :MutableSet<E> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type === "set") ? new DMutableSet(this, index, meta.etype) :
      metaMismatch(meta, "set")
  }

  protected map<K,V> () :MutableMap<K,V> {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type === "map") ? new DMutableMap(this, index, meta.ktype, meta.vtype) :
      metaMismatch(meta, "map")
  }

  protected collection<O extends DObject> () {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type === "collection") ? new DCollection<O>(this, meta.name, meta.otype) :
      metaMismatch(meta, "collection")
  }

  protected queue<M extends Record> () {
    const index = this.metaIdx++, meta = this.metas[index]
    return (meta.type === "queue") ? new DQueue(this, index) : metaMismatch(meta, "queue")
  }
}
