import {Record} from "../core/data"
import {Encoder, Decoder, KeyType, ValueType} from "../core/codec"
import {Mutable} from "../core/react"
import {Auth, DObject, DQueueAddr, Path} from "./data"

export const enum SyncType { VALSET, SETADD, SETDEL, MAPSET, MAPDEL }
type ValSetMsg = {type :SyncType.VALSET, idx :number, value :any, vtype: ValueType}
type SetAddMsg = {type :SyncType.SETADD, idx :number, elem :any, etype: KeyType}
type SetDelMsg = {type :SyncType.SETDEL, idx :number, elem :any, etype: KeyType}
type MapSetMsg = {type :SyncType.MAPSET, idx :number,
                  key :any, ktype: KeyType, value :any, vtype: ValueType}
type MapDelMsg = {type :SyncType.MAPDEL, idx :number, key :any, ktype: KeyType}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg

type OidSyncMsg = SyncMsg & {oid: number}

export const enum UpType   { /* SyncType is 0-4 */ SUB = 5, UNSUB, POST }
export type UpMsg = {type :UpType.SUB, path :Path, oid :number}
                  | {type :UpType.UNSUB, oid :number}
                  | {type :UpType.POST, queue :DQueueAddr, msg :Record}
                  | OidSyncMsg

export const enum DownType { /* SyncType is 0-4 */ SUBOBJ = 5, SUBERR }
export type DownMsg = {type :DownType.SUBOBJ, oid :number, obj :DObject}
                    | {type :DownType.SUBERR, oid :number, cause :string}
                    | OidSyncMsg

function encodeSync (sym :OidSyncMsg, enc :Encoder) {
  enc.addValue(sym.idx, "size8")
  enc.addValue(sym.oid, "size32")
  switch (sym.type) {
  case SyncType.VALSET: enc.addValue(sym.value, sym.vtype) ; break
  case SyncType.SETADD: enc.addValue(sym.elem, sym.etype) ; break
  case SyncType.SETDEL: enc.addValue(sym.elem, sym.etype) ; break
  case SyncType.MAPSET: enc.addValue(sym.key, sym.ktype) ; enc.addValue(sym.value, sym.vtype) ; break
  case SyncType.MAPDEL: enc.addValue(sym.key, sym.ktype) ; break
  }
}

export function encodeUp (upm :UpMsg, enc :Encoder) {
  enc.addValue(upm.type, "int8")
  switch (upm.type) {
  case UpType.SUB:
    enc.addValue(upm.oid, "size32")
    addPath(upm.path, enc)
    break
  case UpType.UNSUB:
    enc.addValue(upm.oid, "size32")
    break
  case UpType.POST:
    addPath(upm.queue.path, enc)
    enc.addValue(upm.queue.index, "size8")
    enc.addValue(upm.msg, "record")
    break
  default:
    enc.addValue(upm.oid, "size32")
    encodeSync(upm, enc)
    break
  }
}

export function encodeDown (rcpt :Auth, dnm :DownMsg, enc :Encoder) {
  enc.addValue(dnm.type, "int8")
  switch (dnm.type) {
  case DownType.SUBOBJ:
    enc.addValue(dnm.oid, "size32")
    addObject(rcpt, dnm.obj, enc)
    break
  case DownType.SUBERR:
    enc.addValue(dnm.oid, "size32")
    enc.addValue(dnm.cause, "string")
    break
  default:
    encodeSync(dnm, enc)
    break
  }
}

type ObjectResolver = (oid :number) => DObject|undefined

function decodeSync (objects :ObjectResolver, type :SyncType, dec :Decoder) :OidSyncMsg {
  const oid :number = dec.getValue("size32"), obj = objects(oid)
  if (!obj) throw new Error(`Got sync for unknown object [type=${type}, oid=${oid}]`)
  const idx = dec.getValue("size8")
  const meta = obj.metas[idx]
  if (!meta) throw new Error(
    `Got sync for unknown object property [type=${type}, oid=${oid}, name=${name}]`)
  const typeMismatch = () => new Error(`Expected 'value' property for valset, got '${meta.type}`)
  switch (type) {
  case SyncType.VALSET:
    if (meta.type !== "value") throw typeMismatch()
    else return {type, oid, idx, value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.SETADD:
    if (meta.type !== "set") throw typeMismatch()
    else return {type, oid, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.SETDEL:
    if (meta.type !== "set") throw typeMismatch()
    else return {type, oid, idx, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.MAPSET:
    if (meta.type !== "map") throw typeMismatch()
    else return {type, oid, idx,
    key: dec.getValue(meta.ktype), ktype: meta.ktype,
    value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.MAPDEL:
    if (meta.type !== "map") throw typeMismatch()
    else return {type, oid, idx, key: dec.getValue(meta.ktype), ktype: meta.ktype}
  default: throw new Error(`Invalid req type '${type}'`)
  }
}

export function decodeUp (objects :ObjectResolver, dec :Decoder) :UpMsg {
  const type = dec.getValue("int8")
  switch (type) {
  case UpType.SUB:
    return {type, oid: dec.getValue("size32"), path: getPath(dec)}
  case UpType.UNSUB:
    return {type, oid: dec.getValue("size32")}
  case UpType.POST:
    const queue = {path: getPath(dec), index: dec.getValue("size8")}
    return {type, queue, msg: dec.getValue("record")}
  default:
    return decodeSync(objects, type, dec)
  }
}

export function decodeDown (objects :ObjectResolver, dec :Decoder) :DownMsg {
  const type = dec.getValue("int8")
  switch (type) {
  case DownType.SUBOBJ:
    const oid = dec.getValue("size32"), obj = objects(oid)
    if (!obj) throw new Error(`Got sync for unknown object [type=${type}, oid=${oid}]`)
    return {type, oid, obj: getObject(dec, obj)}
  case DownType.SUBERR: return {type, oid: dec.getValue("size32"), cause :dec.getValue("string")}
  default: return decodeSync(objects, type, dec)
  }
}

// TODO: paths can be numbers in addition to strings, need to handle specially
function addPath (path :Path, enc :Encoder) { enc.addArray(path, "string") }
function getPath (dec :Decoder) :string[] { return dec.getArray("string") }

export function addObject (rcpt :Auth, obj :DObject, enc :Encoder) {
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

export function getObject<T extends DObject> (dec :Decoder, into :T) :T {
  while (true) {
    const idx = dec.getValue("size8")
    if (idx === 255) break
    const meta = into.metas[idx], prop = into[meta.name]
    switch (meta.type) {
    case "value": (prop as Mutable<any>).update(dec.getValue(meta.vtype)) ; break
    case "set": dec.syncSet(meta.etype, (prop as Set<any>)) ; break
    case "map": dec.syncMap(meta.ktype, meta.vtype, (prop as Map<any, any>)) ; break
    case "collection": break // TODO: anything?
    case "queue": break // TODO: anything?
    }
  }
  return into
}
