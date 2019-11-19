import {PMap, log} from "../core/util"
import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {ImageResolver, StyleContext, StyleDefs} from "./style"
import {Model, MissingModelElem, MissingConfig} from "./model"
import {Control, Element, ErrorViz, Root} from "./element"

import {BoxCatalog} from "./box"
import {ButtonCatalog} from "./button"
import {CursorCatalog} from "./cursor"
import {Dropdown} from "./dropdown"
import {GraphCatalog} from "./graph"
import {GroupCatalog} from "./group"
import {ImageCatalog} from "./image"
import {List} from "./list"
import {Menu} from "./menu"
import {Property} from "./property"
import {ScrollCatalog} from "./scroll"
import {TabCatalog} from "./tabs"
import {TextCatalog} from "./text"
import {TreeCatalog} from "./tree"

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

  constructor (readonly scope :Element.StyleScope, readonly styles :ElemStyles[]) {
    for (let ii = 0; ii < styles.length; ii += 1) {
      if (!styles[ii]) throw new Error(`Missing styles for scope ${scope.id} @ ${scope.states[ii]}`)
    }
  }

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

const catalog = [
  BoxCatalog, ButtonCatalog, Control.Catalog, CursorCatalog, Dropdown.Catalog, GraphCatalog,
  GroupCatalog, ImageCatalog, List.Catalog, Menu.Catalog, Property.Catalog, ScrollCatalog,
  TabCatalog, TextCatalog, TreeCatalog,
].reduce(Object.assign, {})

export class UI {
  private resolvers = new Map<string,StyleResolver>()
  private readonly style :StyleContext
  private readonly elem :Element.Factory = {
    create: (ctx, parent, config) => this.createElement(ctx, parent, config),
    resolveStyles: <S>(elem :Element, elemStyles :PMap<S>|undefined) :Element.Styles<S> => {
      const styles = this.resolveStyles(elem.styleScope, elem.config.type, elemStyles as any)
      return new Element.Styles(elem, styles as any)
    }
  }

  constructor (private theme :Theme, defs :StyleDefs, image :ImageResolver) {
    this.style = new StyleContext(defs, image)
  }

  createRoot (config :Root.Config, model :Model) :Root {
    return new Root(new Element.Context(model, this.style, this.elem), config)
  }

  createElement (ctx :Element.Context, parent :Element, config :Element.Config) :Element {
    try {
      const maker = catalog[config.type]
      if (maker) return maker(ctx, parent, config)
      else throw new Error(`Unknown element type '${config.type}'.`)

    } catch (error) {
      log.warn(`Failed to create '${config.type}' element: ${error.message}`)
      const logError = !(error instanceof MissingModelElem || error instanceof MissingConfig)
      if (logError) console.warn(error)
      log.warn(`- path to element: ${parent.configPath.concat(config.type)}`)
      log.warn(`- element config: ${JSON.stringify(config)}`)
      if (error instanceof MissingModelElem) {
        log.warn(`- path to model value: ${error.path} (missing @ ${error.pos})`)
      }
      return new ErrorViz(ctx, parent, {type: "error"})
    }
  }

  resolveStyles (scope :Element.StyleScope, type :string, elemStyles :Record|undefined) :Record {
    const protoStyles = this.getStyleResolver(scope).resolveStyles(type)
    return elemStyles ? makeConfig([processStyles(elemStyles, scope.states), protoStyles]) : protoStyles
  }

  private getStyleResolver (scope :Element.StyleScope) :StyleResolver {
    const cached = this.resolvers.get(scope.id)
    if (cached) return cached
    const styles = [this.theme[scope.id]]
    if (scope.id !== "default") styles.push(this.theme["default"])
    const resolver = new StyleResolver(scope, styles)
    this.resolvers.set(scope.id, resolver)
    return resolver
  }
}
