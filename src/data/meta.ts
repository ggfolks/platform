import {Record} from "../core/data"
import {KeyType, ValueType} from "../core/codec"
import {DHandler, DObject, DObjectType} from "./data"

//
// Metadata decorators

export type ValueMeta = {type: "value", vtype: ValueType}
export type SetMeta = {type: "set", etype: KeyType}
export type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType}
export type CollectionMeta = {type: "collection", otype: DObjectType<any>}
export type QueueMeta = {type: "queue", handler :DHandler<any,any>}
export type Meta = ValueMeta | SetMeta | MapMeta | CollectionMeta | QueueMeta

export type PropMeta = Meta & {name :string, index :number}

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

export const dvalue = (vtype :ValueType) =>
  propAdder({type: "value", vtype})
export const dset = (etype :KeyType) =>
  propAdder({type: "set", etype})
export const dmap = (ktype :KeyType, vtype :ValueType) =>
  propAdder({type: "map", ktype, vtype})
export const dqueue = <O extends DObject,M extends Record>(handler :DHandler<O,M>) =>
  propAdder({type: "queue", handler})
export const dcollection = (otype :DObjectType<any>) =>
  propAdder({type: "collection", otype})
