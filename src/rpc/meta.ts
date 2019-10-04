import {ValueType} from "../core/codec"

//
// Metadata decorators

export type CallMeta = {type: "call", name :string, index :number, args :ValueType[]}
export type ReqMeta = {type: "req", name :string, index :number, args :ValueType[], rval :ValueType}
export type MethodMeta = CallMeta | ReqMeta

export function getMethodMetas (proto :Function|Object) :MethodMeta[] {
  const atarget = proto as any
  const metas = atarget["__metas__"]
  if (metas) return metas
  return atarget["__metas__"] = []
}

export function rservice (ctor :Function) {
  // TODO: anything?
}

export function rcall (...args :ValueType[]) {
  return (proto :Function|Object, name :string, desc? :PropertyDescriptor) => {
    const metas = getMethodMetas(proto), index = metas.length
    if (index > 255) throw new Error(`Service cannot have more than 255 methods.`)
    metas.push({type: "call", name, index, args})
  }
}

export function rreq (args :ValueType[], rval :ValueType) {
  return (proto :Function|Object, name :string, desc? :PropertyDescriptor) => {
    const metas = getMethodMetas(proto), index = metas.length
    if (index > 255) throw new Error(`Service cannot have more than 255 methods.`)
    metas.push({type: "req", name, index, args, rval})
  }
}
