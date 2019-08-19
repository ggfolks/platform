import {Remover, NoopRemover, log} from "../core/util"
import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Record} from "../core/data"
import {Mutable, Subject, Value} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {CollectionMeta, getPropMetas} from "./meta"
import {Auth, AutoKey, DataSource, DKey, DObject, DObjectType, DQueueAddr, MetaMsg, Path,
        Subscriber, findObjectType, pathToKey} from "./data"
import {DownType, DownMsg, UpType, SyncMsg, decodeUp, encodeDown} from "./protocol"

import WebSocket from "ws"

const sysAuth :Auth = {id: UUID0, isSystem: true}

const DebugLog = false

export class DataStore {
  private readonly objects = new Map<string, DObject>()
  private readonly counters = new Map<string, number>()

  readonly source :DataSource = {
    create: (path, cprop, key, otype, ...args) => this.create(sysAuth, path, cprop, key, ...args),
    resolve: (path, otype) => this.resolve(path),
    post: (queue, msg) => this.post(sysAuth, queue, msg),
    // nothing to do here, this would only be used if we were proxying the object from some other
    // server, but we're the source of truth for `obj`
    sendSync: (obj, msg) => {}
  }

  constructor (readonly rtype :DObjectType<any>) {
    // create the root object
    this.objects.set("", new rtype(this.source, [], 0))
  }

  create (auth :Auth, path :Path, cprop :string, key :DKey, ...args :any[]) :Subject<DKey|Error> {
    return this.resolve(path).switchMap(res => {
      try {
        if (res instanceof Error) throw new Error(
          `Unable to resolve parent object for create ${JSON.stringify({path, cprop, key, res})}`)
        if (!res.canSubscribe(auth) || !res.canCreate(cprop, auth)) this.authFail(
          `Create check failed [auth=${auth}, obj=${res}, prop=${cprop}]`)
        const cmeta = res.metas.find(m => m.name === cprop)
        if (!cmeta) throw new Error(
          `Cannot create object in unknown collection [path=${path}, cprop=${cprop}]`)
        if (cmeta.type !== "collection") throw new Error(
          `Cannot create object in non-collection property [path=${path}, cprop=${cprop}]`)
        const gkey = key === AutoKey ? this._generateKey(path, cmeta, cprop) : key
        const opath = path.concat([cprop, gkey]), okey = pathToKey(opath)
        if (this.objects.has(okey)) throw new Error(`Object already exists at path '${opath}'`)
        return Subject.deriveSubject<DKey|Error>(disp => {
          const obj = this.objects.get(okey)
          if (obj) disp(gkey)
          else {
            const otype = findObjectType(this.rtype, opath)
            const nobj = new otype(this.source, opath, ...args)
            this.objects.set(okey, nobj)
            this.postMeta(nobj, {type: "created"})
            disp(gkey)
          }
          return NoopRemover
        })
      } catch (err) {
        return Subject.constant(err)
      }
    })
  }

  _generateKey (path :Path, meta :CollectionMeta, cprop :string) :DKey {
    switch (meta.autoPolicy) {
    case "noauto":
      throw new Error(
        `Cannot auto generate key for 'noauto' collection [path=${path}, cprop=${cprop}]`)
    case "sequential":
      const ckey = pathToKey(path.concat([cprop]))
      const next = this.counters.get(ckey) || 1
      this.counters.set(ckey, next+1)
      return next
    case "uuid":
      return uuidv1()
    default:
      throw new Error(
        `Unknown auto-gen policy [path=${path}, cprop=${cprop}, policy='${meta.autoPolicy}']`)
    }
  }

  resolve<T extends DObject> (path :Path) :Subject<T|Error> {
    const key = pathToKey(path)
    return Subject.deriveSubject<T|Error>(disp => {
      const obj = this.objects.get(key)
      if (obj) disp(obj as T)
      else disp(new Error(`No object at path '${path}'`))
      return NoopRemover
    })
  }

  post (auth :Auth, queue :DQueueAddr, msg :Record) {
    // TODO: keep the object around for a bit instead of letting it immediately get unresolved after
    // our queue message is processed...
    this.resolve<DObject>(queue.path).once(res => {
      try {
        if (res instanceof Error) throw res
        const meta = res.metas[queue.index]
        if (meta.type !== "queue") throw new Error(`Not a queue prop at path [type=${meta.type}]`)
        // TODO: check canSubscribe permission?
        meta.handler(res, msg, auth)
      } catch (err) {
        log.warn("Failed to post", "auth", auth, "queue", queue, "msg", msg, err)
      }
    })
  }

  postMeta (obj :DObject, msg :MetaMsg) {
    const metas = getPropMetas(Object.getPrototypeOf(obj))
    const meta = metas.find(m => m.name === "metaq")
    if (!meta) return
    if (meta.type !== "queue") {
      log.warn("Expected 'queue' type for 'metaq' property", "type", meta.type, "obj", obj)
      return
    }
    try {
      meta.handler(obj, msg, sysAuth)
    } catch (err) {
      log.warn("Failed to post meta", "obj", obj, "msg", msg, err)
    }
  }

  sync (auth :Auth, obj :DObject, msg :SyncMsg) {
    const name = obj.metas[msg.idx].name
    if (obj.canRead(name, auth) || !obj.canWrite(name, auth)) obj.applySync(msg, false)
    else this.authFail(`Write rejected [auth=${auth}, obj=${obj}, prop=${name}]`)
  }

  protected authFail (msg :string) :never {
    log.warn(msg)
    throw new Error(`Access denied.`)
  }
}

interface Subscription extends Subscriber {
  obj :DObject
  unsub :Remover
}

export abstract class Session {
  private readonly subscrips = new Map<number, Subscription>()
  private readonly encoder = new Encoder()
  private readonly resolver = {
    get: (oid :number) => {
      const sub = this.subscrips.get(oid)
      if (sub) return sub.obj
      else throw new Error(`Unknown object ${oid}`)
    },
  }

  readonly auth :Auth

  // TODO: maybe the session should handle auth?
  constructor (readonly store :DataStore, readonly id :UUID) {
    this.auth = {id, isSystem: false}
  }

  handleMsg (msgData :Uint8Array) {
    const msg = decodeUp(this.resolver, new Decoder(msgData))
    if (DebugLog) log.debug("handleMsg", "msg", msg)
    switch (msg.type) {
    case UpType.SUB:
      const sendErr = (err :Error) => this.sendDown({
        type: DownType.SUBERR, oid: msg.oid, cause: err.message})
      this.store.resolve(msg.path).onValue(res => {
        if (res instanceof Error) sendErr(res)
        else {
          const oid = msg.oid
          const sendSync = (msg :SyncMsg) => this.sendDown({...msg, oid})
          const sub = {obj: res, unsub: NoopRemover, auth: this.auth, sendSync}
          const unsub = res.subscribe(sub)
          if (!unsub) sendErr(new Error("Access denied."))
          else {
            sub.unsub = () => {
              this.store.postMeta(res, {type: "unsubscribed", id: this.id})
              unsub()
            }
            this.subscrips.set(oid, sub)
            this.sendDown({type: DownType.SUBOBJ, oid, obj: res})
            this.store.postMeta(res, {type: "subscribed", id: this.id})
          }
        }
      })
      break

    case UpType.UNSUB:
      const sub = this.subscrips.get(msg.oid)
      if (sub) {
        sub.unsub()
        this.subscrips.delete(msg.oid)
      }
      break

    case UpType.POST:
      this.store.post(this.auth, msg.queue, msg.msg)
      break

    default:
      const oid = msg.oid
      const ssub = this.subscrips.get(oid)
      if (ssub) this.store.sync(this.auth, ssub.obj, msg)
      else log.warn("Dropping sync message, no subscription", "msg", msg)
    }
  }

  sendDown (msg :DownMsg) {
    try {
      encodeDown(this.auth, msg, this.encoder)
    } catch (err) {
      this.encoder.reset()
      log.warn("Failed to encode", "msg", msg, err)
      return
    }
    this.sendMsg(this.encoder.finish())
  }

  abstract sendMsg (msg :Uint8Array) :void

  dispose () {
    for (const sub of this.subscrips.values()) sub.unsub()
    this.subscrips.clear()
  }
}

type ServerConfig = {
  port? :number
}

type SessionState = "connecting" | "open" | "closed"

class WSSession extends Session {
  private readonly _state = Mutable.local("connecting" as SessionState)

  constructor (store :DataStore, readonly addr :string, readonly ws :WebSocket) {
    super(store, uuidv1()) // TODO: auth

    ws.on("open", () => this._state.update("open"))
    ws.on("message", msg => {
      // TODO: do we need to check readyState === CLOSING and drop late messages?
      if (msg instanceof ArrayBuffer) this.handleMsg(new Uint8Array(msg))
      else log.warn("Got non-binary message", "sess", this, "msg", msg)
    })
    ws.on("close", (code, reason) => {
      log.info("Session closed", "code", code, "reason", reason)
      this._state.update("closed")
    })
    ws.on("error", error => {
      log.info("Session failed", "error", error)
      this._state.update("closed")
    })
    // TODO: ping/pong & session timeout

    log.info("Session started", "addr", addr, "id", this.id)
  }

  get state () :Value<SessionState> { return this._state }

  sendMsg (msg :Uint8Array) {
    this.ws.send(msg, err => {
      if (err) log.warn("Message send failed", "sess", this, err) // TODO: terminate?
    })
  }

  close () {
    this.dispose()
    this.ws.terminate()
  }

  toString () {
    return `${this.id}/${this.addr}`
  }
}

export type ServerState = "initializing" | "listening" | "terminating" | "terminated"

export class Server {
  private readonly wss :WebSocket.Server
  private readonly sessions = new Set<WSSession>()
  private readonly _state = Mutable.local("initializing" as ServerState)

  constructor (readonly store :DataStore, config :ServerConfig = {}) {
    // TODO: eventually we'll piggy back on a separate web server
    const port = config.port || 8080
    const wss = this.wss = new WebSocket.Server({port})
    wss.on("listening", () => {
      this._state.update("listening")
      log.info("Listening for connections", "port", port)
    })
    wss.on("connection", (ws, req) => {
      ws.binaryType = "arraybuffer"
      // if we have an x-forwarded-for header, use that to get the client's IP
      const xffs = req.headers["x-forwarded-for"], xff = Array.isArray(xffs) ? xffs[0] : xffs
      // parsing "X-Forwarded-For: <client>, <proxy1>, <proxy2>, ..."
      const addr = (xff ? xff.split(/\s*,\s*/)[0] : req.connection.remoteAddress) || "<unknown>"
      const sess = new WSSession(this.store, addr, ws)
      this.sessions.add(sess)
      sess.state.when(ss => ss === "closed", () => this.sessions.delete(sess))
    })
    wss.on("error", error => log.warn("Server error", error)) // TODO: ?
  }

  get state () :Value<ServerState> { return this._state }

  shutdown () {
    this._state.update("terminating")
    for (const sess of this.sessions) sess.close()
    this.wss.close(() => this._state.update("terminated"))
  }
}
