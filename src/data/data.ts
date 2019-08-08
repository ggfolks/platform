import {Disposable, Remover} from "../core/util"
import {Data, Record, dataEquals, refEquals} from "../core/data"
import {ChangeFn, Eq, Mutable, Value, ValueFn, addListener, dispatchChange} from "../core/react"
import {MutableSet, MutableMap} from "../core/rcollect"
import {KeyType, ValueType} from "../core/codec"
import {getPropMetas} from "./meta"
import {SyncMsg, SyncType} from "./protocol"

export type ID = string

export type Auth = {
  id :ID
  // TODO: change this to something extensible like: hasToken("admin"|"support"|"system")
  // or maybe those tokens are named "isAdmin" etc. and are jammed into this object...
  isSystem :boolean
}

export type MetaMsg = {type :"subscribed", userId :ID}
                    | {type :"unsubscribed", userId :ID}

class DMutable<T> extends Mutable<T> {

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

/** Identifies an object in a collection. */
export type DKey = string | number

/** Identifies the path to an object from the root of the data store. Even path elements are object
  * property names, odd path elements are object collection keys. */
export type Path = DKey[]

export class DCollection<K,V extends DObject> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectType<V>) {}

  resolve (key :DKey) :V {
    return this.owner.source.resolve(this.owner.path.concat([this.name, key]), this.otype)
  }
}

export class DQueue<M extends Record> {

  constructor (readonly owner :DObject, readonly name :string) {}

  post (msg :M) {
    const path = this.owner.path.concat([this.name])
    return this.owner.source.post(path, msg)
  }
}

export type DHandler<O,M> = (obj :O, msg :M, auth: Auth) => void

export type DObjectType<T extends DObject> = {
  new (source :DataSource, status :Value<DObjectStatus>, path :Path, oid :number) :T
}

export function findObjectType (rtype :DObjectType<any>, path :Path) :DObjectType<any> {
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

export interface DataSource {

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :T

  post (path :Path, msg :Record) :void
  // TODO: variants that wait for the message to be processed? also return channels?

  sendSync (obj :DObject, msg :SyncMsg) :void
}

export interface Subscriber {
  auth :Auth
  sendSync (msg :SyncMsg) :void
}

export type DObjectStatus = {state: "pending"}
                          | {state: "connected"}
                          | {state: "error", error :Error}

export abstract class DObject implements Disposable {
  readonly metas = getPropMetas(Object.getPrototypeOf(this))
  private readonly subscribers :Subscriber[] = []
  private metaIdx = 0

  constructor (
    readonly source :DataSource,
    readonly status :Value<DObjectStatus>,
    readonly path :Path,
    readonly oid :number
  ) {}

  /** This object's key in its owning collection. */
  get key () { return this.path[this.path.length-1] }

  canSubscribe (auth :Auth) :boolean { return auth.isSystem }
  canRead (prop :string, auth :Auth) :boolean { return true }
  canWrite (prop :string, auth :Auth) :boolean { return auth.isSystem }

  /** Adds `sub` to this object's subscribers list iff `auth` is allowed to subscribe.
    * @return `true` if subscription succeeded, `false` if it was rejected due to auth.
    * @throw Error if subscription is attempted before the object is successfully resolved. */
  subscribe (sub :Subscriber) :boolean {
    const cstate = this.status.current.state
    if (cstate !== "connected") throw new Error(`Cannot subscribe to '${cstate}' object (${this})`)
    if (!this.canSubscribe(sub.auth)) return false
    this.subscribers.push(sub)
    return true
  }

  unsubscribe (sub :Subscriber) {
    const idx = this.subscribers.indexOf(sub)
    if (idx >= 0) this.subscribers.splice(idx, 1)
  }

  noteWrite (msg :SyncMsg) {
    this.source.sendSync(this, msg)
    const name = this.metas[msg.idx].name
    for (const sub of this.subscribers) if (this.canRead(name, sub.auth)) sub.sendSync(msg)
  }

  applyWrite (msg :SyncMsg, auth :Auth) {
    const name = this.metas[msg.idx].name
    if (!this.canRead(name, auth) || !this.canWrite(name, auth)) throw new Error(
      `Write rejected [obj=${this}, prop=${name}, auth=${auth}]`)
    this.applySync(msg, false)
  }

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

  dispose () :void {} // TODO

  toString () { return `${this.constructor.name}@${this.path}` }

  protected value<T> (initVal :T, eq :Eq<T> = refEquals) :Mutable<T> {
    const index = this.metaIdx++, meta = this.metas[index]
    if (meta.type === "value") return DMutable.create(eq, this, index, meta.vtype, initVal)
    throw new Error(`Metadata mismatch [meta=${meta}], asked to create 'value'`)
  }

  protected dataValue<T extends Data> (initVal :T) :Mutable<T> {
    return this.value(initVal, dataEquals)
  }

  protected set<E> () :MutableSet<E> {
    const index = this.metaIdx++, meta = this.metas[index]
    if (meta.type === "set") return new DMutableSet(this, index, meta.etype)
    throw new Error(`Metadata mismatch [meta=${meta}], asked to create 'set'`)
  }

  protected map<K,V> () :MutableMap<K,V> {
    const index = this.metaIdx++, meta = this.metas[index]
    if (meta.type === "map") return new DMutableMap(this, index, meta.ktype, meta.vtype)
    throw new Error(`Metadata mismatch [meta=${meta}], asked to create 'map'`)
  }

  protected collection<K,V extends DObject> () {
    const index = this.metaIdx++, meta = this.metas[index]
    if (meta.type === "collection") return new DCollection<K,V>(this, meta.name, meta.otype)
    throw new Error(`Metadata mismatch [meta=${meta}], asked to create 'collection'`)
  }

  protected queue<M extends Record> () {
    const index = this.metaIdx++, meta = this.metas[index]
    if (meta.type === "queue") return new DQueue(this, meta.name)
    throw new Error(`Metadata mismatch [meta=${meta}], asked to create 'queue'`)
  }
}
