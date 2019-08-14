import {Remover, NoopRemover} from "../core/util"
import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Record} from "../core/data"
import {Subject} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {CollectionMeta} from "./meta"
import {Auth, AutoKey, DataSource, DKey, DObject, DObjectType, DQueueAddr, Path, Subscriber,
        findObjectType, pathToKey} from "./data"
import {DownType, DownMsg, UpType, SyncMsg, decodeUp, encodeDown} from "./protocol"

const sysAuth :Auth = {id: UUID0, isSystem: true}

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
        if (meta.type !== "queue") throw new Error(`Not a queue prop at path`)
        // TODO: check canSubscribe permission?
        meta.handler(res, msg, auth)
      } catch (err) {
        console.warn(`Failed to post [auth=${auth}, queue=${queue}, msg={$msg}, err=${err}]`)
      }
    })
  }

  sync (auth :Auth, obj :DObject, msg :SyncMsg) {
    const name = obj.metas[msg.idx].name
    if (obj.canRead(name, auth) || !obj.canWrite(name, auth)) obj.applySync(msg, false)
    else this.authFail(`Write rejected [auth=${auth}, obj=${obj}, prop=${name}]`)
  }

  protected authFail (msg :string) :never {
    console.warn(msg)
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

  constructor (readonly store :DataStore, readonly id :UUID) {
    this.auth = {id, isSystem: false}
  }

  handleMsg (msgData :Uint8Array) {
    const msg = decodeUp(this.resolver, new Decoder(msgData))
    switch (msg.type) {
    case UpType.SUB:
      const sendErr = (err :Error) => this.sendDown({
        type: DownType.SUBERR, oid: msg.oid, cause: err.message})
      this.store.resolve(msg.path).onValue(res => {
        if (res instanceof Error) sendErr(res)
        else {
          const sendSync = (msg :SyncMsg) => this.sendDown({...msg, oid})
          const sub = {obj: res, unsub: NoopRemover, auth: this.auth, sendSync}
          const unsub = res.subscribe(sub)
          if (!unsub) sendErr(new Error("Access denied."))
          else {
            sub.unsub = unsub
            this.subscrips.set(msg.oid, sub)
            this.sendDown({type: DownType.SUBOBJ, oid: msg.oid, obj: res})
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
      else console.warn(`Dropping sync message, no subscription [msg=${JSON.stringify(msg)}]`)
    }
  }

  sendDown (msg :DownMsg) {
    try {
      encodeDown(this.auth, msg, this.encoder)
    } catch (err) {
      this.encoder.reset()
      console.warn(`Failed to encode [msg=${msg.type}]`)
      console.warn(err)
      return
    }
    this.sendMsg(this.encoder.finish())
  }

  abstract sendMsg (msg :Uint8Array) :void

  dispose () {
    // TODO: unsub from all objects
  }
}
