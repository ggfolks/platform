import {Disposable, Remover, log} from "../core/util"
import {UUID} from "../core/uuid"
import {Record} from "../core/data"
import {Emitter, Mutable, Stream, Subject, Value} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {DataSource, DObject, DObjectType, DState, DQueueAddr, Path, pathToKey} from "./data"
import {DownMsg, DownType, UpMsg, UpType, encodeUp, decodeDown} from "./protocol"

const DebugLog = false

/** Uniquely identifies a data server; provides the info needed to establish a connection to it. */
export type Address = {host :string, port :number, path :string}

/** Converts `addr` to a WebSocket URL. */
export function addrToURL (addr :Address) :string {
  const pcol = addr.host === "localhost" ? "ws" : "wss"
  return `${pcol}:${addr.host}:${addr.port}/${addr.path}`
}

/** Resolves the address of the server that hosts the object at `path`. */
export type Locator = (path :Path) => Subject<Address>

/** Provides authentication information when connecting to a server. */
export type AuthInfo = {id :UUID, token :string}

/** Creates `Connection` instances for clients. */
export type Connector = (client :Client, addr :Address) => Connection

export type Resolved<T> = [T, Remover]

type ObjectInfo = {object :DObject, state :Mutable<DState>}
type Resolver<T> = () => Resolved<T>
function objectRef<T extends DObject> (object :T, release :Remover) :Resolver<T> {
  let refs = 0
  return () => {
    refs += 1
    return [object, () => { refs -= 1 ; if (refs == 0) release() }]
  }
}

export class Client implements Disposable {
  private readonly conns = new Map<Address, Connection>()
  private readonly objects = new Map<number,ObjectInfo>()
  private readonly resolved = new Map<string,Resolver<DObject>>()
  private readonly encoder = new Encoder()
  private readonly _errors = new Emitter<string>()
  private nextOid = 1

  private readonly resolver = {
    get: (oid :number) => {
      const obj = this.objects.get(oid)
      if (obj) return obj.object
      else throw new Error(`Unknown object [oid=${oid}]`)
    }
  }

  constructor (readonly locator :Locator, readonly auth :AuthInfo,
               readonly connector :Connector = wsConnector) {}

  get errors () :Stream<string> { return this._errors }

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :Resolved<T> {
    const key = pathToKey(path), status = this.resolved.get(key)
    if (status) return (status as Resolver<T>)()

    const oid = this.nextOid
    this.nextOid = oid+1
    const source :DataSource = {
      state: Value.switch(this.connFor(path).map(c => c.state.map(cstateToDState)).
                          fold(Value.constant<DState>("resolving"), (os, ns) => ns)),
      // resolve: (path, otype) => this.resolve(path, otype),
      post: (queue, msg) => this.post(queue, msg),
      sendSync: (obj, req) => this.sendUp(obj.path, {...req, oid})
    }

    const sstate = source.state, ostate = Mutable.local<DState>("resolving")
    const state = Value.join2(sstate, ostate).map(([ss, os]) => ss === "disconnected" ? ss : os)
    const object = new otype(source, path, state)
    const nstatus = objectRef(object, () => {
      if (DebugLog) log.debug("Unsubscribing", "path", path, "oid", oid)
      this.sendUp(path, {type: UpType.UNSUB, oid})
      this.resolved.delete(key)
      this.objects.delete(oid)
      ostate.update("disposed")
    })
    this.resolved.set(key, nstatus)
    this.objects.set(oid, {object, state: ostate})

    if (DebugLog) log.debug("Subscribing", "path", path, "oid", oid)
    this.sendUp(path, {type: UpType.SUB, path, oid})
    return nstatus()
  }

  post (queue :DQueueAddr, msg :Record) {
    this.sendUp(queue.path, {type: UpType.POST, queue, msg})
  }

  recvMsg (data :Uint8Array) {
    let msg :DownMsg
    try {
      msg = decodeDown(this.resolver, new Decoder(data))
    } catch (err) {
      // if we get a sync message for an unknown object, ignore it; our UNSUB message can cross paths
      // in flight with sync messages from the server and it would be pointless extra work to keep
      // receiving and applying syncs until we know that our UNSUB has been received by the server
      if (!err.message.startsWith("Unknown object")) log.warn(
        "Failed to decode down msg", "size", data.length, err)
      return
    }
    try {
      this.handleDown(msg)
    } catch (err) {
      log.warn("Failed to handle down msg", "msg", msg, err)
    }
  }

  handleDown (msg :DownMsg) {
    if (DebugLog) log.debug("handleDown", "msg", msg)
    const info = this.objects.get(msg.oid)
    if (!info) this.reportError(log.format("Message for unknown object", "msg", msg))
    else if (msg.type === DownType.SUBOBJ) info.state.update("active")
    else if (msg.type === DownType.SUBERR) {
      info.state.update("failed")
      this.reportError(log.format("Subscribe failed", "obj", info.object, "cause", msg.cause))
    } else info.object.applySync(msg)
  }

  reportError (msg :string) {
    console.warn(msg)
    this._errors.emit(msg)
  }

  dispose () {
    for (const conn of this.conns.values()) conn.close()
  }

  // TODO: when do we dispose connections?

  protected connFor (path :Path) :Subject<Connection> {
    const {locator, conns, connector} = this
    return locator(path).map(addr => {
      const conn = conns.get(addr)
      if (conn) return conn
      const nconn = connector(this, addr)
      nconn.state.when(cs => cs === "closed", _ => conns.delete(addr))
      conns.set(addr, nconn)
      // send our auth info as the first message to this connection
      this.sendUpVia(nconn, [], {type: UpType.AUTH, ...this.auth})
      return nconn
    })
  }

  protected sendUp (path :Path, msg :UpMsg) {
    this.connFor(path).once(conn => this.sendUpVia(conn, path, msg))
  }

  protected sendUpVia (conn :Connection, path :Path, msg :UpMsg) {
    if (DebugLog) log.debug("sendUp", "path", path, "msg", msg);
    if (conn.state.current === "closed") {
      log.warn("Can't send message on closed connection", "conn", conn, "msg", msg)
    } else {
      conn.state.whenOnce(st => st === "connected", _ => {
        try {
          encodeUp(msg, this.encoder)
          conn.sendMsg(this.encoder.finish())
        } catch (err) {
          this.encoder.reset()
          log.warn("Failed to encode message", "msg", msg, err)
        }
      })
    }
  }
}

export type CState = "connecting" | "connected" | "closed"

function cstateToDState (cstate :CState) :DState {
  switch (cstate) {
  case "connecting": return "active"
  case "connected": return "active"
  case "closed": return "disconnected"
  }
}

export abstract class Connection {
  abstract state :Value<CState>
  abstract sendMsg (msg :Uint8Array) :void
  abstract close () :void
}

class WSConnection extends Connection {
  private readonly ws :WebSocket
  readonly state = Mutable.local("connecting" as CState)

  constructor (client :Client, addr :Address) {
    super()
    const ws = this.ws = new WebSocket(addrToURL(addr))
    ws.binaryType = "arraybuffer"
    ws.addEventListener("open", ev => {
      this.state.update("connected")
    })
    ws.addEventListener("message", ev => {
      client.recvMsg(new Uint8Array(ev.data))
    })
    ws.addEventListener("error", ev => {
      client.reportError(log.format("WebSocket error", "url", ws.url, "ev", ev))
      this.state.update("closed")
    })
    ws.addEventListener("close", ev => {
      this.state.update("closed")
    })
  }

  sendMsg (msg :Uint8Array) { this.ws.send(msg) }
  close () { this.ws.close() }
  toString() { return this.ws.url }
}

/** Creates websocket connections to the supplied `addr`, for `client`. */
export const wsConnector :Connector = (client, addr) => new WSConnection(client, addr)
