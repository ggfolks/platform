import {Record} from "../core/data"
import {KeyType, ValueType} from "../core/codec"
import {DHandler, DObject, DObjectType} from "./data"

//
// Metadata decorators

export type ValueMeta = {type: "value", vtype: ValueType, persist :boolean}
export type SetMeta = {type: "set", etype: KeyType, persist :boolean}
export type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType, persist :boolean}
export type CollectionMeta = {type: "collection", otype: DObjectType<any>}
export type QueueMeta = {type: "queue", handler :DHandler<any,any>}
export type Meta = ValueMeta | SetMeta | MapMeta | CollectionMeta | QueueMeta

export type PropMeta = Meta & {name :string, index :number}

export function isPersist (meta :Meta) {
  switch (meta.type) {
  case "value":
  case "set":
  case "map": return meta.persist
  default: return false
  }
}
export function getPropMetas (proto :Function|Object) :PropMeta[] {
  const atarget = proto as any
  const props = atarget["__props__"]
  if (props) return props
  return atarget["__props__"] = []
}

export function dobject (ctor :Function) {
  // const atarget = ctor.prototype as any
  // TODO: anything?
}

function propAdder (meta :Meta) {
  return (proto :Function|Object, name :string, desc? :PropertyDescriptor) => {
    const props = getPropMetas(proto), index = props.length
    if (index > 255) throw new Error(`DObject cannot have more than 255 properties.`)
    props.push({...meta, index, name})
  }
}

export const dvalue = (vtype :ValueType, persist = false) =>
  propAdder({type: "value", vtype, persist})
export const dset = (etype :KeyType, persist = false) =>
  propAdder({type: "set", etype, persist})
export const dmap = (ktype :KeyType, vtype :ValueType, persist = false) =>
  propAdder({type: "map", ktype, vtype, persist})
export const dqueue = <O extends DObject,M extends Record>(handler :DHandler<O,M>) =>
  propAdder({type: "queue", handler})
export const dcollection = (otype :DObjectType<any>) =>
  propAdder({type: "collection", otype})
