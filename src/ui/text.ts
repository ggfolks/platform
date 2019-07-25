import {dim2, vec2} from "../core/math"
import {PMap} from "../core/util"
import {Mutable, Subject, Value} from "../core/react"
import {Control, ControlConfig, Element, ElementConfig, ElementContext, MouseInteraction} from "./element"
import {Spec, FontConfig, PaintConfig, DefaultPaint, ShadowConfig, Span, EmptySpan} from "./style"

/** Defines the styles that apply to [[Label]]. */
export interface LabelStyle {
  font? :Spec<FontConfig>
  fill? :Spec<PaintConfig>
  stroke? :Spec<PaintConfig>
  shadow? :Spec<ShadowConfig>
}

/** Defines configuration for [[Label]]. */
export interface LabelConfig extends ElementConfig {
  type :"label"
  text :string|Value<string>
  style :PMap<LabelStyle>
}

/** Displays styled text. */
export class Label extends Element {
  readonly span = this.observe(EmptySpan)
  readonly text :Value<string>

  constructor (ctx :ElementContext, parent :Element, readonly config :LabelConfig) {
    super(ctx, parent, config)
    this.text = ctx.resolveModel(config.text)
    this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      const fillS = style.fill ? ctx.resolvePaint(style.fill) : Value.constant(undefined)
      const strokeS = style.stroke ? ctx.resolvePaint(style.stroke) : Value.constant(undefined)
      this.span.observe(Subject.join3(this.text, fillS, strokeS).map(([text, fill, stroke]) => {
        const font = ctx.resolveFontOpt(style.font)
        const shadow = ctx.resolveShadowOpt(style.shadow)
        return new Span(text, font, fill, stroke, shadow)
      }))
    })
  }

  render (canvas :CanvasRenderingContext2D) {
    this.span.current.render(canvas, this.x, this.y)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.span.current.size)
  }

  protected relayout () {} // nothing needed
}

type TextAction = (text :Mutable<string>, cursor :Mutable<number>, typed :string) => void

const actions :PMap<TextAction> = {
  // text edits
  insert: (tx, cs, typed) => {
    const ctext = tx.current, ipos = cs.current
    tx.update(ctext.substring(0, ipos) + typed + ctext.substring(ipos))
    cs.update(ipos+1)
  },
  delete: (tx, cs, typed) => {
    const ctext = tx.current, ipos = cs.current
    if (ipos < ctext.length) {
      tx.update(ctext.substring(0, ipos) + ctext.substring(ipos+1))
    }
  },
  backspace: (tx, cs, typed) => {
    const ctext = tx.current, ipos = cs.current
    if (ipos > 0) {
      tx.update(ctext.substring(0, ipos-1) + ctext.substring(ipos))
      cs.update(ipos-1)
    }
  },
  // moving the cursor around
  cursorStart: (tx, cs, typed) => cs.update(0),
  cursorLeft: (tx, cs, typed) => cs.update(Math.max(cs.current-1, 0)),
  cursorRight: (tx, cs, typed) => cs.update(Math.min(cs.current+1, tx.current.length)),
  cursorEnd: (tx, cs, typed) => cs.update(tx.current.length),
}

const ShiftMask = 1 << 0
const AltMask   = 1 << 1
const CtrlMask  = 1 << 2
const MetaMask  = 1 << 3

function modMask (event :KeyboardEvent) :number {
  let mask = 0
  if (event.shiftKey) mask |= ShiftMask
  if (event.altKey) mask |= AltMask
  if (event.ctrlKey) mask |= CtrlMask
  if (event.metaKey) mask |= MetaMask
  return mask
}

type ModMap = {[key :number] :string}
type KeyMap = PMap<ModMap>

const keyMap :KeyMap = {
  // "Standard" key bindings
  Backspace: {0: "backspace"},
  Delete: {0: "delete"},
  ArrowLeft: {0: "cursorLeft", [ShiftMask]: "cursorStart"},
  ArrowRight: {0: "cursorRight", [ShiftMask]: "cursorEnd"},
  Home: {0: "cursorStart"},
  End: {0: "cursorEnd"},

  // Emacs key bindings
  KeyA: {[CtrlMask]: "cursorStart"},
  KeyE: {[CtrlMask]: "cursorEnd"},
  KeyD: {[CtrlMask]: "delete"},
  KeyH: {[CtrlMask]: "backspace"},
}

/** Defines the styles that apply to [[Text]]. */
export interface TextStyle {
  cursorStroke? :Spec<PaintConfig>
  cursorWidth? :number
}

/** Defines configuration for [[Text]]. */
export interface TextConfig extends ControlConfig {
  type :"text"
  text :Spec<Mutable<string>>
  style :PMap<TextStyle>
}

const TextStyleScope = {id: "text", states: ["normal", "disabled", "focused"]}

/** Displays a span of editable text. */
export class Text extends Control {
  private cursorStroke = this.observe(DefaultPaint)
  readonly text :Mutable<string>
  readonly cursor = Mutable.local(0)
  readonly label :Label

  constructor (ctx :ElementContext, parent :Element, readonly config :TextConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this.cursor)
    this.text = ctx.resolveModel(config.text)
    const label = this.contents.findChild("label")
    if (label) this.label = label as Label
    else throw new Error(`Text control must have Label child [config=${JSON.stringify(config)}].`)
    this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      if (style.cursorStroke) this.cursorStroke.observe(ctx.resolvePaint(style.cursorStroke))
      else this.cursorStroke.update(DefaultPaint)
    })
  }

  get styleScope () { return TextStyleScope }
  get style () :TextStyle { return this.getStyle(this.config.style, this.state.current) }

  render (canvas :CanvasRenderingContext2D) {
    super.render(canvas)
    if (this.isFocused) {
      const cx = this.label.x + this.label.span.current.measureAdvance(this.cursor.current)
      const ly = this.label.y, lh = this.label.height
      const cursorStroke = this.cursorStroke.current
      cursorStroke.prepStroke(canvas)
      canvas.beginPath()
      canvas.moveTo(cx, ly)
      canvas.lineTo(cx, ly+lh)
      canvas.lineWidth = this.style.cursorWidth || 1
      canvas.stroke()
      canvas.lineWidth = 1
    }
  }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined
    this.focus()
    // position the cursor based on where the click landed
    this.cursor.update(this.label.span.current.computeOffset(pos[0] - this.label.x))
    // return a no-op mouse interaction to indicate that we handled the press
    return {
      move: (event, pos) => {},
      release: () => {},
      cancel: () => {}
    }
  }

  handleKeyEvent (event :KeyboardEvent) {
    if (event.type === "keydown") {
      const supportsChar = typeof event.char === "string"
      const isPrintable = (
        (supportsChar && event.char !== "") || // new hotness
        (event.key.length === 1) // old and busted
      )
      const typed = isPrintable ? (supportsChar ? event.char : event.key) : ""
      const modMap = keyMap[event.code]
      const mask = modMask(event), binding = modMap && modMap[mask]
      if (binding) {
        const action = actions[binding]
        if (action) {
          action(this.text, this.cursor, typed)
        } else {
          console.warn(`Invalid binding for ${event.key} (mods: ${mask}): '${action}'`)
        }
      } else if (isPrintable) {
        actions.insert(this.text, this.cursor, typed)
      }
    }
    // let the browser know we handled this event
    event.preventDefault()
  }
}
