import {Record} from "../core/data"
import {Encoder, Decoder, KeyType, ValueType} from "../core/codec"
import {Mutable} from "../core/react"
import {DObject, Path} from "./data"

export const enum SyncType { VALSET, SETADD, SETDEL, MAPSET, MAPDEL }
type ValSetMsg = {type :SyncType.VALSET, name :string, value :any, vtype: ValueType}
type SetAddMsg = {type :SyncType.SETADD, name :string, elem :any, etype: KeyType}
type SetDelMsg = {type :SyncType.SETDEL, name :string, elem :any, etype: KeyType}
type MapSetMsg = {type :SyncType.MAPSET, name :string,
                  key :any, ktype: KeyType, value :any, vtype: ValueType}
type MapDelMsg = {type :SyncType.MAPDEL, name :string, key :any, ktype: KeyType}
export type SyncMsg = ValSetMsg | SetAddMsg | SetDelMsg | MapSetMsg | MapDelMsg

type OidSyncMsg = SyncMsg & {oid: number}

export const enum UpType   { /* SyncType is 0-4 */ SUB = 5, UNSUB, POST }
export type UpMsg = {type :UpType.SUB, path :Path, oid :number}
                  | {type :UpType.UNSUB, oid :number}
                  | {type :UpType.POST, msg :Record}
                  | OidSyncMsg

export const enum DownType { /* SyncType is 0-4 */ SUBOBJ = 5, SUBERR }
export type DownMsg = {type :DownType.SUBOBJ, oid :number, obj :DObject}
                    | {type :DownType.SUBERR, oid :number, cause :string}
                    | OidSyncMsg

function encodeSync (sym :OidSyncMsg, enc :Encoder) {
  enc.addValue(sym.name, "string")
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
  // TODO: paths can be numbers in addition to strings, need to handle specially?
  case UpType.SUB  : enc.addValue(upm.oid, "size32"); enc.addArray(upm.path, "string") ; break
  case UpType.UNSUB: enc.addValue(upm.oid, "size32") ; break
  case UpType.POST : enc.addValue(upm.msg, "record") ; break
  default: encodeSync(upm, enc)
  }
}

export function encodeDown (dnm :DownMsg, enc :Encoder) {
  enc.addValue(dnm.type, "int8")
  switch (dnm.type) {
  case DownType.SUBOBJ: enc.addValue(dnm.oid, "size32") ; addObject(dnm.obj, enc) ; break
  case DownType.SUBERR: enc.addValue(dnm.oid, "size32") ; enc.addValue(dnm.cause, "string") ; break
  default: encodeSync(dnm, enc)
  }
}

function decodeSync (objects :Map<number, DObject>, type :SyncType, dec :Decoder) :OidSyncMsg {
  const oid :number = dec.getValue("size32"), obj = objects.get(oid)
  if (!obj) throw new Error(`Got sync for unknown object [type=${type}, oid=${oid}]`)
  const name = dec.getValue("string")
  const meta = obj.metas.get(name)
  if (!meta) throw new Error(
    `Got sync for unknown object property [type=${type}, oid=${oid}, name=${name}]`)
  const typeMismatch = () => new Error(`Expected 'value' property for valset, got '${meta.type}`)
  switch (type) {
  case SyncType.VALSET:
    if (meta.type !== "value") throw typeMismatch()
    else return {type, oid, name, value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.SETADD:
    if (meta.type !== "set") throw typeMismatch()
    else return {type, oid, name, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.SETDEL:
    if (meta.type !== "set") throw typeMismatch()
    else return {type, oid, name, elem: dec.getValue(meta.etype), etype: meta.etype}
  case SyncType.MAPSET:
    if (meta.type !== "map") throw typeMismatch()
    else return {type, oid, name,
    key: dec.getValue(meta.ktype), ktype: meta.ktype,
    value: dec.getValue(meta.vtype), vtype: meta.vtype}
  case SyncType.MAPDEL:
    if (meta.type !== "map") throw typeMismatch()
    else return {type, oid, name, key: dec.getValue(meta.ktype), ktype: meta.ktype}
  default: throw new Error(`Invalid req type '${type}'`)
  }
}

export function decodeUp (objects :Map<number, DObject>, dec :Decoder) :UpMsg {
  const type = dec.getValue("int8")
  switch (type) {
  // TODO: paths can be numbers in addition to strings, need to handle specially?
  case UpType.SUB: return {type, path: dec.getArray("string"), oid: dec.getValue("size32")}
  case UpType.UNSUB: return {type, oid: dec.getValue("size32")}
  default: return decodeSync(objects, type, dec)
  }
}

export function decodeDown (objects :Map<number, DObject>, dec :Decoder) :DownMsg {
  const type = dec.getValue("int8")
  switch (type) {
  case DownType.SUBOBJ:
    const oid = dec.getValue("size32"), obj = objects.get(oid)
    if (!obj) throw new Error(`Got sync for unknown object [type=${type}, oid=${oid}]`)
    return {type, oid, obj: getObject(dec, obj)}
  case DownType.SUBERR: return {type, oid: dec.getValue("size32"), cause :dec.getValue("string")}
  default: return decodeSync(objects, type, dec)
  }
}

export function addObject (obj :DObject, enc :Encoder) {
  for (const [prop, meta] of obj.metas.entries()) {
    switch (meta.type) {
    case "value": enc.addValue((obj[prop] as Mutable<any>).current, meta.vtype) ; break
    case "set": enc.addSet((obj[prop] as Set<any>), meta.etype) ; break
    case "map": enc.addMap((obj[prop] as Map<any, any>), meta.ktype, meta.vtype) ; break
    case "collection": break // TODO: anything?
    case "queue": break // TODO: anything?
    }
  }
}

export function getObject<T extends DObject> (dec :Decoder, into :T) :T {
  for (const [prop, meta] of into.metas.entries()) {
    switch (meta.type) {
    case "value": (into[prop] as Mutable<any>).update(dec.getValue(meta.vtype)) ; break
    case "set": dec.syncSet(meta.etype, (into[prop] as Set<any>)) ; break
    case "map": dec.syncMap(meta.ktype, meta.vtype, (into[prop] as Map<any, any>)) ; break
    case "collection": break // TODO: anything?
    case "queue": break // TODO: anything?
    }
  }
  return into
}
