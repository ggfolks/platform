import {log} from "../core/util"
import {UUID} from "../core/uuid"
import {Path} from "../core/path"
import {Record} from "../core/data"
import {Encoder, Decoder, KeyType, ValueType} from "../core/codec"
import {Mutable} from "../core/react"
import {ChannelCodec} from "../channel/channel"
import {Auth, DMutable, DObject, DQueueAddr} from "./data"

const DebugLog = false

export const enum SyncType { VALSET, SETADD, SETDEL, MAPSET, MAPDEL, DECERR }
type ValSetMsg = {type :SyncType.VALSET, idx :number, value :any, vtype: ValueType}
type SetAddMsg = {type :SyncType.SETADD, idx :number, elem :any, etype: KeyType}
type SetDelMsg = {type :SyncType.SETDEL, idx :number, elem :any, etype: KeyType}
type MapSetMsg = {type :SyncType.MAPSET, idx :number,
                  key :any, ktype: KeyType, value :any, vtype: ValueType}
type MapDelMsg = {type :SyncType.MAPDEL, idx :number, key :any, ktype: KeyType}
type DecErrMsg = {type :SyncType.DECERR, otype :SyncType, path :Path, idx :number, cause :string}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg | DecErrMsg

function encodeSync (enc :Encoder, sym :SyncMsg) {
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

function decodeSync (object :DObject, type :SyncType, dec :Decoder) :SyncMsg {
  const idx :number = dec.getValue("size8")
  if (DebugLog) log.debug("decodeSync", "obj", object, "idx", idx)
  const syncError = (cause :string) :SyncMsg => ({
    type: SyncType.DECERR, otype: type, path: object.path, idx, cause})
  const meta = object.metas[idx]
  if (!meta) return syncError("No prop at idx")
  const typeMismatch = (type :string, op :string) => syncError(
    `Expected '${type}' property for ${op}, got '${meta.type}`)
  switch (type) {
  case SyncType.VALSET: return (meta.type !== "value") ? typeMismatch("value", "valset") :
    {type, idx, value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.SETADD: return (meta.type !== "set") ? typeMismatch("set", "setadd") :
    {type, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.SETDEL: return (meta.type !== "set") ? typeMismatch("set", "setdel") :
    {type, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.MAPSET: return (meta.type !== "map") ? typeMismatch("map", "mapset") :
    {type, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype,
    value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.MAPDEL: return (meta.type !== "map") ? typeMismatch("map", "mapdel") :
    {type, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype}
  default: return syncError("Invalid msg type")
  }
}

// export const enum UpType {
//   /* SyncType is 0-4 */ AUTH = 5, SUB, UNSUB, VSUB, VUNSUB, TADD, TSET, TDEL, POST }
// export type UpMsg = {type :UpType.AUTH, source :string, id :UUID, token :string}
//                   | {type :UpType.SUB, path :Path}
//                   | {type :UpType.UNSUB, path :Path}
//                   | {type :UpType.VSUB, path :Path}
//                   | {type :UpType.VUNSUB, path :Path}
//                   | {type :UpType.TADD, path :Path, key :UUID, data :Record}
//                   | {type :UpType.TSET, path :Path, key :UUID, data :Record, merge :boolean}
//                   | {type :UpType.TDEL, path :Path, key :UUID}
//                   | {type :UpType.POST, queue :DQueueAddr, msg :Record}
//                   | SyncMsg

// export const enum DownType { /* SyncType is 0-4 */ AUTHED = 5, SOBJ, SERR, VSET, VDEL, VERR }
// export type DownMsg = {type :DownType.AUTHED, id :UUID}
//                     | {type :DownType.SOBJ, obj :DObject}
//                     | {type :DownType.SERR, path :Path, cause :string}
//                     | {type :DownType.VSET, path :Path, recs :{key :UUID, data :Record}[]}
//                     | {type :DownType.VDEL, path :Path, key :UUID}
//                     | {type :DownType.VERR, path :Path, cause :string}
//                     | SyncMsg

export const enum DataType { POST, TADD, TSET, TDEL }
export type DataMsg = {type :DataType.POST, queue :DQueueAddr, msg :Record}
                    | {type :DataType.TADD, path :Path, key :UUID, data :Record}
                    | {type :DataType.TSET, path :Path, key :UUID, data :Record, merge :boolean}
                    | {type :DataType.TDEL, path :Path, key :UUID}

export const DataCodec :ChannelCodec<DataMsg> = {
  encode: (enc, rcpt, msg) => {
    if (DebugLog) log.debug("encodeData", "msg", msg)
    enc.addValue(msg.type, "int8")
    switch (msg.type) {
    case DataType.POST:
      enc.addPath(msg.queue.path)
      enc.addValue(msg.queue.index, "size8")
      enc.addValue(msg.msg, "record")
      break
    case DataType.TADD:
    case DataType.TSET:
    case DataType.TDEL:
      enc.addPath(msg.path)
      enc.addValue(msg.key, "uuid")
      if (msg.type !== DataType.TDEL) {
        enc.addValue(msg.data, "record")
      }
      if (msg.type === DataType.TSET) {
        enc.addValue(msg.merge, "boolean")
      }
      break
    }
  },
  decode: (dec) => {
    const type = dec.getValue("int8")
    if (DebugLog) log.debug("decodeData", "type", type)
    switch (type) {
    case DataType.POST:
      const queue = {path: dec.getPath(), index: dec.getValue("size8")}
      return {type, queue, msg: dec.getValue("record")}
    case DataType.TADD:
      return {type, path: dec.getPath(), key: dec.getValue("uuid"), data: dec.getValue("record")}
    case DataType.TSET:
      return {type, path: dec.getPath(), key: dec.getValue("uuid"), data: dec.getValue("record"),
              merge: dec.getValue("boolean")}
    case DataType.TDEL:
      return {type, path: dec.getPath(), key: dec.getValue("uuid")}
    default:
      throw new Error(`Unknown data message type '${type}'`)
    }
  }
}

export const enum ObjType { /* SyncType is 0-4 */ OBJ = 5, POST }
export type ObjMsg = {type :ObjType.OBJ, obj :DObject}
                   | {type :ObjType.POST, index :number, msg :Record}
                   | SyncMsg

export function addObject (enc :Encoder, rcpt :Auth, obj :DObject) {
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

export function getObject (dec :Decoder, into :DObject) :DObject {
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

export function mkObjCodec (object :DObject) :ChannelCodec<ObjMsg> {
  return {
    encode: (enc, rcpt, msg) => {
      if (DebugLog) log.debug("encodeObj", "msg", msg)
      enc.addValue(msg.type, "int8")
      switch (msg.type) {
      case ObjType.OBJ:
        addObject(enc, rcpt, msg.obj)
        break
      case ObjType.POST:
        enc.addValue(msg.index, "size8")
        enc.addValue(msg.msg, "record")
        break
      default:
        encodeSync(enc, msg)
        break
      }
    },
    decode: (dec) => {
      const type = dec.getValue("int8")
      if (DebugLog) log.debug("decodeObj", "type", type)
      switch (type) {
      case ObjType.OBJ:
        return {type, obj: getObject(dec, object)}
      case ObjType.POST:
        return {type, index: dec.getValue("size8"), msg: dec.getValue("record")}
      default:
        return decodeSync(object, type, dec)
      }
    }
  }
}

export const enum ViewType { SET, DEL }
export type ViewMsg = {type :ViewType.SET, recs :{key :UUID, data :Record}[]}
                    | {type :ViewType.DEL, key :UUID}

export const ViewCodec :ChannelCodec<ViewMsg> = {
  encode: (enc, rcpt, msg) => {
    if (DebugLog) log.debug("encodeObj", "msg", msg)
    enc.addValue(msg.type, "int8")
    switch (msg.type) {
    case ViewType.SET:
      enc.addValue(msg.recs.length, "size32")
      for (const rec of msg.recs) {
        enc.addValue(rec.key, "uuid")
        enc.addValue(rec.data, "record")
      }
      break
    case ViewType.DEL:
      enc.addValue(msg.key, "uuid")
      break
    }
  },
  decode: (dec) => {
    const type = dec.getValue("int8")
    if (DebugLog) log.debug("decodeObj", "type", type)
    switch (type) {
    case ViewType.SET:
      const recs = []
      for (let ii = 0, ll = dec.getValue("size32"); ii < ll; ii += 1) recs.push(
        {key: dec.getValue("uuid"), data: dec.getValue("record")})
      return {type, recs}
    case ViewType.DEL:
      return {type, key: dec.getValue("uuid")}
    default:
      throw new Error(`Unknown view message type '${type}'`)
    }
  }
}

// export class MsgEncoder {
//   private pathToId = new PathMap<number>()
//   private nextPathId = 1

//   readonly encoder = new Encoder()

//   encodeUp (upm :UpMsg) :Uint8Array {
//     try {
//       if (DebugLog) log.debug("encodeUp", "msg", upm)
//       const enc = this.encoder
//       enc.addValue(upm.type, "int8")
//       switch (upm.type) {
//       case UpType.AUTH:
//         enc.addValue(upm.source, "string")
//         enc.addValue(upm.id, "uuid")
//         enc.addValue(upm.token, "string")
//         break
//       case UpType.SUB:
//       case UpType.UNSUB:
//       case UpType.VSUB:
//       case UpType.VUNSUB:
//         this.encodePath(upm.path)
//         break
//       case UpType.TADD:
//       case UpType.TSET:
//       case UpType.TDEL:
//         this.encodePath(upm.path)
//         enc.addValue(upm.key, "uuid")
//         if (upm.type !== UpType.TDEL) {
//           enc.addValue(upm.data, "record")
//         }
//         if (upm.type === UpType.TSET) {
//           enc.addValue(upm.merge, "boolean")
//         }
//         break
//       case UpType.POST:
//         this.encodePath(upm.queue.path)
//         enc.addValue(upm.queue.index, "size8")
//         enc.addValue(upm.msg, "record")
//         break
//       default:
//         this.encodeSync(upm)
//         break
//       }
//       return this.encoder.finish()
//     } catch (error) {
//       this.encoder.reset()
//       throw error
//     }
//   }

//   encodeDown (rcpt :Auth, dnm :DownMsg) :Uint8Array {
//     try {
//       if (DebugLog) log.debug("encodeDown", "msg", dnm)
//       const enc = this.encoder
//       enc.addValue(dnm.type, "int8")
//       switch (dnm.type) {
//       case DownType.AUTHED:
//         enc.addValue(dnm.id, "uuid")
//         break
//       case DownType.SOBJ:
//         this.encodePath(dnm.obj.path)
//         this.addObject(rcpt, dnm.obj)
//         break
//       case DownType.SERR:
//         this.encodePath(dnm.path)
//         enc.addValue(dnm.cause, "string")
//         break
//       case DownType.VSET:
//         this.encodePath(dnm.path)
//         enc.addValue(dnm.recs.length, "size32")
//         for (const rec of dnm.recs) {
//           enc.addValue(rec.key, "uuid")
//           enc.addValue(rec.data, "record")
//         }
//         break
//       case DownType.VDEL:
//         this.encodePath(dnm.path)
//         enc.addValue(dnm.key, "uuid")
//         break
//       case DownType.VERR:
//         this.encodePath(dnm.path)
//         enc.addValue(dnm.cause, "string")
//         break
//       default:
//         this.encodeSync(dnm)
//         break
//       }
//       return this.encoder.finish()
//     } catch (error) {
//       this.encoder.reset()
//       throw error
//     }
//   }

//   encodePath (path :Path) {
//     const enc = this.encoder
//     const knownId = this.pathToId.get(path)
//     if (knownId) enc.addValue(knownId, "size16")
//     else {
//       const newId = this.nextPathId
//       this.nextPathId += 1
//       this.pathToId.set(path, newId)
//       enc.addValue(0, "size16")
//       enc.addValue(newId, "size16")
//       enc.addPath(path)
//     }
//   }
// }

// export class MsgDecoder {
//   private idToPath = new Map<number, Path>()

//   decodeUp (resolver :SyncResolver, dec :Decoder) :UpMsg {
//     const type = dec.getValue("int8")
//     if (DebugLog) log.debug("decodeUp", "type", type)
//     switch (type) {
//     case UpType.AUTH:
//       return {type, source: dec.getValue("string"), id: dec.getValue("uuid"),
//               token: dec.getValue("string")}
//     case UpType.SUB:
//     case UpType.UNSUB:
//     case UpType.VSUB:
//     case UpType.VUNSUB:
//       return {type, path: this.decodePath(dec)}
//     case UpType.TADD:
//       return {type, path: this.decodePath(dec), key: dec.getValue("uuid"),
//               data :dec.getValue("record")}
//     case UpType.TSET:
//       return {type, path: this.decodePath(dec), key: dec.getValue("uuid"),
//               data :dec.getValue("record"), merge :dec.getValue("boolean")}
//     case UpType.TDEL:
//       return {type, path: this.decodePath(dec), key: dec.getValue("uuid")}
//     case UpType.POST:
//       const queue = {path: this.decodePath(dec), index: dec.getValue("size8")}
//       return {type, queue, msg: dec.getValue("record")}
//     default:
//       return this.decodeSync(resolver, type, dec)
//     }
//   }

//   decodeDown (resolver :GetResolver, dec :Decoder) :DownMsg {
//     const type = dec.getValue("int8")
//     if (DebugLog) log.debug("decodeDown", "type", type)
//     switch (type) {
//     case DownType.AUTHED:
//       return {type, id: dec.getValue("uuid")}
//     case DownType.SOBJ:
//       return {type, obj: this.getObject(dec, this.decodePath(dec), resolver)}
//     case DownType.SERR:
//       return {type, path: this.decodePath(dec), cause :dec.getValue("string")}
//     case DownType.VSET:
//       const path = this.decodePath(dec), recs = []
//       for (let ii = 0, ll = dec.getValue("size32"); ii < ll; ii += 1) {
//         recs.push({key: dec.getValue("uuid"), data: dec.getValue("record")})
//       }
//       return {type, path, recs}
//     case DownType.VDEL:
//       return {type, path: this.decodePath(dec), key: dec.getValue("uuid")}
//     case DownType.VERR:
//       return {type, path: this.decodePath(dec), cause :dec.getValue("string")}
//     default:
//       return this.decodeSync(resolver, type, dec)
//     }
//   }

//   decodePath (dec :Decoder) :Path {
//     const knownId = dec.getValue("size16")
//     if (knownId) {
//       const path = this.idToPath.get(knownId)
//       if (!path) throw new Error(`Missing mapping for path id ${knownId}`)
//       return path
//     } else {
//       const newId = dec.getValue("size16"), path = dec.getPath()
//       this.idToPath.set(newId, path)
//       return path
//     }
//   }
// }
