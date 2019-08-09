import {Record} from "../core/data"
import {KeyType, ValueType} from "../core/codec"
import {DHandler, DObject, DObjectType} from "./data"

//
// Metadata decorators

type ConstMeta = {type: "const", vtype: ValueType}
type ValueMeta = {type: "value", vtype: ValueType}
type SetMeta = {type: "set", etype: KeyType}
type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType}
type CollectionMeta = {type: "collection", ktype: KeyType, otype: DObjectType<any>}
type QueueMeta = {type: "queue", handler :DHandler<any,any>}
type Meta = ConstMeta | ValueMeta | SetMeta | MapMeta | CollectionMeta | QueueMeta

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
    // TODO: validate properties? (i.e. no dconst after non-const metas?)
  }
}

export const dconst = (vtype :ValueType) =>
  propAdder({type: "const", vtype})
export const dvalue = (vtype :ValueType) =>
  propAdder({type: "value", vtype})
export const dset = (etype :KeyType) =>
  propAdder({type: "set", etype})
export const dmap = (ktype :KeyType, vtype :ValueType) =>
  propAdder({type: "map", ktype, vtype})
export const dqueue = <O extends DObject,M extends Record>(handler :DHandler<O,M>) =>
  propAdder({type: "queue", handler})
export const dcollection = (ktype :KeyType, otype :DObjectType<any>) =>
  propAdder({type: "collection", ktype, otype})
