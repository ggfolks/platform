import {UUID} from "../core/uuid"
import {Record} from "../core/data"
import {KeyType, ValueType} from "../core/codec"
import {DHandler, DObject, DObjectType} from "./data"

//
// View configuration

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

export type DObjectTypeMap<O extends DObject> = (uuid :UUID) => DObjectType<O>

export type ValueMeta = {type: "value", vtype: ValueType, persist :boolean}
export type SetMeta = {type: "set", etype: KeyType, persist :boolean}
export type MapMeta = {type: "map", ktype: KeyType, vtype: ValueType, persist :boolean}
export type CollectionMeta = {type: "collection", otype: DObjectTypeMap<any>}
export type SingletonMeta = {type: "singleton", otype: DObjectType<any>}
export type TableMeta = {type: "table"}
export type ViewMeta = {type: "view", table :string, where :WhereClause[], order :OrderClause[]}
export type QueueMeta = {type: "queue", handler :DHandler<any,any>, system :boolean}
export type Meta = ValueMeta | SetMeta | MapMeta | CollectionMeta | SingletonMeta
                 | TableMeta | ViewMeta | QueueMeta

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

export function tableForView (
  metas :PropMeta[], view :Named<ViewMeta>
) :Named<TableMeta> {
  const table = metas.find(m => m.type === "table" && m.name === view.table)
  if (!table) throw new Error(
    `View (${view.name}) refers to unknown table (${view.table}). ` +
      `Views must be declared after the table they index.`)
  if (table.type !== "table") throw new Error(
    `View (${view.name}) refers to non-table property (${view.table}).`)
  return table
}

export function getPropMetas (proto :Function|Object) :PropMeta[] {
  const atarget = proto as any
  if (atarget.hasOwnProperty("__props__")) return atarget["__props__"]
  const parentProps = atarget["__props__"]
  return atarget["__props__"] = (parentProps ? parentProps.slice() : [])
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
  propAdder({type: "collection", otype: id => otype})
export const dhierarchy = (otype :DObjectTypeMap<any>) =>
  propAdder({type: "collection", otype})
export const dsingleton = (otype :DObjectType<any>) =>
  propAdder({type: "singleton", otype})
export const dtable = () =>
  propAdder({type: "table"})
export const dview = (table :string, where :WhereClause[], order :OrderClause[] = []) =>
  propAdder({type: "view", table, where, order})
export const dqueue = <O extends DObject,M extends Record>(
  handler :DHandler<O,M>, system = false) => propAdder({type: "queue", handler, system})
