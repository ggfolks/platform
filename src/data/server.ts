import {PMap, Remover, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Path, PathMap} from "../core/path"
import {mergeConfig} from "../core/config"
import {Record} from "../core/data"
import {Mutable, Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Auth} from "../auth/auth"
import {Named, PropMeta, TableMeta, ViewMeta, tableForView, getPropMetas, isPersist} from "./meta"
import {DataSource, DObject, DObjectType, DState, DQueueAddr, MetaMsg, findObjectType} from "./data"
import {DataMsg, DataType, DataCodec, ObjMsg, ObjType, mkObjCodec, SyncMsg,
        ViewMsg, ViewType, ViewCodec} from "./protocol"
import {ChannelHandler} from "../channel/channel"

const DebugLog = false

export const sysAuth :Auth = {id: UUID0, isGuest: false, isSystem: true}

interface Subscriber {
  auth :Auth
  sendSync (msg :SyncMsg) :void
}

export class Resolved implements DataSource {
  readonly state = Mutable.local<DState>("resolving")
  readonly subscribers :Subscriber[] = []
  readonly object :DObject

  constructor (readonly store :DataStore, path :Path, otype :DObjectType<any>) {
    this.object = new otype(this, path, this.state)
  }

  addSubscriber (sub :Subscriber) {
    this.subscribers.push(sub)
    this.store.postMeta(this.object, {type: "subscribed", id: sub.auth.id})
  }
  removeSubscriber (sub :Subscriber) {
    const idx = this.subscribers.indexOf(sub)
    if (idx >= 0) {
      this.subscribers.splice(idx, 1)
      this.store.postMeta(this.object, {type: "unsubscribed", id: sub.auth.id})
    }
  }

  resolvedData () {
    if (this.state.current === "resolving") {
      if (DebugLog) log.debug("Object resolved", "obj", this.object)
      this.state.update("active")
      this.store.postMeta(this.object, {type: "created"})
    }
  }

  post (index :number, msg :Record, auth = sysAuth) {
    this.store.post(auth, {path: this.object.path, index}, msg)
  }

  sendSync (msg :SyncMsg) {
    const obj = this.object
    if (DebugLog) log.debug("sendSync", "obj", obj, "msg", msg)
    const meta = obj.metas[msg.idx]
    for (const sub of this.subscribers) if (obj.canRead(meta.name, sub.auth)) sub.sendSync(msg)
    if (isPersist(meta)) this.store.persistSync(obj, msg)
  }

  createRecord (path :Path, key :UUID, data :Record) { this.store.createRecord(path, key, data) }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    this.store.updateRecord(path, key, data, merge) }
  deleteRecord (path :Path, key :UUID) { this.store.deleteRecord(path, key) }

  dispose () {
    this.state.update("disposed")
  }
}

interface ViewSubscriber {
  auth :Auth
  recordSet (tpath :Path, recs :{key :UUID, data :Record}[]) :void
  recordDelete (tpath :Path, key :UUID) :void
}

export class ResolvedView {
  readonly state = Mutable.local<DState>("resolving")
  readonly subscribers :ViewSubscriber[] = []
  readonly records = MutableMap.local<UUID, Record>()
  readonly tpath :Path

  constructor (readonly store :DataStore, readonly vpath :Path, readonly vmeta :Named<ViewMeta>,
               readonly tmeta :Named<TableMeta>) {
    this.tpath = vpath.slice(0, vpath.length-1).concat(tmeta.name)
  }

  subscribe (sub :ViewSubscriber) :[RMap<UUID, Record>, Remover] {
    // TODO: maybe we want to allow the parent object's canRead to dictate our ability to
    // subscribe to a view? but that's kinda pointless because you can always subscribe to the
    // individual objects, so their canSubscribe needs to do the job one way or another
    this.subscribers.push(sub)
    return [this.records, () => {
      const idx = this.subscribers.indexOf(sub)
      if (idx >= 0) this.subscribers.splice(idx, 1)
    }]
  }

  recordSet (recs :{key :UUID, data :Record}[]) {
    for (const rec of recs) this.records.set(rec.key, rec.data)
    // TODO: what sort of access control do we want?
    for (const sub of this.subscribers) sub.recordSet(this.vpath, recs)
  }

  recordDelete (key :UUID) {
    this.records.delete(key)
    // TODO: what sort of access control do we want?
    for (const sub of this.subscribers) sub.recordDelete(this.vpath, key)
  }

  resolvedRecords () {
    if (this.state.current === "resolving") {
      if (DebugLog) log.debug("View resolved", "path", this.vpath)
      this.state.update("active")
    }
  }

  dispose () {
    this.state.update("disposed")
  }
}

export type Resolver = (o:DObject) => void

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
    const nres = this.objects.set(path, new Resolved(this, path, otype))
    if (metas.some(isPersist)) this.resolveData(nres, resolver)
    else nres.resolvedData()
    return nres
  }

  resolveView<O extends DObject> (path :Path) :ResolvedView {
    const res = this.views.get(path)
    if (res) return res

    const ppath = path.slice(0, path.length-1), vname = path[path.length-1]
    const ptype = findObjectType(this.rtype, ppath)
    const pmetas = getPropMetas(ptype.prototype)
    const vmeta = pmetas.find(m => m.name == vname)
    if (!vmeta) throw new Error(`No view at path '${path}'`)
    if (vmeta.type !== "view") throw new Error(`Non-view property at path '${path}'`)
    const tmeta = tableForView(pmetas, vmeta)
    const nres = this.views.set(path, new ResolvedView(this, path, vmeta, tmeta))
    this.resolveViewData(nres)
    return nres
  }

  post (auth :Auth, queue :DQueueAddr, msg :Record) {
    const object = this.resolve(queue.path).object
    object.state.whenOnce(s => s === "active", s => {
      try {
        const meta = object.metas[queue.index]
        if (meta.type !== "queue") throw new Error(`Not a queue prop at path [type=${meta.type}]`)
        if (meta.system && !auth.isSystem) {
          log.warn("Rejecting post to meta queue by non-system", "queue", queue, "auth", auth)
          throw new Error("Access denied.")
        }
        // TODO: check canSubscribe permission?
        meta.handler({auth, post: (queue, msg) => this.post(sysAuth, queue, msg)}, object, msg)
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
      meta.handler({auth: sysAuth, post: (queue, msg) => this.post(sysAuth, queue, msg)}, obj, msg)
    } catch (err) {
      log.warn("Failed to post meta", "obj", obj, "msg", msg, err)
    }
  }

  upSync (auth :Auth, obj :DObject, msg :SyncMsg) {
    const name = obj.metas[msg.idx].name
    if (obj.canRead(name, auth) && obj.canWrite(name, auth)) obj.applySync(msg, false)
    else log.warn("Write rejected", "auth", auth, "obj", obj, "prop", name)
  }

  abstract createRecord (path :Path, key :UUID, data :Record) :void
  abstract updateRecord (path :Path, key :UUID, data :Record, merge :boolean) :void
  abstract deleteRecord (path :Path, key :UUID) :void

  abstract resolveData (res :Resolved, resolver? :Resolver) :void
  abstract resolveViewData (res :ResolvedView) :void
  abstract persistSync (obj :DObject, msg :SyncMsg) :void
}

export abstract class AbstractDataStore extends DataStore {
  protected readonly tables = new PathMap<MutableMap<UUID, Record>>()

  createRecord (path :Path, key :UUID, data :Record) {
    const table = this.resolveTable(path)
    if (table.has(key)) log.warn(
      "createRecord already exists", "path", path, "key", key, "data", data)
    else table.set(key, data)
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    const table = this.resolveTable(path)
    if (!table.has(key)) log.warn(
      "updateRecord does not exist", "path", path, "key", key, "data", data)
    else if (merge) table.update(key, prev => mergeConfig(prev!, data))
    else table.set(key, data)
  }
  deleteRecord (path :Path, key :UUID) {
    const table = this.resolveTable(path)
    table.delete(key)
  }

  resolveViewData (res :ResolvedView) {
    const table = this.resolveTable(res.tpath)
    const unlisten = table.onChange(change => {
      switch (change.type) {
      case "set":
        // TODO: only set if it passes the view's query criteria
        res.recordSet([{key: change.key, data: change.value}])
        break
      case "deleted":
        res.recordDelete(change.key)
        break
      }
    })
    res.state.whenOnce(s => s === "disposed", _ => unlisten())
    // TODO: only set if it passes the view's query criteria
    for (const [key, rec] of table) res.records.set(key, rec)
    res.resolvedRecords()
  }

  protected resolveTableData (path :Path, table :MutableMap<UUID, Record>) {}

  private resolveTable (path :Path) :MutableMap<UUID, Record> {
    let table = this.tables.get(path)
    if (!table) {
      this.tables.set(path, table = MutableMap.local<UUID, Record>())
      this.resolveTableData(path, table)
    }
    return table
  }
}

/** A data store that maintains everything in memory. For testing. */
export class MemoryDataStore extends AbstractDataStore {

  resolveData (res :Resolved, resolver? :Resolver) { res.resolvedData() }
  persistSync (obj :DObject, msg :SyncMsg) {} // noop!
}

/** Creates channel handlers for `DataStore` services using `store`. */
export function channelHandlers (store :DataStore) :PMap<ChannelHandler<any>> {
  const data :ChannelHandler<DataMsg> = (auth, path, mkChannel) => {
    const channel = mkChannel(DataCodec)
    channel.messages.onEmit(msg => {
      switch (msg.type) {
      case DataType.POST:
        store.post(auth.current, msg.queue, msg.msg)
        break
      case DataType.TADD:
      case DataType.TSET:
      case DataType.TDEL:
        log.warn("TODO: TADD/SET/DEL", "msg", msg) // TODO
        break
      }
    })
    return Promise.resolve(channel)
  }

  const object :ChannelHandler<ObjMsg> = (auth, path, mkChannel) => {
    return new Promise((resolve, reject) => {
      // wait for object to be active before we do canSubscribe check
      const res = store.resolve(path), obj = res.object
      obj.state.whenOnce(s => s === "active", _ => {
        if (!obj.canSubscribe(auth.current)) {
          log.warn("Rejecting subscribe to object", "obj", obj, "auth", auth.current)
          reject(new Error("Access denied."))
        } else {
          const channel = mkChannel(mkObjCodec(obj))
          channel.messages.onEmit(msg => {
            switch (msg.type) {
            case ObjType.OBJ:
              log.warn("Invalid upstream OBJ message", "channel", channel, "msg", msg)
              break
            case ObjType.POST:
              res.post(msg.index, msg.msg, auth.current)
              break
            default:
              const meta = obj.metas[msg.idx]
              if (meta === undefined) throw new Error(log.format(
                "Missing object meta", "obj", obj, "index", msg.idx))
              const name = meta.name
              if (obj.canRead(name, auth.current) &&
                  obj.canWrite(name, auth.current)) obj.applySync(msg, false)
              else log.warn("Write rejected", "auth", auth, "obj", obj, "prop", name)
              break
            }
          })
          const sub :Subscriber = {
            get auth () { return auth.current },
            sendSync: msg => channel.sendMsg(msg)
          }
          res.addSubscriber(sub)
          channel.state.whenOnce(s => s === "closed", _ => res.removeSubscriber(sub))
          channel.sendMsg({type: ObjType.OBJ, obj: res.object})
          resolve(channel)
        }
      })
    })
  }

  const view :ChannelHandler<ViewMsg> = (auth, path, mkChannel) => {
    const res = store.resolveView(path)
    const sub :ViewSubscriber = {
      get auth () :Auth { return auth.current },
      recordSet (tpath :Path, recs :{key :UUID, data :Record}[]) {
        channel.sendMsg({type: ViewType.SET, recs})
      },
      recordDelete (tpath :Path, key :UUID) {
        channel.sendMsg({type: ViewType.DEL, key})
      }
    }
    const [rmap, unsub] = res.subscribe(sub)
    const channel = mkChannel(ViewCodec)
    channel.state.whenOnce(s => s === "closed", unsub)
    const recs = []
    for (const [key,data] of rmap.entries()) recs.push({key, data})
    channel.sendMsg({type: ViewType.SET, recs})
    return Promise.resolve(channel)
  }

  return {data, object, view}
}
