import {DataSource, DObject, Path, SyncReq, ValueType} from "./data"

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
