import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {Subject, Value} from "../core/react"
import {ImageResolver} from "./style"
import {Element, ElementConfig, ElementFactory, Prop} from "./element"
import * as B from "./box"
import * as G from "./group"
import * as T from "./text"

export {Root, RootConfig} from "./element"

type SomeElementConfig = B.BoxConfig | T.LabelConfig | G.ColumnConfig

type ModelElem = Value<any> | Model
export interface Model { [key :string] :ModelElem }

export class UI implements ElementFactory {
  private protos = new Map<string,Record>()

  constructor (readonly theme :{[key :string] :Record},
               readonly model :Model,
               readonly resolver :ImageResolver) {}

  createElement (parent :Element, config :ElementConfig) :Element {
    const cfg = this.resolveConfig(config) as SomeElementConfig
    switch (cfg.type) {
    case    "box": return new B.Box(this, parent, cfg)
    case  "label": return new T.Label(this, parent, cfg)
    case "column": return new G.Column(this, parent, cfg)
    default: throw new Error(`Unknown element type '${config.type}'.`)
    }
  }

  resolveProp<T> (prop :Prop<T>) :Value<T> {
    function findProp (model :Model, path :string[], pos :number) :Value<T> {
      const next = model[path[pos]]
      if (!next) throw new Error(`Missing model element at pos ${pos} in ${path}`)
      // TODO: would be nice if we could check the types here and freak out if we hit something
      // weird along the way
      else if (pos < path.length-1) return findProp(next as Model, path, pos+1)
      else return next as Value<T>
    }
    if (typeof prop === "string") return findProp(this.model, prop.split("."), 0)
    else return prop
  }

  resolveConfig<C extends ElementConfig> (config :C) :C {
    const elemProto = this.resolveProto(config.type)
    // TODO: merge in variants config as well
    return (makeConfig([(config as any) as Record, elemProto]) as any) as C
  }

  resolveImage (path :string) :Subject<HTMLImageElement|Error> {
    return this.resolver.resolveImage(path)
  }

  private resolveProto (id :string) :Record {
    const resolve = (id :string, protos :Record[]) => {
      const proto = this.theme[id]
      if (proto) {
        protos.push(proto)
        const parent = proto["parent"]
        if (typeof parent === "string") resolve(parent, protos)
      }
      return protos
    }
    const proto = this.protos.get(id)
    if (proto) return proto
    const nproto = makeConfig(resolve(id, []))
    this.protos.set(id, nproto)
    return nproto
  }
}
