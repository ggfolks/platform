import {Disposable, Remover, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Record} from "../core/data"
import {Emitter, Mutable, Stream, Subject, Value} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"
import {Decoder} from "../core/codec"
import {SessionAuth, sessionAuth} from "../auth/auth"
import {DataSource, DIndex, DObject, DObjectType, DState, DQueueAddr, Path, PathMap} from "./data"
import {DownMsg, DownType, SyncMsg, SyncType, UpMsg, UpType,
        MsgEncoder, MsgDecoder} from "./protocol"

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
  otype :DObjectType<DObject>
  path :Path,
  state :Mutable<DState>
  objects :MutableMap<UUID, DObject>
  dispose :() => void
}

export class Client implements DataSource, Disposable {
  private readonly conns = new Map<Address, Connection>()
  private readonly objects = new PathMap<DObject>()
  private readonly states = new PathMap<Mutable<DState>>()
  private readonly views = new Map<number,ViewInfo>()
  private readonly resolved = new PathMap<Resolver<DObject>>()
  private readonly encoder = new MsgEncoder()
  private readonly decoder = new MsgDecoder()
  private readonly _errors = new Emitter<string>()
  private readonly _serverAuth = Mutable.local(UUID0)
  private nextVid = 1

  private readonly resolver = {
    getMetas: (path :Path) => {
      const obj = this.objects.get(path)
      return obj ? obj.metas : undefined
    },
    getObject: (path :Path) => this.objects.require(path),
    makeViewObject: (qid :number, id :UUID) => {
      const qinfo = this.views.get(qid)
      if (!qinfo) throw new Error(`Unknown query [qid=${qid}]`)
      const path = qinfo.path.concat(id)
      const state = Mutable.local<DState>("resolving")
      const object = new qinfo.otype(this, path, this.objectState(path, state))
      this.objects.set(path, object)
      return object
    }
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

    if (DebugLog) log.debug("Subscribing", "path", path)
    this.sendUp(path, {type: UpType.SUB, path})
    return nres()
  }

  // TODO: limit, startKey, etc.
  resolveView<T extends DObject> (index :DIndex<T>) :Resolved<RMap<UUID,T>> {
    const path = index.path
    const state = Mutable.local<DState>("resolving")
    const objects = MutableMap.local<UUID, DObject>()

    const vid = this.nextVid
    this.nextVid = vid+1

    const dispose = () => {
      this.sendUp(path, {type: UpType.VUNSUB, vid})
      for (const vobj of objects.values()) {
        const obj = this.objects.get(vobj.path)
        if (obj) {
          this.objects.delete(vobj.path)
          // TODO: transition object state to disposed...
        }
      }
      state.update("disposed")
      this.views.delete(vid)
    }

    const vinfo = {otype: index.collection.otype, path, state, objects, dispose}
    this.views.set(vid, vinfo)
    if (DebugLog) log.debug("Subscribing to index", "path", path, "vid", vid)
    this.sendUp(path, {type: UpType.VSUB, path, index: index.index, vid})
    return [objects as any, dispose]
  }

  post (queue :DQueueAddr, msg :Record) {
    this.sendUp(queue.path, {type: UpType.POST, queue, msg})
  }

  sendSync (obj :DObject, req :SyncMsg) {
    this.sendUp(obj.path, req)
  }

  recvMsg (data :Uint8Array) {
    const msg = this.decoder.decodeDown(this.resolver, new Decoder(data))
    try {
      this.handleDown(msg)
    } catch (err) {
      log.warn("Failed to handle down msg", "msg", msg, err)
    }
  }

  handleDown (msg :DownMsg) {
    if (DebugLog) log.debug("handleDown", "msg", msg)
    switch (msg.type) {
    case DownType.AUTHED:
      this._serverAuth.update(msg.id)
      break

    case DownType.VADD:
    case DownType.VDEL:
    case DownType.VERR:
      const vinfo = this.views.get(msg.vid)
      if (!vinfo) this.reportError(log.format("Message for unknown view", "msg", msg))
      else if (msg.type === DownType.VADD) {
        for (const obj of msg.objs) vinfo.objects.set(obj.key, obj)
      }
      else if (msg.type === DownType.VDEL) {
        const obj = this.objects.get(msg.path)
        if (obj) {
          this.objects.delete(msg.path)
          vinfo.objects.delete(obj.key)
          // TODO: transition object to disposed?
        } else {
          this.reportError(log.format("Missing object for VDEL", "vpath", vinfo.path,
                                      "opath", msg.path))
        }
      }
      else if (msg.type === DownType.VERR) {
        vinfo.state.update("failed")
        this.reportError(log.format("Query failed", "vpath", vinfo.path, "cause", msg.cause))
      }
      break

    case DownType.SOBJ:
      const sstate = this.states.get(msg.obj.path)
      if (sstate) sstate.update("active")
      else this.reportError(log.format("Message for unknown object", "msg", msg))
      break

    case DownType.SERR:
      const estate = this.states.get(msg.path)
      if (estate) {
        estate.update("failed")
        this.reportError(log.format("Subscribe failed", "obj", this.objects.get(msg.path),
                                    "cause", msg.cause))
      } else this.reportError(log.format("Message for unknown object", "msg", msg))
      break

    case SyncType.DECERR:
      log.warn("Failed to decode sync message", "err", msg)
      break

    default:
      const obj = this.objects.get(msg.path)
      if (obj) obj.applySync(msg, true)
      else this.reportError(log.format("Message for unknown object", "msg", msg))
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
    if (conn.state.current === "closed") {
      log.warn("Can't send message on closed connection", "conn", conn, "msg", msg)
    } else {
      conn.state.whenOnce(st => st === "connected", _ => {
        try { conn.sendMsg(this.encoder.encodeUp(msg)) }
        catch (err) { log.warn("Failed to encode message", "msg", msg, err) }
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
