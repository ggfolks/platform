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

  static create<T> (eq :Eq<T>, owner :DObject, name :string, vtype :ValueType, start :T) {
    const listeners :ValueFn<T>[] = []
    let current = start
    const update = (value :T, fromSync? :boolean) => {
      const ov = current
      if (!eq(ov, value)) {
        dispatchChange(listeners, current = value, ov)
        if (!fromSync) owner.sendSync({type: SyncType.VALSET, name, vtype, value})
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
               readonly name :string,
               readonly etype :KeyType) { super() }

  add (elem :E, fromSync? :boolean) :this {
    const size = this.data.size
    this.data.add(elem)
    if (this.data.size !== size) {
      this.notifyAdd(elem)
      if (!fromSync) this.owner.sendSync({
        type: SyncType.SETADD, name: this.name, elem, etype: this.etype})
    }
    return this
  }

  delete (elem :E, fromSync? :boolean) :boolean {
    if (!this.data.delete(elem)) return false
    this.notifyDelete(elem)
    if (!fromSync) this.owner.sendSync({
      type: SyncType.SETDEL, name: this.name, elem, etype: this.etype})
    return true
  }
}

class DMutableMap<K,V> extends MutableMap<K,V> {
  protected data = new Map<K,V>()

  constructor (readonly owner :DObject, readonly name :string,
               readonly ktype :KeyType, readonly vtype :ValueType) { super() }

  set (key :K, value :V, fromSync? :boolean) :this {
    const data = this.data, prev = data.get(key)
    data.set(key, value)
    this.notifySet(key, value, prev)
    if (!fromSync) {
      const {owner, name, ktype, vtype} = this
      owner.sendSync({type: SyncType.MAPSET, name, key, value, ktype, vtype})
    }
    return this
  }

  delete (key :K, fromSync? :boolean) :boolean {
    const data = this.data, prev = data.get(key)
    if (!data.delete(key)) return false
    this.notifyDelete(key, prev as V)
    if (!fromSync) {
      const {owner, name, ktype} = this
      owner.sendSync({type: SyncType.MAPDEL, name, key, ktype})
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
    const col = curmetas.get(path[idx] as string)
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

export type DObjectStatus = {state: "pending"}
                          | {state: "connected"}
                          | {state: "error", error :Error}

export abstract class DObject implements Disposable {
  readonly metas = getPropMetas(Object.getPrototypeOf(this))
  private metaIter = this.metas.entries()

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

  sendSync (msg :SyncMsg) { this.source.sendSync(this, msg) }

  applySync (msg :SyncMsg, auth? :Auth) {
    if (auth && !this.canWrite(msg.name, auth)) throw new Error(
      `Sync rejected due to auth [obj=${this}, prop=${msg.name}, auth=${auth}]`)
    switch (msg.type) {
    case SyncType.VALSET: (this[msg.name] as DMutable<any>).update(msg.value, true) ; break
    case SyncType.SETADD: (this[msg.name] as DMutableSet<any>).add(msg.elem, true) ; break
    case SyncType.SETDEL: (this[msg.name] as DMutableSet<any>).delete(msg.elem, true) ; break
    case SyncType.MAPSET: (this[msg.name] as DMutableMap<any,any>).set(msg.key, msg.value, true) ; break
    case SyncType.MAPDEL: (this[msg.name] as DMutableMap<any,any>).delete(msg.key, true) ; break
    }
  }

  dispose () :void {} // TODO

  toString () { return `${this.constructor.name}@${this.path}` }

  protected value<T> (initVal :T, eq :Eq<T> = refEquals) :Mutable<T> {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "value") return DMutable.create(eq, this, name, meta.vtype, initVal)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'value'`)
  }

  protected dataValue<T extends Data> (initVal :T) :Mutable<T> {
    return this.value(initVal, dataEquals)
  }

  protected set<E> () :MutableSet<E> {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "set") return new DMutableSet(this, name, meta.etype)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'set'`)
  }

  protected map<K,V> () :MutableMap<K,V> {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "map") return new DMutableMap(this, name, meta.ktype, meta.vtype)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'map'`)
  }

  protected collection<K,V extends DObject> () {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "collection") return new DCollection<K,V>(this, name, meta.otype)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'collection'`)
  }

  protected queue<M extends Record> () {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "queue") return new DQueue(this, name)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'queue'`)
  }
}
