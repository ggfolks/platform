import {Disposable, Remover, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Record} from "../core/data"
import {Emitter, Mutable, Stream, Subject, Value} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"
import {Decoder} from "../core/codec"
import {SessionAuth, sessionAuth} from "../auth/auth"
import {DataSource, DView, DObject, DObjectType, DState, DQueueAddr, Path, PathMap} from "./data"
import {DownMsg, DownType, SyncMsg, SyncType, UpMsg, UpType,
        MsgEncoder, MsgDecoder} from "./protocol"

const DebugLog = false

/** Uniquely identifies a data server; provides the info needed to establish a connection to it. */
export type Address = {host :string, port :number, secure: boolean, path :string}

/** Converts `addr` to a WebSocket URL. */
export function addrToURL (addr :Address) :string {
  const pcol = addr.secure ? "wss" : "ws"
  return `${pcol}:${addr.host}:${addr.port}/${addr.path}`
}

/** Resolves the address of the server that hosts the object at `path`. */
export type Locator = (path :Path) => Subject<Address>

/** Creates `Connection` instances for clients. */
export type Connector = (client :Client, addr :Address) => Connection

export type Resolved<T> = [T, Remover]

type Resolver<T> = () => Resolved<T>
function objectRef<T extends DObject> (object :T, release :Remover) :Resolver<T> {
  let refs = 0
  return () => {
    refs += 1
    return [object, () => { refs -= 1 ; if (refs == 0) release() }]
  }
}

type ViewInfo = {
  path :Path,
  state :Mutable<DState>
  records :MutableMap<UUID, Record>
  dispose :() => void
}

export class Client implements DataSource, Disposable {
  private readonly conns = new Map<Address, Connection>()
  private readonly objects = new PathMap<DObject>()
  private readonly states = new PathMap<Mutable<DState>>()
  private readonly views = new PathMap<ViewInfo>()
  private readonly resolved = new PathMap<Resolver<DObject>>()
  private readonly _errors = new Emitter<string>()
  private readonly _serverAuth = Mutable.local(UUID0)

  readonly resolver = {
    getMetas: (path :Path) => {
      const obj = this.objects.get(path)
      return obj ? obj.metas : undefined
    },
    getObject: (path :Path) => this.objects.require(path),
  }

  constructor (readonly locator :Locator,
               readonly auth :Value<SessionAuth> = sessionAuth,
               readonly connector :Connector = wsConnector) {}

  /** The id as which we're authenticated on the server. This should eventually match the id in
    * [[auth]] once the server has acknowledged our auth request. */
  get serverAuth () :Value<UUID> { return this._serverAuth }

  get errors () :Stream<string> { return this._errors }

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :Resolved<T> {
    const res = this.resolved.get(path)
    if (res) return (res as Resolver<T>)()

    if (DebugLog) log.debug("Resolving", "path", path, "otype", otype)
    const state = Mutable.local<DState>("resolving")
    const object = new otype(this, path, this.objectState(path, state))
    const nres = objectRef(object, () => {
      if (DebugLog) log.debug("Unsubscribing", "path", path)
      this.sendUp(path, {type: UpType.UNSUB, path})
      this.resolved.delete(path)
      this.objects.delete(path)
      state.update("disposed")
    })
    this.resolved.set(path, nres)
    this.objects.set(path, object)
    this.states.set(path, state)

    this.sendUp(path, {type: UpType.SUB, path})
    return nres()
  }

  // TODO: limit, startKey, etc.
  resolveView<T extends Record> (view :DView<T>) :Resolved<RMap<UUID,T>> {
    const path = view.path
    const state = Mutable.local<DState>("resolving")
    const records = MutableMap.local<UUID, Record>()

    const dispose = () => {
      this.sendUp(path, {type: UpType.VUNSUB, path})
      state.update("disposed")
      this.views.delete(path)
    }

    const vinfo = {path, state, records, dispose}
    this.views.set(path, vinfo)
    if (DebugLog) log.debug("Subscribing to view", "path", path)
    this.sendUp(path, {type: UpType.VSUB, path})
    return [records as any, dispose] // coerce Record => T
  }

  createRecord (path :Path, key :UUID, data :Record) {
    this.sendUp(path, {type: UpType.TADD, path, key, data})
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    this.sendUp(path, {type: UpType.TSET, path, key, data, merge})
  }
  deleteRecord (path :Path, key :UUID) {
    this.sendUp(path, {type: UpType.TDEL, path, key})
  }

  post (queue :DQueueAddr, msg :Record) {
    this.sendUp(queue.path, {type: UpType.POST, queue, msg})
  }

  sendSync (obj :DObject, req :SyncMsg) {
    this.sendUp(obj.path, req)
  }

  handleDown (msg :DownMsg) {
    try {
      if (DebugLog) log.debug("handleDown", "msg", msg)
      switch (msg.type) {
      case DownType.AUTHED:
        this._serverAuth.update(msg.id)
        break

      case DownType.VSET:
        const svinfo = this.views.require(msg.path)
        for (const rec of msg.recs) svinfo.records.set(rec.key, rec.data)
        break
      case DownType.VDEL:
        const dvinfo = this.views.require(msg.path)
        dvinfo.records.delete(msg.key)
        break
      case DownType.VERR:
        const evinfo = this.views.require(msg.path)
        evinfo.state.update("failed")
        this.reportError(log.format("Query failed", "vpath", evinfo.path, "cause", msg.cause))
        break

      case DownType.SOBJ:
        const sstate = this.states.require(msg.obj.path)
        sstate.update("active")
        break
      case DownType.SERR:
        const estate = this.states.require(msg.path)
        estate.update("failed")
        this.reportError(log.format("Subscribe failed", "obj", this.objects.get(msg.path),
                                    "cause", msg.cause))
        break

      case SyncType.DECERR:
        log.warn("Failed to decode sync message", "err", msg)
        break

      default:
        const obj = this.objects.require(msg.path)
        obj.applySync(msg, true)
      }

    } catch (error) {
      log.warn("Failed to handle down msg", "msg", msg, error)
    }
  }

  reportError (msg :string) {
    console.warn(msg)
    this._errors.emit(msg)
  }

  dispose () {
    for (const conn of this.conns.values()) conn.close()
  }

  // TODO: when do we dispose connections?

  protected objectState (path :Path, ostate :Value<DState>) :Value<DState> {
    const sstate = Value.switch(this.connFor(path).map(c => c.state.map(cstateToDState)).
                                fold(Value.constant<DState>("resolving"), (os, ns) => ns))
    return Value.join2(sstate, ostate).map(([ss, os]) => ss === "disconnected" ? ss : os)
  }

  protected connFor (path :Path) :Subject<Connection> {
    const {locator, conns, connector} = this
    return locator(path).map(addr => {
      const conn = conns.get(addr)
      if (conn) return conn
      const nconn = connector(this, addr)
      conns.set(addr, nconn)
      // send our auth info as the first message to this connection and again if it ever changes
      const unauth = this.auth.onValue(auth => {
        this.sendUpVia(nconn, [], {type: UpType.AUTH, ...auth})
      })
      // when the connection closes, clean up after it
      nconn.state.when(cs => cs === "closed", _ => {
        unauth()
        conns.delete(addr)
      })
      return nconn
    })
  }

  protected sendUp (path :Path, msg :UpMsg) {
    this.connFor(path).once(conn => this.sendUpVia(conn, path, msg))
  }

  protected sendUpVia (conn :Connection, path :Path, msg :UpMsg) {
    if (DebugLog) log.debug("sendUp", "path", path, "msg", msg);
    conn.sendMsg(msg)
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
  private readonly encoder = new MsgEncoder()
  private readonly decoder = new MsgDecoder()

  constructor (readonly client :Client) {}

  abstract state :Value<CState>

  sendMsg (msg :UpMsg) {
    switch (this.state.current) {
    case "closed":
      log.warn("Can't send on closed connection", "conn", this, "msg", msg)
      break
    case "connected":
      try { this.sendRawMsg(this.encoder.encodeUp(msg)) }
      catch (err) { log.warn("Failed to encode message", "msg", msg, err) }
      break
    default:
      this.state.whenOnce(st => st === "connected", _ => this.sendMsg(msg))
      break
    }
  }

  recvMsg (data :Uint8Array) {
    const msg = this.decoder.decodeDown(this.client.resolver, new Decoder(data))
    try {
      this.client.handleDown(msg)
    } catch (err) {
      log.warn("Failed to handle down msg", "msg", msg, err)
    }
  }

  abstract sendRawMsg (msg :Uint8Array) :void
  abstract close () :void
}

class WSConnection extends Connection {
  private readonly ws :WebSocket
  readonly state = Mutable.local("connecting" as CState)

  constructor (client :Client, addr :Address) {
    super(client)
    if (DebugLog) log.debug("Connecting", "addr", addr)
    const ws = this.ws = new WebSocket(addrToURL(addr))
    ws.binaryType = "arraybuffer"
    ws.addEventListener("open", ev => {
      this.state.update("connected")
      if (DebugLog) log.debug("Connected", "addr", addr)
    })
    ws.addEventListener("message", ev => this.recvMsg(new Uint8Array(ev.data)))
    ws.addEventListener("error", ev => {
      client.reportError(log.format("WebSocket error", "url", ws.url, "ev", ev))
      this.state.update("closed")
    })
    ws.addEventListener("close", ev => {
      this.state.update("closed")
    })
  }

  sendRawMsg (msg :Uint8Array) { this.ws.send(msg) }
  close () { this.ws.close() }
  toString() { return this.ws.url }
}

/** Creates websocket connections to the supplied `addr`, for `client`. */
export const wsConnector :Connector = (client, addr) => new WSConnection(client, addr)
