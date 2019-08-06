import {Mutable} from "../core/react"
import {Encoder, Decoder, ValueType} from "../core/codec"
import {DataSource, DObject, DObjectType, Path, SyncReq} from "./data"
import {getPropMetas} from "./meta"

/** Uniquely identifies a data server; provides the info needed to establish a connection to it. */
export type Address = {host :string, port :number, path :string}

export interface Locator {

  /** Resolves the address of the server that hosts the object at `path`.
    *
    * TODO: Do we eventually want to return a Subject to support the case where an object migrates
    * to a new server while active subscriptions exist?
    */
  resolve (path :Path) :Promise<Address>
}

class Connection {

  constructor (readonly address :Address) {
    // TODO: auto-start connection?
  }

  subscribe<T extends DObject> (path :Path) :Promise<T> {
    return Promise.reject(new Error("TODO"))
  }

  post<M> (path :Path, msg :M) {
    // TODO
  }

  sendSync (path :Path, req :SyncReq) {
    // TODO
  }
}

export class Client implements DataSource {
  private readonly conns = new Map<Address, Connection>()

  constructor (readonly locator :Locator) {}

  async subscribe<T extends DObject> (path :Path) :Promise<T> {
    return (await this.connFor(path)).subscribe(path)
  }

  async post<M> (path :Path, msg :M, mtype :ValueType) {
    return (await this.connFor(path)).post(path, msg)
  }

  async sendSync (path :Path, req :SyncReq) {
    return (await this.connFor(path)).sendSync(path, req)
  }

  // TODO: dispose connections?

  protected async connFor (path :Path) :Promise<Connection> {
    const addr = await this.locator.resolve(path)
    let conn = this.conns.get(addr)
    if (!conn) this.conns.set(addr, conn = new Connection(addr))
    return conn
  }
}

export function addObject (obj :DObject, enc :Encoder) {
  const metas = getPropMetas(Object.getPrototypeOf(obj))
  // TODO: get extra constructor args from dconst metadata
  for (const [prop, meta] of metas.entries()) {
    switch (meta.type) {
    case "value": enc.addValue((obj[prop] as Mutable<any>).current, meta.vtype) ; break
    case "set": enc.addSet((obj[prop] as Set<any>), meta.etype) ; break
    case "map": enc.addMap((obj[prop] as Map<any, any>), meta.ktype, meta.vtype) ; break
    case "collection": break // TODO: anything?
    case "queue": break // TODO: anything?
    }
  }
}

export function getObject<T extends DObject> (
  type :DObjectType<T>, dec :Decoder, source :DataSource, path :Path
) :T {
  const metas = getPropMetas(type.prototype)
  // TODO: get extra constructor args from dconst metadata
  const obj = new type(source, path)
  for (const [prop, meta] of metas.entries()) {
    switch (meta.type) {
    case "value": (obj[prop] as Mutable<any>).update(dec.getValue(meta.vtype)) ; break
    case "set": dec.getSet(meta.etype, (obj[prop] as Set<any>)) ; break
    case "map": dec.getMap(meta.ktype, meta.vtype, (obj[prop] as Map<any, any>)) ; break
    case "collection": break // TODO
    case "queue": break // TODO
    }
  }
  return obj
}
