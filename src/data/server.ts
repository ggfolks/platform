import {Remover, NoopRemover} from "../core/util"
import {Record} from "../core/data"
import {Subject} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {Auth, DataSource, DKey, DObject, DObjectType, DQueueAddr, ID, Path, Subscriber,
        findObjectType, pathToKey} from "./data"
import {DownType, DownMsg, UpType, SyncMsg, decodeUp, encodeDown} from "./protocol"

const sysAuth :Auth = {id: "0", isSystem: true}

export class DataStore {
  private readonly objects = new Map<string, DObject>()
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

  create<T extends DObject> (
    auth :Auth, path :Path, cprop :string, key :DKey, ...args :any[]
  ) :Subject<T|Error> {
    return this.resolve(path).switchMap(res => {
      try {
        if (res instanceof Error) throw new Error(
          `Unable to resolve parent object for create ${JSON.stringify({path, cprop, key, res})}`)
        if (!res.canSubscribe(auth) || !res.canCreate(cprop, auth)) this.authFail(
          `Create check failed [auth=${auth}, obj=${res}, prop=${cprop}]`)
        const cpath = path.concat([cprop, key]), ckey = pathToKey(cpath)
        if (this.objects.has(ckey)) throw new Error(`Object already exists at path '${cpath}'`)
        return Subject.deriveSubject<T|Error>(disp => {
          const obj = this.objects.get(ckey)
          if (obj) disp(obj as T)
          else {
            const otype = findObjectType(this.rtype, cpath)
            const nobj = new otype(this.source, cpath, 0, ...args)
            this.objects.set(ckey, nobj)
            disp(nobj)
          }
          return NoopRemover
        })
      } catch (err) {
        return Subject.constant(err)
      }
    })
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
    this.resolve<DObject>(queue.path).once(res => {
      try {
        if (res instanceof Error) throw res
        const meta = res.metas[queue.index]
        if (meta.type !== "queue") throw new Error(`Not a queue prop at path`)
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

  constructor (readonly store :DataStore, readonly id :ID) {
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
