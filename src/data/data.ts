import {Disposable, Remover} from "../core/util"
import {Data, dataEquals, refEquals} from "../core/data"
import {ChangeFn, Eq, Mutable, ValueFn, addListener, dispatchChange} from "../core/react"
import {MutableSet, MutableMap} from "../core/rcollect"

export type ID = string

export type Auth = {
  id :ID
  // TODO: change this to something extensible like: hasToken("admin"|"support"|"system")
  // or maybe those tokens are named "isAdmin" etc. and are jammed into this object...
  isSystem :boolean
}

export type MetaMsg = {type :"subscribed", userId :ID}
                    | {type :"unsubscribed", userId :ID}

/** Identifies an object in a collection. */
export type DKey = string | number

/** Identifies the path to an object from the root of the data store. Even path elements are object
  * property names, odd path elements are object collection keys. */
export type Path = DKey[]

class DMutable<T> extends Mutable<T> {

  static create<T> (eq :Eq<T>, owner :DObject, name :string, vtype :ValueType, start :T) {
    const listeners :ValueFn<T>[] = []
    let current = start
    const update = (value :T, fromSync? :boolean) => {
      const ov = current
      if (!eq(ov, value)) {
        dispatchChange(listeners, current = value, ov)
        if (!fromSync) owner.sendSync({type: "valset", name, vtype, value})
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
               readonly etype :ValueType) { super() }

  add (elem :E, fromSync? :boolean) :this {
    const size = this.data.size
    this.data.add(elem)
    if (this.data.size !== size) {
      this.notifyAdd(elem)
      if (!fromSync) this.owner.sendSync({type: "setadd", name: this.name, elem, etype: this.etype})
    }
    return this
  }

  delete (elem :E, fromSync? :boolean) :boolean {
    if (!this.data.delete(elem)) return false
    this.notifyDelete(elem)
    if (!fromSync) this.owner.sendSync({type: "setdel", name: this.name, elem})
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
      owner.sendSync({type: "mapset", name, key, value, ktype, vtype})
    }
    return this
  }

  delete (key :K, fromSync? :boolean) :boolean {
    const data = this.data, prev = data.get(key)
    if (!data.delete(key)) return false
    this.notifyDelete(key, prev as V)
    if (!fromSync) {
      const {owner, name, ktype} = this
      owner.sendSync({type: "mapdel", name, key, ktype})
    }
    return true
  }
}

export class DCollection<K,V> {

  constructor (readonly owner :DObject, readonly name :string, readonly otype :DObjectType) {}

  subscribe<T extends DObject> (key :DKey) :Promise<T> {
    return this.owner.source.subscribe(this.owner.path.concat([this.name, key]), this.otype)
  }
}

export class DQueue<M> {

  constructor (readonly owner :DObject, readonly name :string, readonly mtype :ValueType) {}

  post (msg :M) {
    const path = this.owner.path.concat([this.name])
    return this.owner.source.post(path, msg, this.mtype)
  }
}

export type DHandler<O,M> = (obj :O, msg :M, auth: Auth) => void

export type DObjectType = { new (source :DataSource, path :Path) :DObject }

// sync messages come down from server (no need for type information, we've already decoded)
type ValSetMsg = {type :"valset", name :string, value :any}
type SetAddMsg = {type :"setadd", name :string, elem :any}
type SetDelMsg = {type :"setdel", name :string, elem :any}
type MapSetMsg = {type :"mapset", name :string, key :any, value :any}
type MapDelMsg = {type :"mapdel", name :string, key :any}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg

// sync requests go up to the server (include type info for protocol encode)
type ValSetReq = ValSetMsg & {vtype: ValueType}
type SetAddReq = SetAddMsg & {etype: ValueType}
type SetDelReq = SetDelMsg
type MapSetReq = MapSetMsg & {ktype: KeyType, vtype: ValueType}
type MapDelReq = MapDelMsg & {ktype: KeyType}
export type SyncReq = ValSetReq | SetAddReq | SetDelReq | MapSetReq | MapDelReq

export interface DataSource {

  subscribe<T extends DObject> (path :Path, otype :DObjectType) :Promise<T>

  post<M> (path :Path, msg :M, mtype :ValueType) :void
  // TODO: variants that wait for the message to be processed? also return channels?

  sendSync (path :Path, req :SyncReq) :void
}

export type DAccess = {
  read? :string
  write? :string
}

export abstract class DObject implements Disposable {
  private metaIter = getPropMetas(Object.getPrototypeOf(this)).entries()

  constructor (readonly source :DataSource, readonly path :Path) {}

  /** This object's key in its owning collection. */
  get key () { return this.path[this.path.length-1] }

  canSubscribe (auth :Auth) :boolean { return auth.isSystem }
  canRead (prop :string, auth :Auth) :boolean { return true }
  canWrite (prop :string, auth :Auth) :boolean { return auth.isSystem }

  sendSync (req :SyncReq) {
    this.source.sendSync(this.path, req)
  }

  applySync (msg :SyncMsg) {
    switch (msg.type) {
    case "valset": (this[msg.name] as DMutable<any>).update(msg.value, true) ; break
    case "setadd": (this[msg.name] as DMutableSet<any>).add(msg.elem, true) ; break
    case "setdel": (this[msg.name] as DMutableSet<any>).delete(msg.elem, true) ; break
    case "mapset": (this[msg.name] as DMutableMap<any,any>).set(msg.key, msg.value, true) ; break
    case "mapdel": (this[msg.name] as DMutableMap<any,any>).delete(msg.key, true) ; break
    }
  }

  dispose () :void {} // TODO

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

  protected collection<K,V> () {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "collection") return new DCollection<K,V>(this, name, meta.otype)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'collection'`)
  }

  protected queue<M> () {
    const [name, meta] = this.metaIter.next().value
    if (meta.type === "queue") return new DQueue(this, name, meta.mtype)
    throw new Error(`Metadata mismatch [name=${name}, meta=${meta}], asked to create 'queue'`)
  }
}

//
// Metadata decorators

export type KeyType = "boolean" | "int8" | "int16" | "int32" | "float32" | "float64" | "number"
                    | "string" | "timestamp" | "id"
export type ValueType = KeyType | "record"

type ValueMeta = {type: "value", vtype: ValueType}
type SetMeta = {type: "set", etype: ValueType}
type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType}
type CollectionMeta = {type: "collection", ktype: KeyType, otype: DObjectType}
type QueueMeta = {type: "queue", mtype: ValueType}
type Meta = ValueMeta | SetMeta | MapMeta | CollectionMeta | QueueMeta

export function getPropMetas (proto :Function|Object) :Map<string, Meta> {
  const atarget = proto as any
  const props = atarget["__props__"]
  if (props) return props
  return atarget["__props__"] = new Map()
}

export function dobject (ctor :Function) {
  // const atarget = ctor.prototype as any
  // TODO: anything?
}

const propAdder = (prop :Meta) =>
  (proto :Function|Object, name :string, descrip? :PropertyDescriptor) =>
    void getPropMetas(proto).set(name, prop)

export const dvalue = (vtype :ValueType) =>
  propAdder({type: "value", vtype})
export const dset = (etype :ValueType) =>
  propAdder({type: "set", etype})
export const dmap = (ktype :KeyType, vtype :ValueType) =>
  propAdder({type: "map", ktype, vtype})
export const dqueue = <O,M>(mtype :ValueType, handler :DHandler<O,M>) =>
  propAdder({type: "queue", mtype})
export const dcollection = (ktype :KeyType, otype :DObjectType) =>
  propAdder({type: "collection", ktype, otype})
