import {vec2} from "tfw/core/math"
import {Emitter, Remover, Subject, Mutable, Value} from "tfw/core/react"
import {loadImage} from "tfw/core/assets"
import {Renderer} from "tfw/scene2/gl"
import {UI} from "tfw/ui/ui"
import {Host2} from "tfw/ui/host2"
import {RenderFn} from "./index"

const buttonCorner = 3

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
      border: {
        stroke: {type: "color", color: "#000000"},
        cornerRadius: buttonCorner,
      },
      background: {
        fill: {type: "color", color: "#99CCFF"},
        cornerRadius: buttonCorner,
        shadow: {offsetX: 2, offsetY: 2, blur: 5, color: "#000000"}
      },
      pressed: {
        background: {fill: {type: "color", color: "#77AADD"}, cornerRadius: buttonCorner},
      },
      disabled: {
        background: {fill: {type: "color", color: "#CC9966"}, cornerRadius: buttonCorner}
      },
    }
  }
}

const config = {
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
        style: {
          font: {size: 32, weight: "bold"},
          normal: {
            shadow: {offsetX: 4, offsetY: 4, blur: 5, color: "#666666"}
          }
        }
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
    const cleanup :Remover[] = []
    const ui = new UI(theme, model, {resolveImage: loadImage})
    const host = new Host2(renderer)
    cleanup.unshift(() => host.dispose())
    host.bind(renderer.canvas)
    cleanup.unshift(() => host.unbind(renderer.canvas))

    const rootOrigin = vec2.fromValues(10, 10)
    const root = ui.createRoot({type: "root", scale: renderer.scale, ...config})
    root.pack(400, 400)
    host.addRoot(root, rootOrigin)

    cleanup.unshift(model.button.target.onEmit(event => {
      if (event === "toggle") model.top.enabled.update(!model.top.enabled.current)
    }))

    const uptime = () => model.middle.text.update(new Date().toLocaleTimeString())
    uptime()
    const timer = setInterval(uptime, 1000)
    cleanup.unshift(() => clearInterval(timer))

    disp((clock, batch, surf) => {
      host.update(clock)
      surf.begin()
      surf.clearTo(1, 1, 1, 1)
      host.render(surf)
      surf.end()
    })

    return () => cleanup.forEach(r => r())
  })
}
