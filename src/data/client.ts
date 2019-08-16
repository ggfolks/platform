import {Disposable, NoopRemover, log} from "../core/util"
import {Record, refEquals} from "../core/data"
import {DispatchFn, Emitter, Mutable, Stream, Subject, Value} from "../core/react"
import {Encoder, Decoder} from "../core/codec"
import {DataSource, DKey, DObject, DObjectType, DQueueAddr, Path, pathToKey} from "./data"
import {DownMsg, DownType, UpMsg, UpType, encodeUp, decodeDown} from "./protocol"

const DebugLog = false

/** Uniquely identifies a data server; provides the info needed to establish a connection to it. */
export type Address = {host :string, port :number, path :string}

/** Resolves the address of the server that hosts the object at `path`. */
export type Locator = (path :Path) => Subject<Address>

/** Creates `Connection` instances for clients. */
export type Connector = (client :Client, addr :Address) => Connection

type DObjectCompleter = {
  info :{otype :DObjectType<any>, source :DataSource, path :Path}
  complete :DispatchFn<DObject|Error>
}

export class Client {
  private readonly conns = new Map<Address, Connection>()
  private readonly objects = new Map<number,DObject>()
  private readonly resolved = new Map<string,Subject<DObject|Error>>()
  private readonly completers = new Map<number,DObjectCompleter>()
  private readonly encoder = new Encoder()
  private nextOid = 1

  private readonly resolver = {
    get: (oid :number) => {
      const obj = this.objects.get(oid)
      if (obj) return obj
      else throw new Error(`Unknown object [oid=${oid}]`)
    },
    info: (oid :number) => {
      const comp = this.completers.get(oid)
      if (comp) return comp.info
      else throw new Error(`Cannot create unknown object [oid=${oid}]`)
    }
  }

  private dataSource (oid :number) :DataSource {
    return {
      create: (path, cprop, key, otype, ...args) => this.create(path, cprop, key, otype, ...args),
      resolve: (path, otype) => this.resolve(path, otype),
      post: (queue, msg) => this.post(queue, msg),
      sendSync: (obj, req) => this.sendUp(obj.path, {...req, oid})
    }
  }

  constructor (readonly locator :Locator, readonly connector :Connector) {}

  create<T extends DObject> (
    path :Path, cprop :string, key :DKey, otype :DObjectType<T>, ...args :any[]
  ) :Subject<DKey|Error> {
    return Subject.constant(new Error(`TODO`))
  }

  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :Subject<T|Error> {
    const key = pathToKey(path), sub = this.resolved.get(key)
    if (sub) return sub as Subject<T|Error>
    const nsub = Subject.deriveSubject<T|Error>(disp => {
      const oid = this.nextOid
      this.nextOid = oid+1
      this.completers.set(oid, {
        info: {otype, source: this.dataSource(oid), path},
        complete: res => {
          this.completers.delete(oid)
          if (DebugLog) log.debug("Got SUB rsp", "oid", oid, "res", res);
          if (res instanceof DObject) this.objects.set(oid, res)
          disp(res as T|Error)
        }
      })
      this.sendUp(path, {type: UpType.SUB, path, oid})
      return () => {
        this.sendUp(path, {type: UpType.UNSUB, oid})
        this.objects.delete(oid)
      }
    })
    this.resolved.set(key, nsub)
    return nsub
  }

  post (queue :DQueueAddr, msg :Record) {
    this.sendUp(queue.path, {type: UpType.POST, queue, msg})
  }

  recvMsg (data :Uint8Array) {
    this.handleDown(decodeDown(this.resolver, new Decoder(data)))
  }

  handleDown (msg :DownMsg) {
    if (msg.type === DownType.SUBOBJ) {
      const comp = this.completers.get(msg.oid)
      if (comp) comp.complete(msg.obj)
      else this.reportError(`Unexpected SUBOBJ response [oid=${msg.oid}]`)
    } else if (msg.type === DownType.SUBERR) {
      const comp = this.completers.get(msg.oid)
      if (comp) comp.complete(new Error(msg.cause))
      else this.reportError(`Unexpected SUBERR response [oid=${msg.oid}, cause=${msg.cause}]`)
    } else {
      const obj = this.objects.get(msg.oid)
      if (obj) obj.applySync(msg)
      else throw new Error(`Unexpected SYNC msg [oid=${msg.oid}, type=${msg.type}]`)
    }
  }

  // TODO: when do we dispose connections?

  protected connFor (path :Path) :Subject<Connection> {
    const {locator, conns, connector} = this
    return locator(path).map(addr => {
      let conn = conns.get(addr)
      if (!conn) conns.set(addr, conn = connector(this, addr))
      return conn
    })
  }

  protected sendUp (path :Path, msg :UpMsg) {
    if (DebugLog) log.debug("sendUp", "path", path, "msg", msg);
    this.connFor(path).once(conn => {
      try {
        encodeUp(msg, this.encoder)
        conn.sendMsg(this.encoder.finish())
      } catch (err) {
        this.encoder.reset()
        // TODO: maybe just log this?
        throw err
      }
    })
  }

  protected reportError (msg :string) {
    console.warn(msg)
  }
}

export abstract class Connection implements Disposable {

  constructor (readonly client :Client, readonly addr :Address) {
    this.connect(addr)
  }

  abstract dispose () :void
  abstract sendMsg (msg :Uint8Array) :void
  protected abstract connect (addr :Address) :void
}

interface Resolver {
  resolve<T extends DObject> (path :Path, otype :DObjectType<T>) :Subject<T|Error>
}

export class Subscription<T extends DObject> implements Disposable {
  private rem = NoopRemover
  private obj = Mutable.local<T|undefined>(undefined, refEquals)
  private err = new Emitter<Error>()

  constructor (readonly otype :DObjectType<T>) {}

  get current () :T {
    const obj = this.obj.current
    if (obj !== undefined) return obj
    throw new Error(`No object for subscription [otype=${this.otype}]`)
  }
  get object () :Value<T|undefined> { return this.obj }
  get errors () :Stream<Error> { return this.err }

  subscribe (source :Resolver, path :Path) {
    this.rem()
    this.rem = source.resolve(path, this.otype).onValue(res => {
      if (res instanceof Error) this.err.emit(res)
      else this.obj.update(res)
    })
  }

  clear () {
    this.rem()
    this.rem = NoopRemover
    this.obj.update(undefined)
  }

  dispose () {
    this.clear()
  }
}
