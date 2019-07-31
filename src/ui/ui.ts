import {PMap} from "../core/util"
import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {ImageResolver, StyleContext, StyleDefs} from "./style"
import {Model} from "./model"
import {Element, ElementConfig, ElementContext, StyleScope, Root, RootConfig} from "./element"
import * as E from "./element"
import * as X from "./box"
import * as G from "./group"
import * as T from "./text"
import * as B from "./button"
import * as L from "./list"

/** Defines a set of styles for elements. This is something like:
  * ```
  * {
  *   label: {...default label styles...},
  *   box: {...default box styles...},
  *   button: {...default button styles...},
  * }
  * ```
  * Where the styles for each element are defined by [[T.LabelStyles]], etc. */
type ElemStyles = PMap<Record>

/** Defines the default styles for elements for all the contexts in which elements appear. The
  * `default` context is used for elements that appear outside composite elements. Composite
  * elements define styles for elements nested within them. For example:
  * ```
  * {
  *   default: {label: { ... }, box: { ... } },
  *   button: {label: { ...labels inside buttons... }, box: { ...boxes inside buttons... }}
  * }
  * ``` */
export type Theme = PMap<ElemStyles>

function processStyles (styles :Record, states: string[]) :Record {
  const shared = {...styles}
  for (const state of states) delete shared[state]
  const pstyles :Record = {}
  for (const state of states) {
    pstyles[state] = makeConfig([styles[state] as Record, shared], false)
  }
  return pstyles
}

class StyleResolver {
  private protoStyles = new Map<string,Record>()

  constructor (readonly scope :StyleScope, readonly styles :ElemStyles[]) {}

  resolveStyles (type :string) :Record {
    const cached = this.protoStyles.get(type)
    if (cached) return cached
    const protos = this.styles.map(styles => {
      const proto = styles[type]
      return proto ? processStyles(proto, this.scope.states) : {}
    })
    const proto = makeConfig(protos)
    this.protoStyles.set(type, proto)
    return proto
  }
}

export class UI {
  private resolvers = new Map<string,StyleResolver>()

  readonly ctx :ElementContext

  constructor (private theme :Theme, defs :StyleDefs, image :ImageResolver, model :Model) {
    this.ctx = {
      model,
      style: new StyleContext(defs, image),
      elem: {create: (ctx, parent, config) => this.createElement(ctx, parent, config)},
    }
  }

  createRoot (config :RootConfig) :Root {
    return new Root(this.ctx, config)
  }

  createElement (ctx :ElementContext, parent :Element, config :ElementConfig) :Element {
    const rstyles = this.resolveStyles(parent.styleScope, config.type, config.style as Record)
    const rconfig = {...config, style: rstyles} as any
    switch (config.type) {
    case     "box": return new X.Box(ctx, parent, rconfig as X.BoxConfig)
    case "control": return new E.Control(ctx, parent, rconfig as E.ControlConfig)
    case     "row": return new G.Row(ctx, parent, rconfig as G.RowConfig)
    case  "column": return new G.Column(ctx, parent, rconfig as G.ColumnConfig)
    case   "label": return new T.Label(ctx, parent, rconfig as T.LabelConfig)
    case  "cursor": return new T.Cursor(ctx, parent, rconfig as T.CursorConfig)
    case    "text": return new T.Text(ctx, parent, rconfig as T.TextConfig)
    case  "button": return new B.Button(ctx, parent, rconfig as B.ButtonConfig)
    case    "list": return new L.List(ctx, parent, rconfig as L.ListConfig)
    default: throw new Error(`Unknown element type '${config.type}'.`)
    }
  }

  resolveStyles (scope :StyleScope, type :string, elemStyles :Record|undefined) :Record {
    const protoStyles = this.getStyleResolver(scope).resolveStyles(type)
    return elemStyles ? makeConfig([processStyles(elemStyles, scope.states), protoStyles]) :
      protoStyles
  }

  private getStyleResolver (scope :StyleScope) :StyleResolver {
    const cached = this.resolvers.get(scope.id)
    if (cached) return cached
    const styles = [this.theme[scope.id]]
    if (scope.id !== "default") styles.push(this.theme["default"])
    const resolver = new StyleResolver(scope, styles)
    this.resolvers.set(scope.id, resolver)
    return resolver
  }
}
