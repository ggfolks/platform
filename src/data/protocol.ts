import {log} from "../core/util"
import {UUID} from "../core/uuid"
import {Path} from "../core/path"
import {Record} from "../core/data"
import {Encoder, Decoder, KeyType, ValueType} from "../core/codec"
import {Mutable} from "../core/react"
import {ChannelCodec} from "../channel/channel"
import {Auth, DMutable, DObject, DQueueAddr} from "./data"

const DebugLog = false

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

type ValSetMsg = {type :ObjType.VALSET, idx :number, value :any, vtype: ValueType}
type SetAddMsg = {type :ObjType.SETADD, idx :number, elem :any, etype: KeyType}
type SetDelMsg = {type :ObjType.SETDEL, idx :number, elem :any, etype: KeyType}
type MapSetMsg = {type :ObjType.MAPSET, idx :number,
                  key :any, ktype: KeyType, value :any, vtype: ValueType}
type MapDelMsg = {type :ObjType.MAPDEL, idx :number, key :any, ktype: KeyType}
type DecErrMsg = {type :ObjType.DECERR, otype :ObjType, path :Path, idx :number, cause :string}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg | DecErrMsg

export const enum ObjType { VALSET, SETADD, SETDEL, MAPSET, MAPDEL, DECERR, OBJ, POST }
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
      if (msg.type === ObjType.OBJ) addObject(enc, rcpt, msg.obj)
      else if (msg.type === ObjType.POST) {
        enc.addValue(msg.index, "size8")
        enc.addValue(msg.msg, "record")
      } else {
        enc.addValue(msg.idx, "size8")
        switch (msg.type) {
        case ObjType.VALSET: enc.addValue(msg.value, msg.vtype) ; break
        case ObjType.SETADD: enc.addValue(msg.elem, msg.etype) ; break
        case ObjType.SETDEL: enc.addValue(msg.elem, msg.etype) ; break
        case ObjType.MAPSET: enc.addValue(msg.key, msg.ktype) ; enc.addValue(msg.value, msg.vtype) ; break
        case ObjType.MAPDEL: enc.addValue(msg.key, msg.ktype) ; break
        case ObjType.DECERR: throw new Error(`Illegal to encode DECERR message`)
        }
      }
    },
    decode: (dec) => {
      const type = dec.getValue("int8")
      if (DebugLog) log.debug("decodeObj", "type", type)
      if (type === ObjType.OBJ) return {type, obj: getObject(dec, object)}
      else if (type === ObjType.POST) return {
        type, index: dec.getValue("size8"), msg: dec.getValue("record")}
      else {
        const idx :number = dec.getValue("size8")
        if (DebugLog) log.debug("decodeSync", "obj", object, "idx", idx)
        const syncError = (cause :string) :SyncMsg => ({
          type: ObjType.DECERR, otype: type, path: object.path, idx, cause})
        const meta = object.metas[idx]
        if (!meta) return syncError("No prop at idx")
        const typeMismatch = (type :string, op :string) => syncError(
          `Expected '${type}' property for ${op}, got '${meta.type}`)
        switch (type) {
        case ObjType.VALSET: return (meta.type !== "value") ? typeMismatch("value", "valset") :
          {type, idx, value: dec.getValue(meta.vtype), vtype: meta.vtype}
        case ObjType.SETADD: return (meta.type !== "set") ? typeMismatch("set", "setadd") :
          {type, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
        case ObjType.SETDEL: return (meta.type !== "set") ? typeMismatch("set", "setdel") :
          {type, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
        case ObjType.MAPSET: return (meta.type !== "map") ? typeMismatch("map", "mapset") :
          {type, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype,
                      value: dec.getValue(meta.vtype), vtype: meta.vtype}
        case ObjType.MAPDEL: return (meta.type !== "map") ? typeMismatch("map", "mapdel") :
          {type, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype}
        default: return syncError("Invalid msg type")
        }
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
