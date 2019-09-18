import {Record} from "../core/data"
import {KeyType, ValueType} from "../core/codec"
import {DHandler, DObject, DObjectType} from "./data"

//
// Index configuration

export type WhereOp = "<" | "<=" | "==" | ">=" | ">" | "array-contains"
export type Order = "asc" | "desc"

export type WhereValue = boolean|number|string
export type WhereClause = {prop :string, op :WhereOp, value :WhereValue}
export type OrderClause = {prop :string, order :Order}

export function where (prop :string, op :WhereOp, value :WhereValue) :WhereClause {
  return {prop, op, value}
}

export function orderBy (prop :string, order :Order) :OrderClause {
  return {prop, order}
}

//
// Metadata decorators

export type ValueMeta = {type: "value", vtype: ValueType, persist :boolean}
export type SetMeta = {type: "set", etype: KeyType, persist :boolean}
export type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType, persist :boolean}
export type CollectionMeta = {type: "collection", otype: DObjectType<any>}
export type IndexMeta = {type: "index", collection :string, where :WhereClause[],
                         order :OrderClause[]}
export type QueueMeta = {type: "queue", handler :DHandler<any,any>}
export type Meta = ValueMeta | SetMeta | MapMeta | CollectionMeta | IndexMeta | QueueMeta

export type Named<T> = T & {name :string, index :number}
export type PropMeta = Named<Meta>

export function isPersist (meta :Meta) {
  switch (meta.type) {
  case "value":
  case "set":
  case "map": return meta.persist
  default: return false
  }
}

export function collectionForIndex (
  metas :PropMeta[], index :Named<IndexMeta>
) :Named<CollectionMeta> {
  const collection = metas.find(m => m.type === "collection" && m.name === index.collection)
  if (!collection) throw new Error(
    `Index (${index.name}) refers to unknown collection (${index.collection}). ` +
      `Indices must be declared after the collection they index.`)
  if (collection.type !== "collection") throw new Error(
    `Index (${index.name}) refers to non-collection property (${index.collection}).`)
  return collection
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
export const dcollection = (otype :DObjectType<any>) =>
  propAdder({type: "collection", otype})
export const dindex = (collection :string, where :WhereClause[], order :OrderClause[] = []) =>
  propAdder({type: "index", collection, where, order})
export const dqueue = <O extends DObject,M extends Record>(handler :DHandler<O,M>) =>
  propAdder({type: "queue", handler})
