import {Disposable, Remover, log} from "../core/util"
import {UUID} from "../core/uuid"
import {Path, PathMap} from "../core/path"
import {Record} from "../core/data"
import {Mutable, Value} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"
import {Channel, CState} from "../channel/channel"
import {ChannelClient} from "../channel/client"
import {DataSource, DView, DObject, DObjectType, DState, DQueueAddr} from "./data"
import {SyncMsg, DataType, DataMsg, DataCodec, ObjType, ObjMsg, mkObjCodec,
        ViewType, ViewMsg, ViewCodec} from "./protocol"

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

abstract class Resolved {
  private refs = 0
  readonly state = Mutable.local<DState>("resolving")

  init (cstate :Value<CState>) {
    const unresub = cstate.onValue(cstate => {
      switch (cstate) {
      case "closed":
        this.state.update("disconnected")
        break
      case "open":
        this.resolve()
        break
      }
    })
    this.state.whenOnce(s => s === "disposed", _ => unresub())
  }

  abstract resolved :any

  target<T> () :T { return this.resolved as T }

  ref<T> () :[T, Remover] {
    this.refs += 1
    return [this.resolved, () => this.unref()]
  }

  unref () {
    const refs = this.refs = this.refs-1
    if (refs === 0) this.dispose()
  }

  abstract resolve () :void
  abstract release () :void

  dispose () {
    this.release()
    this.state.update("disposed")
  }
}

class ResolvedObject extends Resolved implements DataSource {
  private channel :Channel<ObjMsg>|undefined = undefined
  readonly resolved :DObject

  constructor (readonly store :ClientStore, readonly path :Path, otype :DObjectType<any>) {
    super()
    this.resolved = new otype(this, path, this.state)
  }

  resolve () {
    const channel = this.channel = this.store.client.createChannel<ObjMsg>(
      "object", this.path, mkObjCodec(this.resolved))
    channel.state.when(s => s === "failed", _ => this.state.update("failed"))
    if (DebugLog) log.debug("Subscribing to object", "path", this.path, "channel", channel)
    // TODO: propagate and report subscribe failure?
    channel.messages.onEmit(msg => {
      switch (msg.type) {
      case ObjType.OBJ:
        if (DebugLog) log.debug("Got object for obj channel", "obj", msg.obj)
        this.state.update("active")
        break
      case ObjType.POST:
        // TODO: does it make sense to allow servers to post to client objects?
        log.warn("Illegal downstream POST msg", "path", this.path, "msg", msg)
        break
      case ObjType.DECERR:
        log.warn("Failed to decode sync message", "path", this.path, "err", msg)
        break
      default:
        if (DebugLog) log.debug("Got sync for obj channel", "msg", msg)
        this.resolved.applySync(msg, true)
        break
      }
    })
  }

  release () {
    if (DebugLog) log.debug("Unsubscribing from object", "path", this.path)
    if (this.channel) {
      this.channel.dispose()
      this.channel = undefined
    }
  }

  // DataStore methods
  post (index :number, msg :Record) {
    if (this.channel) this.channel.sendMsg({type: ObjType.POST, index, msg})
    else log.warn("Dropping POST on unconnected object", "index", index, "msg", msg)
  }
  sendSync (msg :SyncMsg) {
    if (this.channel) this.channel.sendMsg(msg)
    else log.warn("Dropping SYNC on unconnected object", "msg", msg)
  }
  createRecord (path :Path, key :UUID, data :Record) {
    this.store.createRecord(path, key, data)
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    this.store.updateRecord(path, key, data, merge)
  }
  deleteRecord (path :Path, key :UUID) {
    this.store.deleteRecord(path, key)
  }
}

class ResolvedView extends Resolved {
  private channel :Channel<ViewMsg>|undefined = undefined
  readonly resolved = MutableMap.local<UUID, Record>()

  constructor (readonly store :ClientStore, readonly path :Path, view :DView<any>) {
    super()
  }

  resolve () {
    const channel = this.channel = this.store.client.createChannel<ViewMsg>(
      "view", this.path, ViewCodec)
    if (DebugLog) log.debug("Subscribing to view", "path", this.path)
    channel.state.onValue(state => {
      if (state === "open") this.state.update("active")
      else if (state === "failed") this.state.update("failed")
    })
    // TODO: propagate and report subscribe failure?
    channel.messages.onEmit(msg => {
      switch (msg.type) {
      case ViewType.SET:
        for (const rec of msg.recs) this.resolved.set(rec.key, rec.data)
        break
      case ViewType.DEL:
        this.resolved.delete(msg.key)
        break
      }
    })
  }

  release () {
    if (DebugLog) log.debug("Unsubscribing from view", "path", this.path)
    if (this.channel) {
      this.channel.dispose()
      this.channel = undefined
    }
  }
}

export class ClientStore implements Disposable {
  private readonly resolved = new PathMap<Resolved>()
  private data :Channel<DataMsg>

  constructor (readonly client :ChannelClient) {
    this.data = client.createChannel("data", [], DataCodec)
    this.client.state.onChange(state => {
      if (state === "open") {
        this.data.dispose()
        this.data = client.createChannel("data", [], DataCodec)
      }
    })
  }

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :[T, Remover] {
    for (const comp of path) if (comp === undefined) throw new Error(
      `Path contains undefined component: ${path}`)

    const res = this.resolved.get(path)
    if (res) return res.ref<T>()

    if (DebugLog) log.debug("Resolving object", "path", path, "otype", otype)
    const nres = this.resolved.set(path, new ResolvedObject(this, path, otype))
    nres.state.whenOnce(s => s === "disposed", _ => this.resolved.delete(path))
    nres.init(this.client.state)
    return nres.ref()
  }

  // TODO: limit, startKey, etc.
  resolveView<T extends Record> (view :DView<T>) :[RMap<UUID,T>, Remover] {
    const path = view.path
    const res = this.resolved.get(path)
    if (res) return res.ref<RMap<UUID,T>>()

    if (DebugLog) log.debug("Resolving view", "path", path, "view", view)
    const nres = this.resolved.set(path, new ResolvedView(this, path, view))
    nres.state.whenOnce(s => s === "disposed", _ => this.resolved.delete(path))
    nres.init(this.client.state)
    return nres.ref()
  }

  post (queue :DQueueAddr, msg :Record) {
    this.data.sendMsg({type: DataType.POST, queue, msg})
  }
  createRecord (path :Path, key :UUID, data :Record) {
    this.data.sendMsg({type: DataType.TADD, path, key, data})
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    this.data.sendMsg({type: DataType.TSET, path, key, data, merge})
  }
  deleteRecord (path :Path, key :UUID) {
    this.data.sendMsg({type: DataType.TDEL, path, key})
  }

  dispose () {
    this.resolved.forEach(r => r.dispose())
    this.resolved.clear()
  }
}
