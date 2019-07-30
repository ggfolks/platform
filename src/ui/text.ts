import {dim2, vec2, rect} from "../core/math"
import {refEquals} from "../core/data"
import {PMap} from "../core/util"
import {Mutable, Subject, Value} from "../core/react"
import {makeRectPath} from "./util"
import {Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext,
        MouseInteraction} from "./element"
import {Spec, FontConfig, Paint, PaintConfig, DefaultPaint, ShadowConfig,
        Span, EmptySpan} from "./style"
import {Action, NoopAction} from "./model"

const tmpr = rect.create()

/** Defines the styles that apply to [[Label]]. */
export interface LabelStyle {
  font? :Spec<FontConfig>
  fill? :Spec<PaintConfig>
  stroke? :Spec<PaintConfig>
  shadow? :Spec<ShadowConfig>
  selection? :{
    fill? :Spec<PaintConfig>
  }
}

/** Defines configuration for [[Label]]. */
export interface LabelConfig extends ElementConfig {
  type :"label"
  text :Spec<Value<string>>
  style :PMap<LabelStyle>
}

/** Displays styled text. */
export class Label extends Element {
  readonly xoffset = Mutable.local(0)
  readonly selection = Mutable.local<[number,number]>([0,0])
  readonly span = this.observe(EmptySpan)
  readonly selFill = this.observe<Paint|undefined>(undefined)
  readonly text :Value<string>
  private selOff = 0
  private selWid = 0

  constructor (ctx :ElementContext, parent :Element, readonly config :LabelConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this.selection)
    this.text = ctx.model.resolve(config.text)
    this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      const fillS = ctx.style.resolvePaintOpt(style.fill)
      const strokeS = ctx.style.resolvePaintOpt(style.stroke)
      this.span.observe(Subject.join3(this.text, fillS, strokeS).map(([text, fill, stroke]) => {
        const font = ctx.style.resolveFontOpt(style.font)
        const shadow = ctx.style.resolveShadowOpt(style.shadow)
        return new Span(text, font, fill, stroke, shadow)
      }))
      if (!style.selection || !style.selection.fill) this.selFill.update(undefined)
      else this.selFill.observe(ctx.style.resolvePaint(style.selection.fill))
    })
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.span.current.size)
  }

  protected relayout () {
    // clamp our x offset so we don't have empty space on the right (TODO: or left?)
    const width = this.width, span = this.span.current, swidth = span.size[0]
    if (this.xoffset.current + swidth < width) this.xoffset.update(width-swidth)
    // if we have a selection, compute its x position & width
    const [ss, se] = this.selection.current
    if (ss < se) {
      this.selOff = span.measureAdvance(ss)
      this.selWid = span.measureAdvance(se) - this.selOff
    } else this.selWid = 0
  }

  protected rerender (canvas :CanvasRenderingContext2D) {
    const {x, y, width, height, xoffset} = this
    const span = this.span.current, rx = x + xoffset.current
    const needClip = rx < 0 || span.size[0] > width
    if (needClip) {
      canvas.save()
      makeRectPath(canvas, x, y, width, height)
      canvas.clip()
    }
    // if we have a selection fill and a selection, render it
    const selFill = this.selFill.current, selOff = this.selOff, selWid = this.selWid
    if (selFill && selWid > 0) {
      selFill.prepFill(canvas)
      canvas.fillRect(rx + selOff, y, selWid, height)
    }
    // render our label
    span.render(canvas, rx, y)
    if (needClip) canvas.restore()
  }
}

async function readClipText () :Promise<string|undefined> {
  if (navigator.clipboard.readText) return navigator.clipboard.readText()
  // note: Firefox doesn't support clipboard-read permission yet... sigh
  const desc = {name: "clipboard-read"} as any as PermissionDescriptor
  const res = await navigator.permissions.query(desc)
  if (res.state === "granted" || res.state === "prompt") return navigator.clipboard.readText()
  else return undefined
}

type TextState = {
  text: Mutable<string>,
  cursor: Mutable<number>,
  selection: Mutable<[number,number]>
}
type TextAction = (state :TextState, typed :string) => void

// TODO: do we want to support a simple undo mechanism for text editing? would be nice if it
// factored into a larger undo framework...

const actions :PMap<TextAction> = {
  // text edits
  insert: (state, typed) => {
    const ctext = state.text.current, [sstart, send] = state.selection.current
    if (sstart < send) {
      state.text.update(ctext.substring(0, sstart) + typed + ctext.substring(send))
      state.cursor.update(sstart+typed.length)
      state.selection.update([0, 0])
    } else {
      const ipos = state.cursor.current
      state.text.update(ctext.substring(0, ipos) + typed + ctext.substring(ipos))
      state.cursor.update(ipos+typed.length)
    }
  },
  delete: (state, typed) => {
    const ctext = state.text.current, ipos = state.cursor.current
    if (ipos < ctext.length) {
      state.text.update(ctext.substring(0, ipos) + ctext.substring(ipos+1))
    }
  },
  backspace: (state, typed) => {
    const ctext = state.text.current, ipos = state.cursor.current
    if (ipos > 0) {
      state.text.update(ctext.substring(0, ipos-1) + ctext.substring(ipos))
      state.cursor.update(ipos-1)
    }
  },
  // clipboard interaction
  cut: (state, typed) => {
    const [sstart, send] = state.selection.current
    if (send > sstart) {
      const ctext = state.text.current
      state.text.update(ctext.substring(0, sstart) + ctext.substring(send))
      state.selection.update([0,0])
      state.cursor.update(sstart)
      navigator.clipboard.writeText(ctext.substring(sstart, send))
    }
  },
  copy: (state, typed) => {
    const [sstart, send] = state.selection.current
    if (send > sstart) navigator.clipboard.writeText(state.text.current.substring(sstart, send))
  },
  paste: (state, typed) => {
    readClipText().then(text => {
      if (text) actions.insert(state, text.replace("\n", "").replace("\r", ""))
    })
  },
  // moving the cursor around
  cursorStart: (state, typed) => {
    state.cursor.update(0)
  },
  cursorLeft: (state, typed) => {
    state.cursor.update(Math.max(state.cursor.current-1, 0))
  },
  cursorRight: (state, typed) => {
    state.cursor.update(Math.min(state.cursor.current+1, state.text.current.length))
  },
  cursorEnd: (state, typed) => {
    state.cursor.update(state.text.current.length)
  },
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
  // TODO: Shift-Arrow should extend selection left & right
  ArrowLeft: {0: "cursorLeft", [CtrlMask]: "cursorStart"},
  ArrowRight: {0: "cursorRight", [CtrlMask]: "cursorEnd"},
  Home: {0: "cursorStart"},
  End: {0: "cursorEnd"},

  // TODO: make keymap dynamically, passing "standard" modifier mask so we can
  // create macOS keymaps that use Meta & Linux/Windows keymaps that use Ctrl
  KeyX: {[CtrlMask]: "cut", [MetaMask]: "cut"},
  KeyC: {[CtrlMask]: "copy", [MetaMask]: "copy"},
  KeyV: {[CtrlMask]: "paste", [MetaMask]: "paste"},

  // Emacs key bindings
  KeyA: {[CtrlMask]: "cursorStart"},
  KeyE: {[CtrlMask]: "cursorEnd"},
  KeyD: {[CtrlMask]: "delete"},
  KeyH: {[CtrlMask]: "backspace"},
}

export interface CursorStyle {
  stroke? :Spec<PaintConfig>
  width? :number
}

const DefaultBlinkPeriod = 0.6

export interface CursorConfig extends ElementConfig {
  type: "cursor"
  blinkPeriod? :number
  style :PMap<CursorStyle>
}

export class Cursor extends Element {
  private stroke = this.observe(DefaultPaint)

  constructor (ctx :ElementContext, parent :Element, readonly config :CursorConfig) {
    super(ctx, parent, config)
    this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      if (style.stroke) this.stroke.observe(ctx.style.resolvePaint(style.stroke))
      else this.stroke.update(DefaultPaint)
    })
  }

  get style () :CursorStyle { return this.getStyle(this.config.style, this.state.current) }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {} // not used
  protected relayout () {} // not used

  protected rerender (canvas :CanvasRenderingContext2D) {
    const x = this.x, y = this.y, h = this.height
    this.stroke.current.prepStroke(canvas)
    canvas.beginPath()
    canvas.moveTo(x, y)
    canvas.lineTo(x, y+h)
    canvas.lineWidth = this.style.width || 1
    canvas.stroke()
    canvas.lineWidth = 1
  }
}

const wordBRegex = new RegExp("\\b")

function wordBounds (words :string[], pos :number) :[number, number] {
  let off = 0
  for (let ww = 0; ww < words.length; ww += 1) {
    const wend = off + words[ww].length
    if (wend > pos) return [off, wend]
    off = wend
  }
  // if we fell off the end, say we're in the final word
  return [off-words[words.length-1].length, off]
}

type Selector = (moff :number, state :TextState) => void

function charSelector (text :string, doff :number, state :TextState) :Selector {
  state.selection.update([doff, doff])
  state.cursor.update(doff)
  return (moff, state) => {
    state.cursor.update(moff)
    const mino = Math.min(doff, moff), maxo = Math.max(doff, moff)
    state.selection.update([mino, maxo])
  }
}

function wordSelector (text :string, doff :number, state :TextState) :Selector {
  const words = text.split(wordBRegex)
  const dbounds = wordBounds(words, doff)
  state.selection.update(dbounds)
  // put the cursor at the end of the selection
  state.cursor.update(dbounds[1])
  return (moff, state) => {
    const mbounds = wordBounds(words, moff)
    if (mbounds[0] < dbounds[0]) {
      state.selection.update([mbounds[0], dbounds[1]])
      state.cursor.update(mbounds[0])
    } else {
      state.selection.update([dbounds[0], mbounds[1]])
      state.cursor.update(mbounds[1])
    }
  }
}

function allSelector (text :string, doff :number, state :TextState) :Selector {
  state.selection.update([0, text.length])
  return (moff, state) => state.cursor.update(moff)
}

const DefaultCursor :CursorConfig = {type: "cursor", style: {}}

/** Defines configuration for [[Text]]. */
export interface TextConfig extends ControlConfig {
  type :"text"
  cursor? :CursorConfig
  text :Spec<Mutable<string>>
  onEnter? :Spec<Action>
}

/** Displays a span of editable text. */
export class Text extends Control {
  private readonly jiggle = Mutable.local(false)
  private readonly textState :TextState
  private readonly onEnter :Action
  readonly coffset = Mutable.local(0)
  readonly text :Mutable<string>
  readonly label :Label
  readonly cursor :Cursor

  constructor (ctx :ElementContext, parent :Element, readonly config :TextConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this.coffset)
    this.text = ctx.model.resolve(config.text)
    this.onEnter = config.onEnter ? ctx.model.resolve(config.onEnter) : NoopAction

    const label = this.contents.findChild("label")
    if (label) this.label = label as Label
    else throw new Error(`Text control must have Label child [config=${JSON.stringify(config)}].`)

    // hide the cursor when the label has a selection
    const hasSel = this.label.selection.map(([ss, se]) => se > ss)
    // we include jiggle here so that we can reset the clock fold on demand when the user clicks the
    // mouse even when we're already focused
    const blinking = Value.join3(this.state, hasSel, this.jiggle).switchMap(
      ([state, hasSel, jiggle]) => {
        if (state !== "focused" || hasSel) return Value.constant(false)
        else {
          const blinkPeriod = this.cursor.config.blinkPeriod || DefaultBlinkPeriod
          return this.root.clock.fold(0, (acc, c) => acc+c.dt, refEquals).
            map(acc => Math.floor(acc/blinkPeriod) % 2 === 0)
        }
      })
    const cconfig = {...(config.cursor || DefaultCursor), visible: blinking}
    this.cursor = ctx.elem.create(ctx, this, cconfig) as Cursor

    this.textState = {text: this.text, cursor: this.coffset, selection: this.label.selection}
  }

  get styleScope () { return {id: "text", states: ControlStates} }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined

    // if we're already focused, jiggle the cursor blinker so it restarts; this ensures that the
    // user immediately sees the cursor at the new location
    if (this.isFocused) this.jiggle.update(!this.jiggle.current)
    else this.focus()

    // figure out where the click landed
    const label = this.label, dp = pos[0] - label.x - label.xoffset.current
    const doff = label.span.current.computeOffset(dp)

    // update selection depending on number of clicks
    let sel :Selector
    switch (event.detail) {
    case 1: sel = charSelector(label.text.current, doff, this.textState) ; break
    case 2: sel = wordSelector(label.text.current, doff, this.textState) ; break
    default:
    case 3: sel = allSelector(label.text.current, doff, this.textState) ; break
    }

    // as the mouse moves, move the cursor and update the selection
    return {
      move: (event, pos) => {
        const mp = pos[0] - label.x - label.xoffset.current
        sel(label.span.current.computeOffset(mp), this.textState)
      },
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
          action(this.textState, typed)
        } else {
          console.warn(`Invalid binding for ${event.key} (mods: ${mask}): '${action}'`)
        }
      } else if (isPrintable) {
        actions.insert(this.textState, typed)
      } else if (event.code === "Enter") {
        this.onEnter()
      }
    }
    // let the browser know we handled this event
    event.preventDefault()
  }

  protected revalidate () {
    super.revalidate()
    const lx = this.label.x, ly = this.label.y, lw = this.label.width, lh = this.label.height
    const cadvance = this.label.span.current.measureAdvance(this.coffset.current)

    // if the cursor is out of bounds, adjust the label x offset to bring it to the edge
    const ll = -this.label.xoffset.current
    if (cadvance < ll) this.label.xoffset.update(-cadvance)
    else if (cadvance > ll+lw) this.label.xoffset.update(lw-cadvance)

    this.cursor.setBounds(rect.set(tmpr, lx + this.label.xoffset.current + cadvance, ly, 1, lh))
    this.cursor.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D) {
    super.rerender(canvas)
    this.cursor.render(canvas)
  }
}
