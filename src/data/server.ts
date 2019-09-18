import {PMap, NoopRemover, Remover, log} from "../core/util"
import {UUID, UUID0, setRandomSource} from "../core/uuid"
import {Record} from "../core/data"
import {Mutable, Subject, Value} from "../core/react"
import {MutableMap, MutableSet, RMap, RSet} from "../core/rcollect"
import {Decoder} from "../core/codec"
import {Auth, AuthValidator, guestValidator} from "../auth/auth"
import {Named, IndexMeta, CollectionMeta, PropMeta,
        collectionForIndex, getPropMetas, isPersist} from "./meta"
import {DataSource, DObject, DObjectType, DState, DQueueAddr, MetaMsg, Path, PathMap,
        findObjectType} from "./data"
import {DownType, DownMsg, MsgEncoder, MsgDecoder, UpMsg, UpType, SyncMsg} from "./protocol"

import WebSocket from "ws"

import * as crypto from "crypto"
setRandomSource(array => crypto.randomFillSync(Buffer.from(array.buffer)))

const DebugLog = false

export const sysAuth :Auth = {id: UUID0, isGuest: false, isSystem: true}

interface Subscriber {
  auth :Auth
  sendSync (msg :SyncMsg) :void
}

export class Resolved implements DataSource {
  readonly state = Mutable.local<DState>("resolving")
  readonly subscribers :Subscriber[] = []
  readonly views :ResolvedView[] = []
  readonly object :DObject

  constructor (readonly store :DataStore, path :Path, otype :DObjectType<any>) {
    this.object = new otype(this, path, this.state)
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

  resolvedData () {
    if (this.state.current === "resolving") {
      if (DebugLog) log.debug("Object resolved", "obj", this.object)
      this.state.update("active")
      this.store.postMeta(this.object, {type: "created"})
    }
  }

  post (queue :DQueueAddr, msg :Record) { this.store.post(sysAuth, queue, msg) }

  sendSync (obj :DObject, msg :SyncMsg) {
    if (DebugLog) log.debug("sendSync", "obj", this.object, "msg", msg)
    const meta = obj.metas[msg.idx]
    for (const sub of this.subscribers) if (obj.canRead(meta.name, sub.auth)) sub.sendSync(msg)
    for (const view of this.views) view.sendSync(obj, msg)
    if (isPersist(meta)) this.store.persistSync(obj, msg)
  }

  dispose () {
    this.state.update("disposed")
  }
}

interface ViewSubscriber extends Subscriber {
  objectAdded (obj :DObject) :void
  objectDeleted (path :Path) :void
}

export type Resolver = (o:DObject) => void

export class ResolvedView {
  readonly state = Mutable.local<DState>("resolving")
  readonly subscribers :ViewSubscriber[] = []
  readonly objects = MutableMap.local<UUID, DObject>()
  readonly cpath :Path

  constructor (readonly store :DataStore, readonly ipath :Path, readonly imeta :Named<IndexMeta>,
               readonly cmeta :Named<CollectionMeta>) {
    this.cpath = ipath.slice(0, ipath.length-1).concat(cmeta.name)
  }

  subscribe (sub :ViewSubscriber) :[RMap<UUID, DObject>, Remover] {
    // TODO: maybe we want to allow the parent object's canRead to dictate our ability to
    // subscribe to a view? but that's kinda pointless because you can always subscribe to the
    // individual objects, so their canSubscribe needs to do the job one way or another
    this.subscribers.push(sub)
    return [this.objects, () => {
      const idx = this.subscribers.indexOf(sub)
      if (idx >= 0) this.subscribers.splice(idx, 1)
    }]
  }

  objectAdded (uuid :UUID, resolver :Resolver) {
    const path = this.cpath.concat(uuid)
    const resolved = this.store.resolve(path, resolver)
    resolved.views.push(this)

    const obj = resolved.object
    if (obj.state.current !== "active") log.warn(
      "Non-active object added to view?", "index", this.ipath, "okey", uuid,
      "state", obj.state.current)
    else for (const sub of this.subscribers) if (obj.canSubscribe(sub.auth)) sub.objectAdded(obj)
  }

  objectDeleted (id :UUID) {
    const obj = this.objects.get(id)
    if (obj) {
      this.objects.delete(id)
      for (const sub of this.subscribers) {
        if (obj.canSubscribe(sub.auth)) sub.objectDeleted(obj.path)
      }
    } else log.warn("Unknown object deleted from view?", "index", this.ipath, "okey", id)
  }

  resolveData () {
    // default implementation doesn't resolve anything
    this.resolvedData()
  }

  resolvedData () {
    if (this.state.current === "resolving") {
      if (DebugLog) log.debug("View resolved", "index", this.ipath)
      this.state.update("active")
    }
  }

  sendSync (object :DObject, msg :SyncMsg) {
    if (DebugLog) log.debug("View.sendSync", "obj", object, "msg", msg)
    const name = object.metas[msg.idx].name
    for (const sub of this.subscribers) {
      if (object.canSubscribe(sub.auth) && object.canRead(name, sub.auth)) sub.sendSync(msg)
    }
  }

  dispose () {
    this.state.update("disposed")
  }
}

export abstract class DataStore {
  // TODO: flush and unload objects/views with no subscribers after some idle timeout
  protected readonly objects = new PathMap<Resolved>()
  protected readonly views = new PathMap<ResolvedView>()

  // the server datastore is always connected (unlike the client) (TODO: is this true, maybe there
  // will be times when the server datastore is also disconnected?)
  readonly state = Value.constant<DState>("active")

  constructor (readonly rtype :DObjectType<any>) {}

  getMetas (path :Path) :PropMeta[]|undefined {
    const res = this.objects.get(path)
    return res ? res.object.metas : undefined
  }

  resolve (path :Path, resolver? :Resolver) :Resolved {
    const res = this.objects.get(path)
    if (res) return res

    // TODO: check with the parent object that the caller is allowed to create (will need to pass
    // auth into this method)
    if (DebugLog) log.debug("Creating object", "path", path)

    const otype = findObjectType(this.rtype, path)
    const metas = getPropMetas(otype.prototype)
    const nres = new Resolved(this, path, otype)
    this.objects.set(path, nres)
    if (metas.some(isPersist)) this.resolveData(nres, resolver)
    else nres.resolvedData()
    return nres
  }

  resolveView<O extends DObject> (path :Path) :ResolvedView {
    const res = this.views.get(path)
    if (res) return res

    const ppath = path.slice(0, path.length-1), iname = path[path.length-1]
    const ptype = findObjectType(this.rtype, ppath)
    const pmetas = getPropMetas(ptype.prototype)
    const imeta = pmetas.find(m => m.name == iname)
    if (!imeta) throw new Error(`No index at path '${path}'`)
    if (imeta.type !== "index") throw new Error(`Non-index property at path '${path}'`)
    const cmeta = collectionForIndex(pmetas, imeta)
    const nres = new ResolvedView(this, path, imeta, cmeta)
    this.resolveViewData(nres)
    this.views.set(path, nres)
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
    const meta = obj.metas.find(m => m.name === "metaq")
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
    if (obj.canRead(name, auth) && obj.canWrite(name, auth)) obj.applySync(msg, false)
    else log.warn("Write rejected", "auth", auth, "obj", obj, "prop", name)
  }

  abstract resolveData (res :Resolved, resolver? :Resolver) :void

  abstract resolveViewData (res :ResolvedView) :void

  abstract persistSync (obj :DObject, msg :SyncMsg) :void
}

export class MemoryDataStore extends DataStore {

  resolveData (res :Resolved, resolver? :Resolver) { res.resolvedData() }
  resolveViewData (res :ResolvedView) { res.resolvedData() }
  persistSync (obj :DObject, msg :SyncMsg) {} // noop!
}

class ObjectRef {
  refs = 1 // start reffed
  constructor (readonly object :DObject) {}
  ref () { this.refs += 1 }
  unref () :boolean {
    this.refs -= 1
    return this.refs === 0
  }
}

class ViewSub implements ViewSubscriber {
  private readonly unsub :Remover

  constructor (readonly sess :Session, readonly vid :number, res :ResolvedView) {
    const [omap, unsub] = res.subscribe(this)
    this.unsub = unsub
    // send the initial objects in the view
    const objs = []
    for (const obj of omap.values()) {
      sess.addObject(obj)
      objs.push(obj)
    }
    this.sess.sendDown({type: DownType.VADD, vid, objs})
  }

  get auth () :Auth { return this.sess.auth }
  sendSync (msg :SyncMsg) { this.sess.sendSync(msg) }

  objectAdded (obj :DObject) {
    this.sess.addObject(obj)
    this.sess.sendDown({type: DownType.VADD, vid: this.vid, objs: [obj]})
  }

  objectDeleted (path :Path) {
    this.sess.removeObject(path)
    this.sess.sendDown({type: DownType.VDEL, vid: this.vid, path})
  }

  dispose () {
    this.unsub()
  }
}

export type SessionConfig = {store :DataStore, authers :PMap<AuthValidator>}

export abstract class Session implements Subscriber {
  private readonly objects = new PathMap<ObjectRef>()
  private readonly unsubs = new PathMap<Remover>()
  private readonly viewsubs = new Map<number, ViewSub>()
  private readonly encoder = new MsgEncoder()
  private readonly decoder = new MsgDecoder()
  private readonly authers :PMap<AuthValidator>
  private _auth :Auth|undefined = undefined

  readonly store :DataStore

  constructor (config :SessionConfig) {
    this.store = config.store
    this.authers = config.authers
  }

  get auth () :Auth {
    if (this._auth) return this._auth
    throw new Error(`Session not yet authed [sess=${this}]`)
  }

  recvMsg (msgData :Uint8Array) {
    let msg :UpMsg
    try {
      msg = this.decoder.decodeUp(this.store, new Decoder(msgData))
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

  sendSync (msg :SyncMsg) { this.sendDown(msg) }

  sendDown (msg :DownMsg) {
    try {
      this.sendMsg(this.encoder.encodeDown(this.auth, msg))
    } catch (err) {
      log.warn("Failed to encode", "sess", this, "msg", msg, err)
      return
    }
  }

  addObject (obj :DObject) {
    const oref = this.objects.get(obj.path)
    if (oref) oref.ref()
    else {
      this.objects.set(obj.path, new ObjectRef(obj))
      this.store.postMeta(obj, {type: "subscribed", id: this.auth.id})
    }
  }

  removeObject (path :Path) {
    const oref = this.objects.get(path)
    if (!oref) log.warn("No ref for removed object?", "sess", this, "path", path)
    else if (oref.unref()) {
      this.store.postMeta(oref.object, {type: "unsubscribed", id: this.auth.id})
      this.objects.delete(path)
    }
  }

  dispose () {
    this.unsubs.forEach(unsub => unsub())
    this.unsubs.clear()
    this.viewsubs.forEach(view => view.dispose())
    this.viewsubs.clear()
  }

  protected handleMsg (msg :UpMsg) {
    if (DebugLog) log.debug("handleMsg", "sess", this, "msg", msg)
    switch (msg.type) {
    case UpType.AUTH:
      const auther = this.authers[msg.source]
      if (auther) auther.validateAuth(msg.id, msg.token).onValue(auth => {
        this._auth = auth
        this.sendDown({type: DownType.AUTHED, id: msg.id})
        log.info("Session authed", "sess", this, "source", msg.source)
      })
      else {
        log.warn("Session authed with invalid auth source", "sess", this, "source", msg.source)
        console.dir(this.authers)
      }
      break

    case UpType.SUB:
      this.subscribe(msg.path)
      break

    case UpType.UNSUB:
      const unsub = this.unsubs.get(msg.path)
      if (unsub) {
        this.unsubs.delete(msg.path)
        unsub()
      }
      break

    case UpType.VSUB:
      const vid = msg.vid
      this.viewsubs.set(vid, new ViewSub(this, vid, this.store.resolveView(msg.path)))
      break
    case UpType.VUNSUB:
      const vsub = this.viewsubs.get(msg.vid)
      if (vsub) {
        this.viewsubs.delete(msg.vid)
        vsub.dispose()
      }
      break

    case UpType.POST:
      this.store.post(this.auth, msg.queue, msg.msg)
      break

    default:
      const ref = this.objects.get(msg.path)
      if (ref) {
        const obj = ref.object
        switch (obj.state.current) {
        case "resolving":
          obj.state.whenOnce(s => s === "active", _ => this.store.upSync(this.auth, obj, msg))
          break
        case "active":
          this.store.upSync(this.auth, obj, msg)
          break
        default:
          log.warn("Dropping sync message for inactive object", "sess", this,
                   "state", obj.state.current, "msg", msg)
          break
        }
      }
      else log.warn("Dropping sync message, no subscription", "sess", this, "msg", msg)
    }
  }

  toString () {
    return `${this._auth ? this._auth.id : "<unauthed>"}`
  }

  protected subscribe (path :Path) {
    const res = this.store.resolve(path)
    let unref = NoopRemover
    const unsub = res.subscribe(this).onValue(res => {
      if (res instanceof Error) this.sendDown({type: DownType.SERR, path, cause: res.message})
      else {
        this.addObject(res)
        unref = () => this.removeObject(path)
        this.sendDown({type: DownType.SOBJ, obj: res})
      }
    })
    this.unsubs.set(path, () => { unsub() ; unref() })
  }

  protected abstract sendMsg (msg :Uint8Array) :void
}

type ServerConfig = {
  port? :number
}

type SessionState = "connecting" | "open" | "closed"

class WSSession extends Session {
  private readonly _state = Mutable.local("connecting" as SessionState)

  constructor (config :SessionConfig, readonly addr :string, readonly ws :WebSocket) {
    super(config)

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

export interface AuthValidator {

  /** Validates authentication info provided by a client.
    * @return a subject that yields an `Auth` instance iff the supplied info is valid. If it is
    * invalid, a warning should be logged and the subject should not complete. */
  validateAuth (id :UUID, token :string) :Subject<Auth>
}

export class Server {
  private readonly wss :WebSocket.Server
  private readonly _sessions = MutableSet.local<WSSession>()
  private readonly _state = Mutable.local("initializing" as ServerState)

  readonly authers :PMap<AuthValidator>

  constructor (readonly store :DataStore,
               authers :PMap<AuthValidator> = {},
               config :ServerConfig = {}) {
    this.authers = {...authers, guest: guestValidator}
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
      const sess = new WSSession(this, addr, ws)
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
