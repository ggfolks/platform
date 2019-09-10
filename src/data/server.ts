import {Remover, log} from "../core/util"
import {UUID0, setRandomSource} from "../core/uuid"
import {Record} from "../core/data"
import {Mutable, Subject, Value} from "../core/react"
import {RSet, MutableSet} from "../core/rcollect"
import {Encoder, Decoder} from "../core/codec"
import {getPropMetas} from "./meta"
import {Auth, DObject, DObjectType, DState, DQueueAddr, MetaMsg, Path,
        findObjectType, pathToKey} from "./data"
import {DownType, DownMsg, UpMsg, UpType, SyncMsg, decodeUp, encodeDown} from "./protocol"

import WebSocket from "ws"

import * as crypto from "crypto"
setRandomSource(array => crypto.randomFillSync(Buffer.from(array.buffer)))

const DebugLog = false

export const sysAuth :Auth = {id: UUID0, isSystem: true}

interface Subscriber {
  auth :Auth
  sendSync (msg :SyncMsg) :void
}

export class Resolved {
  readonly state = Mutable.local<DState>("resolving")
  readonly subscribers :Subscriber[] = []
  readonly object :DObject

  constructor (readonly store :DataStore, path :Path, otype :DObjectType<any>) {
    this.object = new otype({
      state: store.state,
      post: (queue, msg) => this.store.post(sysAuth, queue, msg),
      sendSync: (obj, msg, persist) => this.sendSync(msg, persist)
    }, path, this.state)
  }

  subscribe (sub :Subscriber) :Subject<DObject|Error> {
    return Subject.deriveSubject(disp => {
      // wait for object to be active before we do canSubscribe check
      this.object.state.whenOnce(s => s === "active", _ => {
        if (!this.object.canSubscribe(sub.auth)) disp(new Error("Access denied."))
        else {
          this.subscribers.push(sub)
          disp(this.object)
        }
      })
      return () => {
        const idx = this.subscribers.indexOf(sub)
        if (idx >= 0) this.subscribers.splice(idx, 1)
      }
    })
  }

  resolveData () {
    // default implementation doesn't resolve anything
    this.resolvedData()
  }

  resolvedData () {
    this.state.update("active")
    this.store.postMeta(this.object, {type: "created"})
  }

  sendSync (msg :SyncMsg, persist :boolean) {
    const obj = this.object, name = obj.metas[msg.idx].name
    for (const sub of this.subscribers) if (obj.canRead(name, sub.auth)) sub.sendSync(msg)
  }
}

export class DataStore {
  // TODO: flush and unload objects with no subscribers after some idle timeout
  private readonly resolved = new Map<string,Resolved>()

  // the server datastore is always connected (unlike the client) (TODO: is this true, maybe there
  // will be times when the server datastore is also disconnected?)
  readonly state = Value.constant<DState>("active")

  constructor (readonly rtype :DObjectType<any>) {}

  resolve (path :Path) :Resolved {
    const key = pathToKey(path), res = this.resolved.get(key)
    if (res) return res

    if (DebugLog) log.debug("Creating object", "path", path)
    // TODO: if we need to create a non-existent object, potentially check with the parent object
    // that the resolver (will need to pass auth into this method) is allowed to create
    const nres = this.createResolved(path, findObjectType(this.rtype, path))
    this.resolved.set(key, nres)
    return nres
  }

  post (auth :Auth, queue :DQueueAddr, msg :Record) {
    const object = this.resolve(queue.path).object
    object.state.whenOnce(s => s === "active", s => {
      try {
        const meta = object.metas[queue.index]
        if (meta.type !== "queue") throw new Error(`Not a queue prop at path [type=${meta.type}]`)
        // TODO: check canSubscribe permission?
        meta.handler(object, msg, auth)
      } catch (err) {
        log.warn("Failed to post", "auth", auth, "queue", queue, "msg", msg, err)
      }
    })
  }

  postMeta (obj :DObject, msg :MetaMsg) {
    if (DebugLog) log.debug("postMeta", "obj", obj, "msg", msg)
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

  upSync (auth :Auth, obj :DObject, msg :SyncMsg) {
    const name = obj.metas[msg.idx].name
    if (obj.canRead(name, auth) || !obj.canWrite(name, auth)) obj.applySync(msg, false)
    else this.authFail(`Write rejected [auth=${auth}, obj=${obj}, prop=${name}]`)
  }

  protected authFail (msg :string) :never {
    log.warn(msg)
    throw new Error(`Access denied.`)
  }

  protected createResolved (path :Path, otype :DObjectType<any>) :Resolved {
    return new Resolved(this, path, otype)
  }
}

export abstract class Session {
  private readonly subscrips = new Map<number, {object :DObject, release :Remover}>()
  private readonly encoder = new Encoder()
  private readonly resolver = {
    get: (oid :number) => {
      const sub = this.subscrips.get(oid)
      if (sub) return sub.object
      else throw new Error(`Unknown object ${oid}`)
    }
  }
  private _auth :Auth|undefined = undefined

  // TODO: maybe the session should handle auth?
  constructor (readonly store :DataStore) {}

  get auth () :Auth {
    if (this._auth) return this._auth
    throw new Error(`Session not yet authed [sess=${this}]`)
  }

  recvMsg (msgData :Uint8Array) {
    let msg :UpMsg
    try {
      msg = decodeUp(this.resolver, new Decoder(msgData))
    } catch (err) {
      log.warn("Failed to decode message", "sess", this, "data", msgData, err)
      return
    }
    try {
      this.handleMsg(msg)
    } catch (err) {
      log.warn("Failed to handle message", "sess", this, "msg", msg, err)
    }
  }

  sendDown (msg :DownMsg) {
    try {
      encodeDown(this.auth, msg, this.encoder)
    } catch (err) {
      this.encoder.reset()
      log.warn("Failed to encode", "sess", this, "msg", msg, err)
      return
    }
    this.sendMsg(this.encoder.finish())
  }

  dispose () {
    for (const sub of this.subscrips.values()) sub.release()
  }

  protected handleMsg (msg :UpMsg) {
    if (DebugLog) log.debug("handleMsg", "sess", this, "msg", msg)
    switch (msg.type) {
    case UpType.AUTH:
      // TODO: validate auth token
      this._auth = {id: msg.id, isSystem: false}
      log.info("Session authed", "sess", this)
      break
    case UpType.SUB:
      const res = this.store.resolve(msg.path), oid = msg.oid
      const rsub = res.subscribe({auth: this.auth, sendSync: msg => this.sendDown({...msg, oid})})
      const unsub = rsub.onValue(res => {
        if (res instanceof Error) this.sendDown({type: DownType.SUBERR, oid, cause: res.message})
        else {
          this.subscrips.set(oid, {object: res, release: () => {
            unsub()
            this.store.postMeta(res, {type: "unsubscribed", id: this.auth.id})
            this.subscrips.delete(oid)
          }})
          this.sendDown({type: DownType.SUBOBJ, oid, obj: res})
          this.store.postMeta(res, {type: "subscribed", id: this.auth.id})
        }
      })
      break

    case UpType.UNSUB:
      const sub = this.subscrips.get(msg.oid)
      if (sub) sub.release()
      break

    case UpType.POST:
      this.store.post(this.auth, msg.queue, msg.msg)
      break

    default:
      const ssub = this.subscrips.get(msg.oid)
      if (ssub) this.store.upSync(this.auth, ssub.object, msg)
      else log.warn("Dropping sync message, no subscription", "sess", this, "msg", msg)
    }
  }

  toString () {
    return `${this._auth ? this._auth.id : "<unauthed>"}`
  }

  protected abstract sendMsg (msg :Uint8Array) :void
}

type ServerConfig = {
  port? :number
}

type SessionState = "connecting" | "open" | "closed"

class WSSession extends Session {
  private readonly _state = Mutable.local("connecting" as SessionState)

  constructor (store :DataStore, readonly addr :string, readonly ws :WebSocket) {
    super(store)

    const onOpen = () => this._state.update("open")
    if (ws.readyState === WebSocket.OPEN) onOpen()
    else ws.on("open", onOpen)

    ws.on("message", msg => {
      // TODO: do we need to check readyState === CLOSING and drop late messages?
      if (msg instanceof ArrayBuffer) this.recvMsg(new Uint8Array(msg))
      else log.warn("Got non-binary message", "sess", this, "msg", msg)
    })
    ws.on("close", (code, reason) => {
      log.info("Session closed", "sess", this, "code", code, "reason", reason)
      this.didClose()
    })
    ws.on("error", error => {
      log.info("Session failed", "error", error)
      this.didClose()
    })
    // TODO: ping/pong & session timeout

    log.info("Session started", "sess", this)
  }

  get state () :Value<SessionState> { return this._state }

  close () {
    this.ws.terminate()
    this.didClose()
  }

  toString () {
    return `${super.toString()}/${this.addr}`
  }

  protected sendMsg (msg :Uint8Array) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(msg, err => {
      if (err) log.warn("Message send failed", "sess", this, err) // TODO: terminate?
    })
    else log.warn("Dropping message for unconnected session", "sess", this)
  }

  protected didClose () {
    this._state.update("closed")
    this.dispose()
  }
}

export type ServerState = "initializing" | "listening" | "terminating" | "terminated"

export class Server {
  private readonly wss :WebSocket.Server
  private readonly _sessions = MutableSet.local<WSSession>()
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
      this._sessions.add(sess)
      sess.state.when(ss => ss === "closed", () => this._sessions.delete(sess))
    })
    wss.on("error", error => log.warn("Server error", error)) // TODO: ?
  }

  get sessions () :RSet<Session> { return this._sessions }

  get state () :Value<ServerState> { return this._state }

  shutdown () {
    this._state.update("terminating")
    for (const sess of this._sessions) sess.close()
    this.wss.close(() => this._state.update("terminated"))
  }
}
