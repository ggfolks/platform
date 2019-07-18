import {vec2} from "tfw/core/math"
import {Emitter, Subject, Mutable, Value} from "tfw/core/react"
import {loadImage} from "tfw/core/assets"
import {Renderer, Texture, createTexture, imageToTexture} from "tfw/scene2/gl"
import {UI} from "tfw/ui/ui"
import {RenderFn} from "./index"

const theme = {
  styles: {
    baseFont: {family: "Helvetica", size: 16},

    whitePaint: {type: "color", color: "#FFFFFF"},
    lightGrayPaint: {type: "color", color: "#999999"},
    darkGrayPaint: {type: "color", color: "#666666"},
    blackPaint: {type: "color", color: "#000000"},

    gradientPaint: {
      type: "linear", start: [0, 0], end: [0, 100],
      stops: [[0, "#99FFCC"], [0.5, "#CC99FF"], [1, "#99CCFF"]]
    },
    flappyPatternPaint: {type: "pattern", image: "flappy.png"},
  },

  elements: {
    base: {
      font: "$baseFont",
      stroke: "$whitePaint",
      fill: "$blackPaint",
      disabled: {
        stroke: "$lightGrayPaint",
        fill: "$darkGrayPaint",
      }
    },
    label: {
      parent: "base"
    },
    button: {
      parent: "base",
      padding: 10,
      background: {fill: {type: "color", color: "#FFCC99"}, cornerRadius: 10},
      pressed: {
        background: {fill: {type: "color", color: "#99FFCC"}, cornerRadius: 10},
      },
      disabled: {
        background: {fill: {type: "color", color: "#CC9966"}, cornerRadius: 10}
      },
    }
  }
}

const config = {
  type: "root" as "root", // TODO: meh
  contents: {
    type: "column",
    offPolicy: "stretch",
    gap: 10,
    contents: [{
      type: "box",
      enabled: "top.enabled",
      constraints: {stretch: true},
      contents: {
        type: "label",
        enabled: "top.enabled",
        text: "top.text",
        style: {font: {size: 32, weight: "bold"}}
      },
      style: {
        normal: {background: {fill: {type: "color", color: "#FFCC99"}, cornerRadius: 10}},
        disabled: {background: {fill: {type: "color", color: "#CCFF99"}, cornerRadius: 10}}
      }
    }, {
      type: "box",
      constraints: {stretch: true},
      contents: {type: "label", text: "middle.text", style: {font: {size: 24}}},
      style: {background: {fill: "$gradientPaint"}}
    }, {
      type: "box",
      constraints: {stretch: true},
      contents: {
        type: "button",
        target: "button.target",
        event: "toggle",
        contents: {type: "label", text: "button.text"},
      },
      style: {background: {fill: "$flappyPatternPaint", cornerRadius: 10}}
    }],
  },
}

const model = {
  top: {
    text: Value.constant("Top"), // TODO: if model contains raw value, wrap in Value.constant?
    enabled: Mutable.local(false)
  },
  middle: {
    text: Mutable.local("Time")
  },
  button: {
    text: Value.constant("Toggle"),
    target: new Emitter<string>()
  }
}

export function uiDemo (renderer :Renderer) :Subject<RenderFn> {
  return Subject.derive(disp => {
    const ui = new UI(theme, model, {resolveImage: loadImage})
    const root = ui.createRoot({...config, scale: renderer.scale})
    const canvas = root.pack(400, 400)
    const texcfg = {...Texture.DefaultConfig, scale: renderer.scale}
    const gltex = createTexture(renderer.glc, texcfg)
    let tex = imageToTexture(renderer.glc, canvas, texcfg, gltex)

    const rootOrigin = vec2.fromValues(10, 10)
    const eventListener = (event :MouseEvent) => root.dispatchMouseEvent(event, rootOrigin)
    renderer.canvas.addEventListener("mousedown", eventListener)
    renderer.canvas.addEventListener("mousemove", eventListener)
    renderer.canvas.addEventListener("mouseup", eventListener)

    const unlisten = model.button.target.onEmit(event => {
      if (event === "toggle") model.top.enabled.update(!model.top.enabled.current)
    })

    const uptime = () => model.middle.text.update(new Date().toLocaleTimeString())
    uptime()
    const timer = setInterval(uptime, 1000)

    disp((clock, batch, surf) => {
      // TODO: this needs to be more automatic; maybe pass a Stream<Clock> to Root?
      if (root.validate()) {
        root.render(root.ctx)
        tex = imageToTexture(renderer.glc, root.canvas, texcfg, gltex)
      }
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      surf.draw(tex, rootOrigin, tex.size)
      surf.end()
    })

    return () => {
      renderer.canvas.removeEventListener("mousedown", eventListener)
      renderer.canvas.removeEventListener("mousemove", eventListener)
      renderer.canvas.removeEventListener("mouseup", eventListener)
      unlisten()
      root.dispose()
      renderer.glc.deleteTexture(gltex)
      clearInterval(timer)
    }
  })
}
