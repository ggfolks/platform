import {dim2, rect} from "../core/math"
import {log, developMode} from "../core/util"
import {ElementsModel, ModelKey, Spec} from "./model"
import {Element} from "./element"
import {Group} from "./group"
import {ElementConfigMaker, List} from "./list"

const tmpr = rect.create()
const gaps = (gap :number|undefined, count :number) => (gap||0) * Math.max(0, count-1)
const sum = (ns :number[]) => ns.reduce((a, b) => a+b, 0)

export namespace Grid {
  export interface Config extends Element.Config {
    hgap? :number
    vgap? :number
  }

  type Metrics = {max :number, total :number}

  type GridMetrics = {
    rows :Metrics[]
    cols :Metrics[]
  }

  function note (size :number, ms :Metrics[], idx :number) {
    const m = ms[idx] || (ms[idx] = {max: 0, total: 0})
    m.max = Math.max(m.max, size)
    m.total += size
  }

  function computeGridMetrics (
    elems :Element[], cols :number, hgap :number|undefined, hintX :number, hintY :number
  ) :GridMetrics {
    const hintCol = (hintX - gaps(hgap, cols)) / cols
    const m :GridMetrics = {rows: [], cols: []}
    let col = 0, row = 0
    for (const elem of elems) {
      if (!elem.visible.current) continue
      const psize = elem.preferredSize(hintCol, hintY)
      note(psize[0], m.cols, col)
      note(psize[1], m.rows, row)
      if (++col === cols) { col = 0 ; row += 1 }
    }
    return m
  }

  export interface VertConfig extends Config {
    cols :number
  }

  export abstract class Vert extends Group {

    constructor (ctx :Element.Context, parent :Element, readonly config :VertConfig) {
      super(ctx, parent, config)
    }

    protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
      const {cols, hgap, vgap} = this.config
      const m = computeGridMetrics(this.contents, cols, hgap, hintX, hintY)
      const width = sum(m.cols.map(c => c.max)) + gaps(hgap, cols)
      const height = sum(m.rows.map(c => c.max)) + gaps(vgap, m.rows.length)
      dim2.set(into, width, height)
    }

    protected relayout () {
      const {cols, hgap, vgap} = this.config, bounds = this.bounds
      const left = bounds[0], top = bounds[1], width = bounds[2], height = bounds[3]
      const m = computeGridMetrics(this.contents, cols, hgap||0, width, height)

      let x = left, y = top, col = 0, row = 0
      for (const elem of this.contents) {
        if (!elem.visible.current) continue
        const cwidth = m.cols[col].max, cheight = m.rows[row].max
        elem.setBounds(rect.set(tmpr, x, y, cwidth, cheight))
        x += cwidth+ (hgap||0)
        if (++col === cols) {
          col = 0
          row += 1
          x = left
          y += cheight + (vgap||0)
        }
      }
      const layHeight = y - top - (vgap||0)
      this.overflowed = layHeight > this.bounds[3]
      if (developMode && this.overflowed) log.warn(
        "Vertical grid overflowed bounds", "group", this, "height", layHeight)
    }
  }

  /** Defines configuration for [[Column]] elements. */
  export interface ColumnConfig extends VertConfig {
    type :"colgrid"
    contents: Element.Config[]
  }

  /** Displays its (static list of) child elements in a vertically oriented grid. */
  export class Column extends Vert {
    readonly contents :Element[]

    constructor (ctx :Element.Context, parent :Element, readonly config :ColumnConfig) {
      super(ctx, parent, config)
      this.contents = config.contents.map(cc => ctx.elem.create(ctx, this, cc))
    }
  }

  /** Defines configuration for [[VertList]] elements. */
  export interface VertListConfig extends VertConfig {
    type :"vlistgrid"
    element :Element.Config|ElementConfigMaker
    model :Spec<ElementsModel<ModelKey>>
  }

  /** Displays a dynamic list of elements in a vertically oriented grid. Each element is
    * instantiated from an element template and a sub-model. */
  export class VertList extends Vert implements List.Like {
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    constructor (ctx :Element.Context, parent :Element, readonly config :VertListConfig) {
      super(ctx, parent, config)
      this.disposer.add(List.syncContents(ctx, this, ctx.model.resolveAs(config.model, "model")))
    }
  }

  export const Catalog :Element.Catalog = {
    // "row": (ctx, parent, cfg) => new Row(ctx, parent, cfg as RowConfig),
    "colgrid": (ctx, parent, cfg) => new Column(ctx, parent, cfg as ColumnConfig),
    "vlistgrid": (ctx, parent, cfg) => new VertList(ctx, parent, cfg as VertListConfig),
  }
}
