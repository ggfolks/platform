import {dim2, rect} from "../core/math"
import {PMap} from "../core/util"
import {Element} from "./element"
import {Spec, PaintConfig, DefaultPaint} from "./style"

export interface CursorStyle {
  fill? :Spec<PaintConfig>
  width? :number
}

export interface CursorConfig extends Element.Config {
  type: "cursor"
  blinkPeriod? :number
  style :PMap<CursorStyle>
}

export const DefaultCursor :CursorConfig = {type: "cursor", style: {}}

export class Cursor extends Element {
  private fill = this.observe(DefaultPaint)

  constructor (ctx :Element.Context, parent :Element, readonly config :CursorConfig) {
    super(ctx, parent, config)
    this.fill.observe(this.resolveStyle(
      config.style, s => s.fill, s => ctx.style.resolvePaint(s), DefaultPaint))
  }

  get style () :CursorStyle { return this.getStyle(this.config.style, this.state.current) }
  get lineWidth () :number { return this.style.width || 1 }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {} // not used
  protected relayout () {} // not used

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    this.fill.current.prepFill(canvas)
    const bounds = this.bounds
    canvas.fillRect(bounds[0], bounds[1], bounds[2], bounds[3])
  }
}

export const CursorCatalog :Element.Catalog = {
  "cursor": (ctx, parent, config) => new Cursor(ctx, parent, config as CursorConfig),
}
