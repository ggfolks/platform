import {Disposable} from "../core/util"
import {Record} from "../core/data"
import {Mutable, Subject} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {DataSource, DObject, DObjectStatus, DObjectType, Path} from "./data"
import {DownMsg, DownType, SyncMsg, UpMsg, UpType, encodeUp, decodeDown} from "./protocol"

/** Uniquely identifies a data server; provides the info needed to establish a connection to it. */
export type Address = {host :string, port :number, path :string}

/** Resolves the address of the server that hosts the object at `path`. */
export type Locator = (path :Path) => Subject<Address>

/** Creates `Connection` instances for clients. */
export type Connector = (client :Client, addr :Address) => Connection

export class Client implements DataSource {
  private readonly conns = new Map<Address, Connection>()
  private readonly objects = new Map<number,DObject>()
  private readonly encoder = new Encoder()
  private nextOid = 1

  constructor (readonly locator :Locator, readonly connector :Connector) {}

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :T {
    const oid = this.nextOid
    this.nextOid = oid+1
    const status = Mutable.local({state: "pending"} as DObjectStatus)
    const obj = new otype(this, status, path, oid)
    this.objects.set(oid, obj)
    // TODO: keep track of which conn hosts which objects & resubscribe if we lose & regain conn
    this.sendUp(path, {type: UpType.SUB, path, oid})
    return obj
  }

  post (path :Path, msg :Record) { this.sendUp(path, {type: UpType.POST, msg}) }

  sendSync (obj :DObject, req :SyncMsg) { this.sendUp(obj.path, {...req, oid: obj.oid}) }

  recvMsg (msg :Uint8Array) {
    this.handleDown(decodeDown(this.objects, new Decoder(msg)))
  }

  handleDown (msg :DownMsg) {
    const obj = this.objects.get(msg.oid)
    if (!obj) throw new Error(`Got msg for unknown object: ${JSON.stringify(msg)}`)
    switch (msg.type) {
    case DownType.SUBOBJ:
      (msg.obj.status as Mutable<DObjectStatus>).update({state: "connected"})
      break
    case DownType.SUBERR:
      (obj.status as Mutable<DObjectStatus>).update({state: "error", error: new Error(msg.cause)})
      break
    default:
      obj.applySync(msg)
      break
    }
  }

  // TODO: when do we dispose connections?

  protected connFor (path :Path) :Subject<Connection> {
    const {locator, conns, connector} = this
    return locator(path).map(addr => {
      let conn = conns.get(addr)
      if (!conn) conns.set(addr, conn = connector(this, addr))
      return conn
    })
  }

  protected sendUp (path :Path, msg :UpMsg) {
    this.connFor(path).once(conn => {
      try {
        encodeUp(msg, this.encoder)
        conn.sendMsg(this.encoder.finish())
      } catch (err) {
        this.encoder.reset()
        // TODO: maybe just log this?
        throw err
      }
    })
  }
}

export abstract class Connection implements Disposable {

  constructor (readonly client :Client, readonly addr :Address) {
    this.connect(addr)
  }

  abstract dispose () :void

  protected abstract connect (addr :Address) :void

  abstract sendMsg (msg :Uint8Array) :void
}
