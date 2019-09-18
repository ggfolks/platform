import {log} from "../core/util"
import {UUID} from "../core/uuid"
import {Record} from "../core/data"
import {Encoder, Decoder, KeyType, ValueType} from "../core/codec"
import {Mutable} from "../core/react"
import {PropMeta} from "./meta"
import {Auth, DMutable, DObject, DQueueAddr, Path, PathMap} from "./data"

const DebugLog = false

export const enum SyncType { VALSET, SETADD, SETDEL, MAPSET, MAPDEL, DECERR }
type ValSetMsg = {type :SyncType.VALSET, path :Path, idx :number, value :any, vtype: ValueType}
type SetAddMsg = {type :SyncType.SETADD, path :Path, idx :number, elem :any, etype: KeyType}
type SetDelMsg = {type :SyncType.SETDEL, path :Path, idx :number, elem :any, etype: KeyType}
type MapSetMsg = {type :SyncType.MAPSET, path :Path, idx :number,
                  key :any, ktype: KeyType, value :any, vtype: ValueType}
type MapDelMsg = {type :SyncType.MAPDEL, path :Path, idx :number, key :any, ktype: KeyType}
type DecErrMsg = {type :SyncType.DECERR, otype :SyncType, path :Path, idx :number, cause :string}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg | DecErrMsg

export const enum UpType   { /* SyncType is 0-4 */ AUTH = 5, SUB, UNSUB, VSUB, VUNSUB, POST }
export type UpMsg = {type :UpType.AUTH, source :string, id :UUID, token :string}
                  | {type :UpType.SUB, path :Path}
                  | {type :UpType.UNSUB, path :Path}
                  | {type :UpType.VSUB, path :Path, index :number, vid :number}
                  | {type :UpType.VUNSUB, vid :number}
                  | {type :UpType.POST, queue :DQueueAddr, msg :Record}
                  | SyncMsg

export const enum DownType { /* SyncType is 0-4 */ AUTHED = 5, SOBJ, SERR, VADD, VDEL, VERR }
export type DownMsg = {type :DownType.AUTHED, id :UUID}
                    | {type :DownType.SOBJ, obj :DObject}
                    | {type :DownType.SERR, path :Path, cause :string}
                    | {type :DownType.VADD, vid :number, objs :DObject[]}
                    | {type :DownType.VDEL, vid :number, path :Path}
                    | {type :DownType.VERR, vid :number, cause :string}
                    | SyncMsg

function addPath (path :Path, enc :Encoder) {
  if (path.length > 255) throw new Error(`Path too long: ${path}`)
  enc.addValue(path.length, "size8")
  for (let ii = 0, ll = path.length; ii < ll; ii += 1) {
    enc.addValue(path[ii], ii % 2 == 0 ? "string" : "uuid")
  }
}
function getPath (dec :Decoder) :string[] {
  const path :Path = [], length = dec.getValue("size8")
  for (let ii = 0, ll = length; ii < ll; ii += 1) {
    path.push(dec.getValue(ii % 2 == 0 ? "string" : "uuid"))
  }
  return path
}

export class MsgEncoder {
  private pathToId = new PathMap<number>()
  private nextPathId = 1

  readonly encoder = new Encoder()

  encodeUp (upm :UpMsg) :Uint8Array {
    try {
      if (DebugLog) log.debug("encodeUp", "msg", upm)
      const enc = this.encoder
      enc.addValue(upm.type, "int8")
      switch (upm.type) {
      case UpType.AUTH:
        enc.addValue(upm.source, "string")
        enc.addValue(upm.id, "uuid")
        enc.addValue(upm.token, "string")
        break
      case UpType.SUB:
        this.encodePath(upm.path)
        break
      case UpType.UNSUB:
        this.encodePath(upm.path)
        break
      case UpType.POST:
        this.encodePath(upm.queue.path)
        enc.addValue(upm.queue.index, "size8")
        enc.addValue(upm.msg, "record")
        break
      case UpType.VSUB:
        this.encodePath(upm.path)
        enc.addValue(upm.index, "size8")
        enc.addValue(upm.vid, "size32")
        break
      case UpType.VUNSUB:
        enc.addValue(upm.vid, "size32")
        break
      default:
        this.encodeSync(upm)
        break
      }
      return this.encoder.finish()
    } catch (error) {
      this.encoder.reset()
      throw error
    }
  }

  encodeDown (rcpt :Auth, dnm :DownMsg) :Uint8Array {
    try {
      if (DebugLog) log.debug("encodeDown", "msg", dnm)
      const enc = this.encoder
      enc.addValue(dnm.type, "int8")
      switch (dnm.type) {
      case DownType.AUTHED:
        enc.addValue(dnm.id, "uuid")
        break
      case DownType.SOBJ:
        this.encodePath(dnm.obj.path)
        this.addObject(rcpt, dnm.obj)
        break
      case DownType.SERR:
        this.encodePath(dnm.path)
        enc.addValue(dnm.cause, "string")
        break
      case DownType.VADD:
        enc.addValue(dnm.vid, "size32")
        enc.addValue(dnm.objs.length, "size32")
        for (const obj of dnm.objs) {
          this.encodePath(obj.path)
          this.addObject(rcpt, obj)
        }
        break
      case DownType.VDEL:
        enc.addValue(dnm.vid, "size32")
        this.encodePath(dnm.path)
        break
      case DownType.VERR:
        enc.addValue(dnm.vid, "size32")
        enc.addValue(dnm.cause, "string")
        break
      default:
        this.encodeSync(dnm)
        break
      }
      return this.encoder.finish()
    } catch (error) {
      this.encoder.reset()
      throw error
    }
  }

  encodeSync (sym :SyncMsg) {
    const enc = this.encoder
    this.encodePath(sym.path)
    enc.addValue(sym.idx, "size8")
    switch (sym.type) {
    case SyncType.VALSET: enc.addValue(sym.value, sym.vtype) ; break
    case SyncType.SETADD: enc.addValue(sym.elem, sym.etype) ; break
    case SyncType.SETDEL: enc.addValue(sym.elem, sym.etype) ; break
    case SyncType.MAPSET: enc.addValue(sym.key, sym.ktype) ; enc.addValue(sym.value, sym.vtype) ; break
    case SyncType.MAPDEL: enc.addValue(sym.key, sym.ktype) ; break
    case SyncType.DECERR: throw new Error(`Illegal to encode DECERR message`)
    }
  }

  encodePath (path :Path) {
    const enc = this.encoder
    const knownId = this.pathToId.get(path)
    if (knownId) enc.addValue(knownId, "size16")
    else {
      const newId = this.nextPathId
      this.nextPathId += 1
      this.pathToId.set(path, newId)
      enc.addValue(0, "size16")
      enc.addValue(newId, "size16")
      addPath(path, enc)
    }
  }

  addObject (rcpt :Auth, obj :DObject) {
    const enc = this.encoder
    for (const meta of obj.metas) {
      if (!obj.canRead(meta.name, rcpt)) continue
      const prop = obj[meta.name]
      switch (meta.type) {
      case "value":
        enc.addValue(meta.index, "size8")
        enc.addValue((prop as Mutable<any>).current, meta.vtype)
        break
      case "set":
        enc.addValue(meta.index, "size8")
        enc.addSet((prop as Set<any>), meta.etype)
        break
      case "map":
        enc.addValue(meta.index, "size8")
        enc.addMap((prop as Map<any, any>), meta.ktype, meta.vtype)
        break
      case "collection": break // TODO: anything?
      case "queue": break // TODO: anything?
      }
    }
    enc.addValue(255, "size8") // terminator
  }
}

export interface SyncResolver {
  getMetas (path :Path) :PropMeta[]|undefined
}
export interface GetResolver extends SyncResolver {
  getObject (path :Path) :DObject
}
export interface ViewResolver extends GetResolver {
  makeViewObject (vid :number, id :UUID) :DObject
}

export class MsgDecoder {
  private idToPath = new Map<number, Path>()

  decodeUp (resolver :SyncResolver, dec :Decoder) :UpMsg {
    const type = dec.getValue("int8")
    if (DebugLog) log.debug("decodeUp", "type", type)
    switch (type) {
    case UpType.AUTH:
      return {type, source: dec.getValue("string"),
      id: dec.getValue("uuid"), token: dec.getValue("string")}
    case UpType.SUB:
      return {type, path: this.decodePath(dec)}
    case UpType.UNSUB:
      return {type, path: this.decodePath(dec)}
    case UpType.POST:
      const queue = {path: this.decodePath(dec), index: dec.getValue("size8")}
      return {type, queue, msg: dec.getValue("record")}
    case UpType.VSUB:
      return {type, path: this.decodePath(dec), index: dec.getValue("size8"),
              vid: dec.getValue("size32")}
    case UpType.VUNSUB:
      return {type, vid: dec.getValue("size32")}
    default:
      return this.decodeSync(resolver, type, dec)
    }
  }

  decodeDown (resolver :ViewResolver, dec :Decoder) :DownMsg {
    const type = dec.getValue("int8")
    if (DebugLog) log.debug("decodeDown", "type", type)
    switch (type) {
    case DownType.AUTHED:
      return {type, id: dec.getValue("uuid")}
    case DownType.SOBJ:
      return {type, obj: this.getObject(dec, this.decodePath(dec), resolver)}
    case DownType.SERR:
      return {type, path: this.decodePath(dec), cause :dec.getValue("string")}
    case DownType.VADD:
      const vid = dec.getValue("size32"), objs = []
      for (let ii = 0, ll = dec.getValue("size32"); ii < ll; ii += 1) {
        const id = dec.getValue("uuid"), obj = resolver.makeViewObject(vid, id)
        this.getObject(dec, obj.path, resolver)
        objs.push(obj)
      }
      return {type, vid, objs}
    case DownType.VDEL:
      return {type, vid: dec.getValue("size32"), path: this.decodePath(dec)}
    case DownType.VERR:
      return {type, vid: dec.getValue("size32"), cause :dec.getValue("string")}
    default:
      return this.decodeSync(resolver, type, dec)
    }
  }

  decodeSync (resolver :SyncResolver, type :SyncType, dec :Decoder) :SyncMsg {
    const path = this.decodePath(dec), idx :number = dec.getValue("size8")
    if (DebugLog) log.debug("decodeSync", "path", path, "idx", idx)
    const syncError = (cause :string) :SyncMsg => ({type: SyncType.DECERR, otype: type, path, idx, cause})
    const metas = resolver.getMetas(path)
    if (!metas) return syncError("No object at path")
    const meta = metas[idx]
    if (!meta) return syncError("No prop at idx")
    const typeMismatch = (type :string, op :string) => syncError(
      `Expected '${type}' property for ${op}, got '${meta.type}`)
    switch (type) {
    case SyncType.VALSET: return (meta.type !== "value") ? typeMismatch("value", "valset") :
      {type, path, idx, value: dec.getValue(meta.vtype), vtype: meta.vtype}
    case SyncType.SETADD: return (meta.type !== "set") ? typeMismatch("set", "setadd") :
      {type, path, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
    case SyncType.SETDEL: return (meta.type !== "set") ? typeMismatch("set", "setdel") :
      {type, path, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
    case SyncType.MAPSET: return (meta.type !== "map") ? typeMismatch("map", "mapset") :
      {type, path, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype,
       value: dec.getValue(meta.vtype), vtype: meta.vtype}
    case SyncType.MAPDEL: return (meta.type !== "map") ? typeMismatch("map", "mapdel") :
      {type, path, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype}
    default: return syncError("Invalid msg type")
    }
  }

  decodePath (dec :Decoder) :Path {
    const knownId = dec.getValue("size16")
    if (knownId) {
      const path = this.idToPath.get(knownId)
      if (!path) throw new Error(`Missing mapping for path id ${knownId}`)
      return path
    } else {
      const newId = dec.getValue("size16"), path = getPath(dec)
      this.idToPath.set(newId, path)
      return path
    }
  }

  getObject (dec :Decoder, path :Path, resolver :GetResolver) :DObject {
    const into = resolver.getObject(path)
    while (true) {
      const idx = dec.getValue("size8")
      if (idx === 255) break
      const meta = into.metas[idx], prop = into[meta.name]
      switch (meta.type) {
      case "value": (prop as DMutable<any>).update(dec.getValue(meta.vtype), true) ; break
      case "set": dec.syncSet(meta.etype, (prop as Set<any>)) ; break
      case "map": dec.syncMap(meta.ktype, meta.vtype, (prop as Map<any, any>)) ; break
      case "collection": break // TODO: anything?
      case "queue": break // TODO: anything?
      }
    }
    return into
  }
}
