import {Disposable, Disposer, Remover, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Record} from "../core/data"
import {Emitter, Mutable, Stream, Value} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"
import {Decoder} from "../core/codec"
import {SessionAuth, sessionAuth} from "../auth/auth"
import {DataSource, DView, DObject, DObjectType, DState, DQueueAddr, Path, PathMap} from "./data"
import {DownMsg, DownType, SyncMsg, SyncType, UpMsg, UpType,
        MsgEncoder, MsgDecoder} from "./protocol"

const DebugLog = false

/** Creates a server address based on the browser location. */
export function addrFromLocation (path :string) :URL {
  const addr = new URL(window.location.href)
  addr.protocol = (addr.protocol === "https:") ? "wss:" : "ws:"
  if (addr.port === "3000") addr.port = "8080"
  const locpath = addr.pathname
  if (path.startsWith("/")) addr.pathname = path
  else addr.pathname = locpath.substring(0, locpath.lastIndexOf("/")+1) + path
  return addr
}

/** Creates `Connection` instances for clients. */
export type Connector = (client :Client, addr :URL, state :Mutable<CState>) => Connection

export type CState = "connecting" | "connected" | "closed"

export abstract class Connection {
  protected readonly disposer = new Disposer()
  private readonly encoder = new MsgEncoder()
  private readonly decoder = new MsgDecoder()

  constructor (readonly client :Client) {}

  abstract state :Value<CState>

  init () {
    // send our auth info as the first message to this connection and again if it ever changes
    this.disposer.add(this.client.auth.onValue(auth => this.sendMsg({type: UpType.AUTH, ...auth})))
  }

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

  close () {
    this.disposer.dispose()
  }
}

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
  private readonly disposer = new Disposer()
  private readonly cstate = Mutable.local("connecting" as CState)
  private readonly objects = new PathMap<DObject>()
  private readonly states = new PathMap<Mutable<DState>>()
  private readonly views = new PathMap<ViewInfo>()
  private readonly resolved = new PathMap<Resolver<DObject>>()
  private readonly _errors = new Emitter<string>()
  private readonly _serverAuth = Mutable.local(UUID0)

  private reconnectAttempts = 0
  private conn :Connection

  readonly resolver = {
    getMetas: (path :Path) => {
      const obj = this.objects.get(path)
      return obj ? obj.metas : undefined
    },
    getObject: (path :Path) => this.objects.require(path),
  }

  constructor (readonly serverUrl :URL,
               readonly auth :Value<SessionAuth> = sessionAuth,
               readonly connector :Connector = wsConnector) {
    this.disposer.add(this.cstate.onValue(cstate => {
      if (DebugLog) log.debug(`Client connect state: ${cstate}`)
      switch (cstate) {
      case "connected":
        this.reconnectAttempts = 0
        break
      case "closed":
        const reconns = this.reconnectAttempts = this.reconnectAttempts+1
        const delay = Math.pow(2, Math.min(reconns, 9)) // max out at ~10 mins
        log.debug("Scheduling reconnect", "attempt", reconns, "delay", delay)
        const cancel = setTimeout(() => {
          this.conn.close()
          this.conn = connector(this, serverUrl, this.cstate)
          this.conn.init()
        }, delay*1000)
        this.disposer.add(() => clearInterval(cancel))
        break
      }
    }))
    this.conn = connector(this, serverUrl, this.cstate)
    this.conn.init()
  }

  /** The id as which we're authenticated on the server. This should eventually match the id in
    * [[auth]] once the server has acknowledged our auth request. */
  get serverAuth () :Value<UUID> { return this._serverAuth }

  get errors () :Stream<string> { return this._errors }

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :Resolved<T> {
    const res = this.resolved.get(path)
    if (res) return (res as Resolver<T>)()

    if (DebugLog) log.debug("Resolving", "path", path, "otype", otype)
    const state = Mutable.local<DState>("resolving")

    const object = new otype(this, path, state)
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

    const unresub = this.cstate.onValue(cstate => {
      switch (cstate) {
      case "closed":
        state.update("disconnected")
        break
      case "connected":
        if (DebugLog) log.debug("Subscribing", "path", path)
        this.sendUp(path, {type: UpType.SUB, path})
        break
      }
    })
    state.whenOnce(s => s === "disposed", _ => unresub())

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

    const unresub = this.cstate.onValue(cstate => {
      switch (cstate) {
      case "closed":
        state.update("disconnected")
        break
      case "connected":
        if (DebugLog) log.debug("Subscribing to view", "path", path)
        this.sendUp(path, {type: UpType.VSUB, path})
        break
      }
    })
    state.whenOnce(s => s === "disposed", _ => unresub())

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
        this.reportError(log.format("Subscribe failed", "path", msg.path,
                                    "obj", this.objects.get(msg.path), "cause", msg.cause))
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
    this.disposer.dispose()
    this.conn.close()
  }

  protected sendUp (path :Path, msg :UpMsg) {
    if (DebugLog) log.debug("sendUp", "path", path, "msg", msg);
    this.conn.sendMsg(msg)
  }
}

class WSConnection extends Connection {
  private readonly ws :WebSocket

  constructor (client :Client, addr :URL, readonly state :Mutable<CState>) {
    super(client)
    log.info("Connecting", "addr", addr)
    state.update("connecting")
    const ws = this.ws = new WebSocket(addr.href)
    this.disposer.add(() => ws.close())
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
  toString() { return this.ws.url }
}

/** Creates websocket connections to the supplied `addr`, for `client`. */
export const wsConnector :Connector = (client, addr, state) => new WSConnection(client, addr, state)
